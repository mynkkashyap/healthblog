import { jwtVerify } from 'jose';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  
  // Public routes that don't require authentication
  const publicRoutes = [
    '/',
    '/login',
    '/register',
    '/blog',
    '/api/blog/posts',
    '/api/blog/posts/[id]',
    '/api/blog/categories',
    '/api/auth/login',
    '/api/auth/register'
  ];
  
  // Check if route is public
  const isPublicRoute = publicRoutes.some(route => {
    if (route.includes('[id]')) {
      const basePath = route.replace('/[id]', '');
      return url.pathname.startsWith(basePath) && url.pathname.split('/').length === basePath.split('/').length + 1;
    }
    return url.pathname === route || url.pathname.startsWith(route + '/');
  });
  
  if (isPublicRoute) {
    return next();
  }
  
  // Check for JWT token
  const authHeader = request.headers.get('Authorization');
  let token = null;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    // Check cookie for token
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});
      token = cookies['auth_token'];
    }
  }
  
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // Verify JWT token
    const secret = new TextEncoder().encode(env.JWT_SECRET || 'your-secret-key-change-in-production');
    const { payload } = await jwtVerify(token, secret);
    
    // Add user info to request context
    context.user = payload;
    
    return next();
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
