export async function onRequest(context) {
  const { request, env, user } = context;
  const { DB } = env;
  
  switch (request.method) {
    case 'GET':
      return getComments(request, DB, user);
    case 'POST':
      return createComment(request, DB, user);
    default:
      return new Response('Method not allowed', { status: 405 });
  }
}

async function getComments(request, DB, user) {
  try {
    const url = new URL(request.url);
    const postId = url.searchParams.get('post_id');
    const status = url.searchParams.get('status');
    const parentId = url.searchParams.get('parent_id');
    
    let whereClauses = ['1=1'];
    let params = [];
    
    if (postId) {
      whereClauses.push('c.post_id = ?');
      params.push(postId);
    }
    
    if (parentId) {
      whereClauses.push('c.parent_id = ?');
      params.push(parentId);
    } else {
      whereClauses.push('c.parent_id IS NULL');
    }
    
    // Only show approved comments to non-admins
    if (!user || user.role !== 'admin') {
      whereClauses.push('c.status = ?');
      params.push('approved');
    } else if (status) {
      whereClauses.push('c.status = ?');
      params.push(status);
    }
    
    const where = whereClauses.join(' AND ');
    
    const comments = await DB.prepare(`
      SELECT 
        c.*,
        u.name as user_name,
        u.avatar as user_avatar,
        p.title as post_title,
        p.slug as post_slug
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN posts p ON c.post_id = p.id
      WHERE ${where}
      ORDER BY c.created_at DESC
    `).bind(...params).all();
    
    // Get replies for each comment
    const commentsWithReplies = await Promise.all(
      comments.results.map(async (comment) => {
        const replies = await DB.prepare(`
          SELECT 
            r.*,
            u.name as user_name,
            u.avatar as user_avatar
          FROM comments r
          LEFT JOIN users u ON r.user_id = u.id
          WHERE r.parent_id = ? AND (r.status = ? OR ? = 'admin')
          ORDER BY r.created_at ASC
        `).bind(comment.id, 'approved', user?.role || '').all();
        
        return {
          ...comment,
          replies: replies.results
        };
      })
    );
    
    return new Response(JSON.stringify(commentsWithReplies), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error fetching comments:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function createComment(request, DB, user) {
  try {
    const data = await request.json();
    const { post_id, content, parent_id } = data;
    
    if (!post_id || !content) {
      return new Response(
        JSON.stringify({ error: 'Post ID and content are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if post exists and is published
    const post = await DB.prepare(
      'SELECT id, status FROM posts WHERE id = ?'
    ).bind(post_id).first();
    
    if (!post || post.status !== 'published') {
      return new Response(
        JSON.stringify({ error: 'Post not found or not published' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const id = crypto.randomUUID();
    let author_name = '';
    let author_email = '';
    let user_id = null;
    let commentStatus = 'pending';
    
    if (user) {
      // Logged-in user
      user_id = user.id;
      const userData = await DB.prepare(
        'SELECT name, email FROM users WHERE id = ?'
      ).bind(user.id).first();
      author_name = userData.name;
      author_email = userData.email;
      commentStatus = 'approved'; // Auto-approve comments from logged-in users
    } else {
      // Guest user
      author_name = data.author_name;
      author_email = data.author_email;
      
      if (!author_name || !author_email) {
        return new Response(
          JSON.stringify({ error: 'Name and email are required for guest comments' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      // Check settings for comment approval
      const setting = await DB.prepare(
        'SELECT value FROM settings WHERE key = ?'
      ).bind('require_comment_approval').first();
      
      commentStatus = setting?.value === 'false' ? 'approved' : 'pending';
    }
    
    // Validate parent comment if provided
    if (parent_id) {
      const parentComment = await DB.prepare(
        'SELECT id FROM comments WHERE id = ? AND post_id = ?'
      ).bind(parent_id, post_id).first();
      
      if (!parentComment) {
        return new Response(
          JSON.stringify({ error: 'Parent comment not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    
    await DB.prepare(`
      INSERT INTO comments (
        id, post_id, user_id, author_name, author_email, 
        content, status, parent_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      post_id,
      user_id,
      author_name,
      author_email,
      content,
      commentStatus,
      parent_id || null,
      Math.floor(Date.now() / 1000)
    ).run();
    
    return new Response(
      JSON.stringify({ 
        id, 
        message: commentStatus === 'approved' 
          ? 'Comment added successfully' 
          : 'Comment submitted for approval' 
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error creating comment:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
