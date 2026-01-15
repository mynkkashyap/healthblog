export async function onRequest(context) {
  const { user, env } = context;
  const { DB } = env;
  
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  try {
    const userData = await DB.prepare(
      `SELECT 
        id, name, email, role, bio, gender, age, mobile, 
        instagram, twitter, avatar, verified, created_at, 
        last_login
       FROM users WHERE id = ?`
    ).bind(user.id).first();
    
    if (!userData) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Get user's posts count
    const postsCount = await DB.prepare(
      'SELECT COUNT(*) as count FROM posts WHERE author_id = ?'
    ).bind(user.id).first();
    
    // Get user's comments count
    const commentsCount = await DB.prepare(
      'SELECT COUNT(*) as count FROM comments WHERE user_id = ?'
    ).bind(user.id).first();
    
    return new Response(
      JSON.stringify({
        user: {
          ...userData,
          stats: {
            posts: postsCount.count,
            comments: commentsCount.count
          }
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error fetching user:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
