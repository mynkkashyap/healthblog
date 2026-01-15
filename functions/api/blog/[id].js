export async function onRequest(context) {
  const { request, env, user, params } = context;
  const { DB } = env;
  const { id } = params;
  
  switch (request.method) {
    case 'GET':
      return getPost(id, DB, user);
    case 'PUT':
      return updatePost(id, request, DB, user);
    case 'DELETE':
      return deletePost(id, DB, user);
    default:
      return new Response('Method not allowed', { status: 405 });
  }
}

async function getPost(id, DB, user) {
  try {
    let whereClause = 'p.id = ?';
    const params = [id];
    
    if (!user) {
      whereClause += ' AND p.status = ?';
      params.push('published');
    } else if (user.role !== 'admin') {
      whereClause += ' AND (p.status = ? OR p.author_id = ?)';
      params.push('published', user.id);
    }
    
    const query = `
      SELECT 
        p.*,
        u.name as author_name,
        u.bio as author_bio,
        u.avatar as author_avatar,
        GROUP_CONCAT(DISTINCT c.id) as category_ids,
        GROUP_CONCAT(DISTINCT c.name) as category_names,
        GROUP_CONCAT(DISTINCT c.slug) as category_slugs,
        GROUP_CONCAT(DISTINCT t.id) as tag_ids,
        GROUP_CONCAT(DISTINCT t.name) as tag_names,
        GROUP_CONCAT(DISTINCT t.slug) as tag_slugs
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN post_categories pc ON p.id = pc.post_id
      LEFT JOIN categories c ON pc.category_id = c.id
      LEFT JOIN post_tags pt ON p.id = pt.post_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      WHERE ${whereClause}
      GROUP BY p.id
    `;
    
    const post = await DB.prepare(query).bind(...params).first();
    
    if (!post) {
      return new Response(
        JSON.stringify({ error: 'Post not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Increment view count
    if (post.status === 'published') {
      await DB.prepare(
        'UPDATE posts SET view_count = view_count + 1 WHERE id = ?'
      ).bind(id).run();
    }
    
    // Format response
    const response = {
      ...post,
      category_ids: post.category_ids ? post.category_ids.split(',') : [],
      category_names: post.category_names ? post.category_names.split(',') : [],
      category_slugs: post.category_slugs ? post.category_slugs.split(',') : [],
      tag_ids: post.tag_ids ? post.tag_ids.split(',') : [],
      tag_names: post.tag_names ? post.tag_names.split(',') : [],
      tag_slugs: post.tag_slugs ? post.tag_slugs.split(',') : []
    };
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching post:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function updatePost(id, request, DB, user) {
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    // Check if post exists and user has permission
    const existingPost = await DB.prepare(
      'SELECT author_id FROM posts WHERE id = ?'
    ).bind(id).first();
    
    if (!existingPost) {
      return new Response(
        JSON.stringify({ error: 'Post not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (user.role !== 'admin' && existingPost.author_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const data = await request.json();
    const {
      title,
      content,
      excerpt,
      status,
      featured,
      category_ids = [],
      tag_names = []
    } = data;
    
    const updates = [];
    const params = [];
    
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
      
      // Update slug if title changed
      if (title) {
        const slug = title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/--+/g, '-')
          .trim();
        
        updates.push('slug = ?');
        params.push(slug);
      }
    }
    
    if (content !== undefined) {
      updates.push('content = ?');
      params.push(content);
    }
    
    if (excerpt !== undefined) {
      updates.push('excerpt = ?');
      params.push(excerpt);
    }
    
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
      
      if (status === 'published') {
        updates.push('published_at = ?');
        params.push(Math.floor(Date.now() / 1000));
      }
    }
    
    if (featured !== undefined) {
      updates.push('featured = ?');
      params.push(featured ? 1 : 0);
    }
    
    updates.push('updated_at = ?');
    params.push(Math.floor(Date.now() / 1000));
    
    if (updates.length === 1) { // Only updated_at
      return new Response(
        JSON.stringify({ message: 'No changes made' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    params.push(id);
    
    await DB.prepare(
      `UPDATE posts SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...params).run();
    
    // Update categories if provided
    if (category_ids.length > 0) {
      await DB.prepare(
        'DELETE FROM post_categories WHERE post_id = ?'
      ).bind(id).run();
      
      for (const categoryId of category_ids) {
        await DB.prepare(
          'INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)'
        ).bind(id, categoryId).run();
      }
    }
    
    // Update tags if provided
    if (tag_names.length > 0) {
      await DB.prepare(
        'DELETE FROM post_tags WHERE post_id = ?'
      ).bind(id).run();
      
      for (const tagName of tag_names) {
        if (!tagName.trim()) continue;
        
        const tagSlug = tagName.toLowerCase().replace(/\s+/g, '-');
        
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
          'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)'
        ).bind(id, tag.id).run();
      }
    }
    
    return new Response(
      JSON.stringify({ message: 'Post updated successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error updating post:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function deletePost(id, DB, user) {
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    // Check if post exists and user has permission
    const existingPost = await DB.prepare(
      'SELECT author_id FROM posts WHERE id = ?'
    ).bind(id).first();
    
    if (!existingPost) {
      return new Response(
        JSON.stringify({ error: 'Post not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (user.role !== 'admin' && existingPost.author_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    await DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
    
    return new Response(
      JSON.stringify({ message: 'Post deleted successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error deleting post:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
