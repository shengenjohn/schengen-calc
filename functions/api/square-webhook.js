/**
 * Schengen Calc - Square Webhook Handler
 * POST /api/square-webhook
 */

import { handleSquareWebhook } from '../square-subscription-api.js';

export async function onRequestPost({ request, env, params }) {
  try {
    // Get webhook body and signature
    const webhookBody = await request.text();
    const webhookSignature = request.headers.get('x-square-signature');
    
    if (!webhookSignature) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing webhook signature'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Parse webhook event
    let webhookEvent;
    try {
      webhookEvent = JSON.parse(webhookBody);
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid JSON in webhook body'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Received Square webhook: ${webhookEvent.type}`);
    
    // Handle different webhook events
    switch (webhookEvent.type) {
      case 'subscription.created':
        return await handleSubscriptionCreatedWebhook(env, webhookEvent);
        
      case 'subscription.updated': 
        return await handleSubscriptionUpdatedWebhook(env, webhookEvent);
        
      case 'invoice.payment_made':
        return await handlePaymentSuccessWebhook(env, webhookEvent);
        
      case 'invoice.payment_failed':
        return await handlePaymentFailedWebhook(env, webhookEvent);
        
      default:
        console.log(`Unhandled webhook event type: ${webhookEvent.type}`);
        return new Response(JSON.stringify({
          success: true,
          message: 'Webhook received but not handled'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
    }
    
  } catch (error) {
    console.error('Error processing Square webhook:', error);
    
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
 * Handle subscription created webhook
 */
async function handleSubscriptionCreatedWebhook(env, webhookEvent) {
  try {
    const subscription = webhookEvent.data.object.subscription;
    const customerId = subscription.customerId;
    
    console.log(`Subscription created: ${subscription.id} for customer ${customerId}`);
    
    // Find user by Square customer ID
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE square_customer_id = ?'
    ).bind(customerId).first();
    
    if (user) {
      // Update subscription status in database
      await env.DB.prepare(
        'UPDATE subscriptions SET status = ?, square_subscription_id = ? WHERE user_id = ? AND square_subscription_id = ?'
      ).bind('ACTIVE', subscription.id, user.id, subscription.id).run();
      
      console.log(`Updated subscription status for user ${user.id}`);
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription created webhook processed'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error handling subscription created webhook:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle subscription updated webhook
 */
async function handleSubscriptionUpdatedWebhook(env, webhookEvent) {
  try {
    const subscription = webhookEvent.data.object.subscription;
    const status = subscription.status;
    
    console.log(`Subscription updated: ${subscription.id} status: ${status}`);
    
    // Update subscription status in database
    await env.DB.prepare(
      'UPDATE subscriptions SET status = ?, updated_at = datetime("now") WHERE square_subscription_id = ?'
    ).bind(status, subscription.id).run();
    
    // If subscription was cancelled or paused, update user access
    if (status === 'CANCELED' || status === 'PAUSED') {
      const subscription_record = await env.DB.prepare(
        'SELECT user_id FROM subscriptions WHERE square_subscription_id = ?'
      ).bind(subscription.id).first();
      
      if (subscription_record) {
        await env.DB.prepare(
          'UPDATE users SET subscription_active = false WHERE id = ?'
        ).bind(subscription_record.user_id).run();
      }
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription updated webhook processed'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error handling subscription updated webhook:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle successful payment webhook
 */
async function handlePaymentSuccessWebhook(env, webhookEvent) {
  try {
    const invoice = webhookEvent.data.object.invoice;
    const subscriptionId = invoice.subscriptionId;
    
    console.log(`Payment successful for subscription: ${subscriptionId}`);
    
    // Update payment history and ensure user has active access
    const subscription = await env.DB.prepare(
      'SELECT user_id FROM subscriptions WHERE square_subscription_id = ?'
    ).bind(subscriptionId).first();
    
    if (subscription) {
      // Ensure user has active access
      await env.DB.prepare(
        'UPDATE users SET subscription_active = true WHERE id = ?'
      ).bind(subscription.user_id).run();
      
      // Log successful payment
      await env.DB.prepare(
        `INSERT INTO payments 
         (user_id, subscription_id, amount, currency, status, square_payment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime("now"))`
      ).bind(
        subscription.user_id,
        subscription.square_subscription_id,
        invoice.totalMoney?.amount || 0,
        invoice.totalMoney?.currency || 'GBP',
        'SUCCESS',
        invoice.id
      ).run();
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Payment success webhook processed'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error handling payment success webhook:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle failed payment webhook  
 */
async function handlePaymentFailedWebhook(env, webhookEvent) {
  try {
    const invoice = webhookEvent.data.object.invoice;
    const subscriptionId = invoice.subscriptionId;
    
    console.log(`Payment failed for subscription: ${subscriptionId}`);
    
    // Find subscription and user
    const subscription = await env.DB.prepare(
      'SELECT user_id FROM subscriptions WHERE square_subscription_id = ?'
    ).bind(subscriptionId).first();
    
    if (subscription) {
      // Log failed payment
      await env.DB.prepare(
        `INSERT INTO payments 
         (user_id, subscription_id, amount, currency, status, square_payment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime("now"))`
      ).bind(
        subscription.user_id,
        subscription.square_subscription_id,
        invoice.totalMoney?.amount || 0,
        invoice.totalMoney?.currency || 'GBP',
        'FAILED',
        invoice.id
      ).run();
      
      // Potentially suspend access after multiple failures
      // This could be enhanced with retry logic
      console.log(`Payment failure recorded for user ${subscription.user_id}`);
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Payment failure webhook processed'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error handling payment failed webhook:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
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
      'Access-Control-Allow-Headers': 'Content-Type, x-square-signature'
    }
  });
}
