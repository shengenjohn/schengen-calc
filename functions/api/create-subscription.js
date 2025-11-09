/**
 * Schengen Calc - Create Subscription API Endpoint
 * POST /api/create-subscription
 */

import { createSquareCustomer, createSubscription, getSquareLocation } from '../square-subscription-api.js';

// Define subscription plan mappings
const SUBSCRIPTION_PLANS = {
  'pro-monthly': {
    planName: 'Pro Plan',
    frequency: 'MONTHLY',
    price: 299, // £2.99 in pence
  },
  'pro-annual': {
    planName: 'Pro Plan', 
    frequency: 'ANNUALLY',
    price: 2400, // £24.00 in pence
  },
  'business-monthly': {
    planName: 'Business Plan',
    frequency: 'MONTHLY', 
    price: 1000, // £10.00 in pence
  },
  'business-annual': {
    planName: 'Business Plan',
    frequency: 'ANNUALLY',
    price: 10000, // £100.00 in pence
  }
};

export async function onRequestPost({ request, env, params }) {
  try {
    // Parse request body
    const requestData = await request.json();
    
    // Validate required fields
    const requiredFields = ['email', 'firstName', 'lastName', 'planType', 'paymentToken'];
    const missing = requiredFields.filter(field => !requestData[field]);
    
    if (missing.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate plan type
    if (!SUBSCRIPTION_PLANS[requestData.planType]) {
      return new Response(JSON.stringify({
        success: false,
        error: `Invalid plan type: ${requestData.planType}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const planInfo = SUBSCRIPTION_PLANS[requestData.planType];
    
    // Get Square location
    const locationResult = await getSquareLocation(env);
    if (!locationResult.success) {
      throw new Error('Failed to get Square location: ' + locationResult.error);
    }
    
    const locationId = locationResult.location.id;
    
    // Check if user already exists in D1 database
    let userId;
    try {
      const existingUser = await env.DB.prepare(
        'SELECT id, square_customer_id FROM users WHERE email = ?'
      ).bind(requestData.email).first();
      
      if (existingUser) {
        userId = existingUser.id;
        
        // Check if user already has active subscription
        const activeSubscription = await env.DB.prepare(
          'SELECT * FROM subscriptions WHERE user_id = ? AND status = ?'
        ).bind(userId, 'ACTIVE').first();
        
        if (activeSubscription) {
          return new Response(JSON.stringify({
            success: false,
            error: 'User already has an active subscription'
          }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    } catch (error) {
      console.error('Database error checking existing user:', error);
    }
    
    // Create or get user in our database
    if (!userId) {
      try {
        const userResult = await env.DB.prepare(
          'INSERT INTO users (email, first_name, last_name, created_at) VALUES (?, ?, ?, datetime("now")) RETURNING id'
        ).bind(requestData.email, requestData.firstName, requestData.lastName).first();
        
        userId = userResult.id;
      } catch (error) {
        console.error('Error creating user in database:', error);
        throw new Error('Failed to create user account');
      }
    }
    
    // Create customer in Square
    const customerResult = await createSquareCustomer(env, {
      firstName: requestData.firstName,
      lastName: requestData.lastName,
      email: requestData.email,
      userId: userId.toString()
    });
    
    if (!customerResult.success) {
      throw new Error('Failed to create Square customer: ' + customerResult.error);
    }
    
    const squareCustomerId = customerResult.customer.id;
    
    // Update user with Square customer ID
    try {
      await env.DB.prepare(
        'UPDATE users SET square_customer_id = ? WHERE id = ?'
      ).bind(squareCustomerId, userId).run();
    } catch (error) {
      console.error('Error updating user with Square customer ID:', error);
    }
    
    // Create subscription in Square
    const subscriptionResult = await createSubscription(env, {
      locationId: locationId,
      planId: requestData.planType, // You may need to map this to actual Square plan IDs
      customerId: squareCustomerId,
      cardId: requestData.paymentToken, // Payment method token from frontend
      priceOverride: planInfo.price // Override with our price
    });
    
    if (!subscriptionResult.success) {
      throw new Error('Failed to create subscription: ' + subscriptionResult.error);
    }
    
    const subscription = subscriptionResult.subscription;
    
    // Store subscription in D1 database
    try {
      await env.DB.prepare(
        `INSERT INTO subscriptions 
         (user_id, square_subscription_id, plan_type, status, price_amount, currency, frequency, started_at, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`
      ).bind(
        userId,
        subscription.id,
        requestData.planType,
        'ACTIVE',
        planInfo.price,
        'GBP',
        planInfo.frequency,
        subscription.startDate
      ).run();
    } catch (error) {
      console.error('Error storing subscription in database:', error);
      // Note: Subscription was created in Square, but not stored locally
      // Consider implementing cleanup logic
    }
    
    // Return success response
    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription created successfully',
      subscription: {
        id: subscription.id,
        planType: requestData.planType,
        planName: planInfo.planName,
        frequency: planInfo.frequency,
        price: planInfo.price,
        currency: 'GBP',
        status: subscription.status,
        startDate: subscription.startDate
      },
      user: {
        id: userId,
        email: requestData.email,
        squareCustomerId: squareCustomerId
      }
    }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
    
  } catch (error) {
    console.error('Error creating subscription:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
