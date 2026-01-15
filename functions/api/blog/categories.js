export async function onRequest(context) {
  const { request, env, user } = context;
  const { DB } = env;
  
  switch (request.method) {
    case 'GET':
      return getCategories(DB);
    case 'POST':
      return createCategory(request, DB, user);
    default:
      return new Response('Method not allowed', { status: 405 });
  }
}

async function getCategories(DB) {
  try {
    const categories = await DB.prepare(`
      SELECT 
        c.*,
        COUNT(DISTINCT pc.post_id) as post_count
      FROM categories c
      LEFT JOIN post_categories pc ON c.id = pc.category_id
      LEFT JOIN posts p ON pc.post_id = p.id AND p.status = 'published'
      GROUP BY c.id
      ORDER BY c.name
    `).all();
    
    return new Response(JSON.stringify(categories.results), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching categories:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function createCategory(request, DB, user) {
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    const { name, description } = await request.json();
    
    if (!name) {
      return new Response(
        JSON.stringify({ error: 'Category name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const slug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();
    
    const id = crypto.randomUUID();
    
    await DB.prepare(
      'INSERT INTO categories (id, name, slug, description) VALUES (?, ?, ?, ?)'
    ).bind(id, name, slug, description || '').run();
    
    return new Response(
      JSON.stringify({ id, name, slug, message: 'Category created successfully' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      return new Response(
        JSON.stringify({ error: 'Category with this name already exists' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
