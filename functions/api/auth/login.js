import { SignJWT } from 'jose';
import { comparePassword } from '../../../lib/auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const { DB } = env;
  
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const { email, password } = await request.json();
    
    // Find user
    const user = await DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(email).first();
    
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Verify password
    const isValid = await comparePassword(password, user.password_hash, user.password_salt);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid credentials' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Update last login
    await DB.prepare(
      'UPDATE users SET last_login = ?, failed_attempts = 0 WHERE id = ?'
    ).bind(Math.floor(Date.now() / 1000), user.id).run();
    
    // Generate JWT token
    const secret = new TextEncoder().encode(env.JWT_SECRET || 'your-secret-key');
    const token = await new SignJWT({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'author'
    })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);
    
    // Create session
    const sessionId = crypto.randomUUID();
    await DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(
      sessionId,
      user.id,
      Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
    ).run();
    
    const responseData = {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'author'
      }
    };
    
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `auth_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
