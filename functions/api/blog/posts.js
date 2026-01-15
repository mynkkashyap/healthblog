export async function onRequest(context) {
  const { request, env, user } = context;
  const { DB } = env;
  
  switch (request.method) {
    case 'GET':
      return getPosts(request, DB, user);
    case 'POST':
      return createPost(request, DB, user);
    default:
      return new Response('Method not allowed', { status: 405 });
  }
}

async function getPosts(request, DB, user) {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const offset = (page - 1) * limit;
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');
    const status = url.searchParams.get('status');
    const authorId = url.searchParams.get('author_id');
    const featured = url.searchParams.get('featured');
    
    // Build query based on user role
    let whereClauses = [];
    let params = [];
    
    if (user && user.role === 'admin') {
      // Admin can see all posts
    } else if (user) {
      // Authors can see their own posts + published posts
      whereClauses.push('(p.author_id = ? OR p.status = ?)');
      params.push(user.id, 'published');
    } else {
      // Public users can only see published posts
      whereClauses.push('p.status = ?');
      params.push('published');
    }
    
    if (category) {
      whereClauses.push('EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id AND pc.category_id = ?)');
      params.push(category);
    }
    
    if (tag) {
      whereClauses.push('EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag_id = ?)');
      params.push(tag);
    }
    
    if (authorId) {
      whereClauses.push('p.author_id = ?');
      params.push(authorId);
    }
    
    if (status && (user?.role === 'admin' || user?.id === authorId)) {
      whereClauses.push('p.status = ?');
      params.push(status);
    }
    
    if (featured) {
      whereClauses.push('p.featured = ?');
      params.push(1);
    }
    
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // Get posts with author info
    const postsQuery = `
      SELECT 
        p.*,
        u.name as author_name,
        u.avatar as author_avatar,
        GROUP_CONCAT(DISTINCT c.id) as category_ids,
        GROUP_CONCAT(DISTINCT c.name) as category_names,
        GROUP_CONCAT(DISTINCT t.id) as tag_ids,
        GROUP_CONCAT(DISTINCT t.name) as tag_names,
        COUNT(DISTINCT com.id) as comment_count
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN post_categories pc ON p.id = pc.post_id
      LEFT JOIN categories c ON pc.category_id = c.id
      LEFT JOIN post_tags pt ON p.id = pt.post_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      LEFT JOIN comments com ON p.id = com.post_id AND com.status = 'approved'
      ${where}
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    params.push(limit, offset);
    const posts = await DB.prepare(postsQuery).bind(...params).all();
    
    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM posts p
      ${where}
    `;
    
    const countResult = await DB.prepare(countQuery).bind(...params.slice(0, -2)).first();
    
    return new Response(
      JSON.stringify({
        posts: posts.results.map(post => ({
          ...post,
          category_ids: post.category_ids ? post.category_ids.split(',') : [],
          category_names: post.category_names ? post.category_names.split(',') : [],
          tag_ids: post.tag_ids ? post.tag_ids.split(',') : [],
          tag_names: post.tag_names ? post.tag_names.split(',') : []
        })),
        pagination: {
          page,
          limit,
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error fetching posts:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function createPost(request, DB, user) {
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    const data = await request.json();
    const {
      title,
      content,
      excerpt,
      status = 'draft',
      featured = false,
      category_ids = [],
      tag_names = []
    } = data;
    
    if (!title || !content) {
      return new Response(
        JSON.stringify({ error: 'Title and content are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Generate slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();
    
    // Check if slug exists
    const existingSlug = await DB.prepare(
      'SELECT id FROM posts WHERE slug = ?'
    ).bind(slug).first();
    
    let finalSlug = slug;
    if (existingSlug) {
      finalSlug = `${slug}-${Date.now()}`;
    }
    
    const postId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const publishedAt = status === 'published' ? now : null;
    
    // Create post
    await DB.prepare(`
      INSERT INTO posts (
        id, title, slug, content, excerpt, author_id, 
        status, featured, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      postId,
      title,
      finalSlug,
      content,
      excerpt || content.substring(0, 200),
      user.id,
      status,
      featured ? 1 : 0,
      publishedAt,
      now,
      now
    ).run();
    
    // Add categories
    for (const categoryId of category_ids) {
      await DB.prepare(
        'INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)'
      ).bind(postId, categoryId).run();
    }
    
    // Add tags (create if they don't exist)
    for (const tagName of tag_names) {
      if (!tagName.trim()) continue;
      
      const tagSlug = tagName.toLowerCase().replace(/\s+/g, '-');
      
      // Get or create tag
      let tag = await DB.prepare(
        'SELECT id FROM tags WHERE slug = ?'
      ).bind(tagSlug).first();
      
      if (!tag) {
        const tagId = crypto.randomUUID();
        await DB.prepare(
          'INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)'
        ).bind(tagId, tagName, tagSlug).run();
        tag = { id: tagId };
      }
      
      await DB.prepare(
        'INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)'
      ).bind(postId, tag.id).run();
    }
    
    return new Response(
      JSON.stringify({
        id: postId,
        slug: finalSlug,
        message: 'Post created successfully'
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error creating post:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
