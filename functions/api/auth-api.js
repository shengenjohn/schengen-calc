/**
 * Schengen Calc - User Authentication API
 * Handles user registration, login, and session management
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * User Registration
 * POST /api/auth/register
 */
export async function handleUserRegistration(request, env) {
  try {
    const userData = await request.json();
    
    // Validate required fields
    const requiredFields = ['email', 'firstName', 'lastName', 'password'];
    const missing = requiredFields.filter(field => !userData[field]);
    
    if (missing.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid email format'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate password strength
    if (userData.password.length < 8) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Password must be at least 8 characters long'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Check if user already exists
    const existingUser = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(userData.email.toLowerCase()).first();
    
    if (existingUser) {
      return new Response(JSON.stringify({
        success: false,
        error: 'User already exists with this email'
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(userData.password, saltRounds);
    
    // Create user in database
    const userResult = await env.DB.prepare(
      `INSERT INTO users (email, first_name, last_name, password_hash, created_at) 
       VALUES (?, ?, ?, ?, datetime('now')) 
       RETURNING id, email, first_name, last_name, created_at`
    ).bind(
      userData.email.toLowerCase(),
      userData.firstName,
      userData.lastName,
      passwordHash
    ).first();
    
    if (!userResult) {
      throw new Error('Failed to create user');
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: userResult.id, 
        email: userResult.email 
      },
      env.JWT_SECRET || 'your-secret-key', // You should add this to environment variables
      { expiresIn: '7d' }
    );
    
    // Create session record
    const sessionToken = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_sessions (user_id, session_token, expires_at, created_at)
       VALUES (?, ?, datetime('now', '+7 days'), datetime('now'))`
    ).bind(userResult.id, sessionToken).run();
    
    return new Response(JSON.stringify({
      success: true,
      message: 'User registered successfully',
      user: {
        id: userResult.id,
        email: userResult.email,
        firstName: userResult.first_name,
        lastName: userResult.last_name,
        subscriptionActive: false
      },
      token: token,
      sessionToken: sessionToken
    }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Error during user registration:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * User Login  
 * POST /api/auth/login
 */
export async function handleUserLogin(request, env) {
  try {
    const loginData = await request.json();
    
    // Validate required fields
    if (!loginData.email || !loginData.password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Email and password are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Find user by email
    const user = await env.DB.prepare(
      `SELECT id, email, first_name, last_name, password_hash, subscription_active 
       FROM users WHERE email = ?`
    ).bind(loginData.email.toLowerCase()).first();
    
    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid email or password'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verify password
    const passwordValid = await bcrypt.compare(loginData.password, user.password_hash);
    
    if (!passwordValid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid email or password'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Update last login time
    await env.DB.prepare(
      'UPDATE users SET last_login_at = datetime("now") WHERE id = ?'
    ).bind(user.id).run();
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Create session record
    const sessionToken = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO user_sessions (user_id, session_token, expires_at, created_at, last_used_at)
       VALUES (?, ?, datetime('now', '+7 days'), datetime('now'), datetime('now'))`
    ).bind(user.id, sessionToken).run();
    
    // Get user's current subscription status
    const subscription = await env.DB.prepare(
      'SELECT plan_type, status, frequency FROM subscriptions WHERE user_id = ? AND status = "ACTIVE"'
    ).bind(user.id).first();
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        subscriptionActive: user.subscription_active,
        subscription: subscription ? {
          planType: subscription.plan_type,
          frequency: subscription.frequency,
          status: subscription.status
        } : null
      },
      token: token,
      sessionToken: sessionToken
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Error during user login:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Verify JWT Token
 * GET /api/auth/verify
 */
export async function verifyUserToken(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid authorization token provided'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET || 'your-secret-key');
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid or expired token'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get updated user information
    const user = await env.DB.prepare(
      `SELECT id, email, first_name, last_name, subscription_active 
       FROM users WHERE id = ?`
    ).bind(decoded.userId).first();
    
    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        error: 'User not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        subscriptionActive: user.subscription_active
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Error verifying token:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Middleware to authenticate requests
 */
export async function authenticateRequest(request, env) {
  try {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'No authorization token provided' };
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, env.JWT_SECRET || 'your-secret-key');
    
    const user = await env.DB.prepare(
      'SELECT id, email, subscription_active FROM users WHERE id = ?'
    ).bind(decoded.userId).first();
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    return { 
      success: true, 
      user: {
        id: user.id,
        email: user.email,
        subscriptionActive: user.subscription_active
      }
    };
    
  } catch (error) {
    return { success: false, error: 'Invalid token' };
  }
}
