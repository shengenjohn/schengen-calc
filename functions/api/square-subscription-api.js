/**
 * Schengen Calc - Square Subscription API Integration
 * Handles subscription creation, management, and webhooks
 */

import { Client, Environment, ApiError } from 'squareup';

/**
 * Initialize Square client with environment variables
 */
function initSquareClient(env) {
  const client = new Client({
    accessToken: env.SQUARE_ACCESS_TOKEN,
    environment: env.SQUARE_ENVIRONMENT === 'production' 
      ? Environment.Production 
      : Environment.Sandbox,
    applicationId: env.SQUARE_APPLICATION_ID
  });
  
  return client;
}

/**
 * Get available subscription plans from Square
 */
export async function getSubscriptionPlans(env) {
  try {
    const client = initSquareClient(env);
    const catalogApi = client.catalogApi;
    
    const { result } = await catalogApi.listCatalog(undefined, 'SUBSCRIPTION_PLAN');
    
    return {
      success: true,
      plans: result.objects || []
    };
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    return {
      success: false,
      error: error.message || 'Failed to fetch subscription plans'
    };
  }
}

/**
 * Create a new customer in Square
 */
export async function createSquareCustomer(env, customerData) {
  try {
    const client = initSquareClient(env);
    const customersApi = client.customersApi;
    
    const { result } = await customersApi.createCustomer({
      givenName: customerData.firstName,
      familyName: customerData.lastName,
      emailAddress: customerData.email,
      referenceId: customerData.userId // Link to our internal user ID
    });
    
    return {
      success: true,
      customer: result.customer
    };
  } catch (error) {
    console.error('Error creating Square customer:', error);
    return {
      success: false,
      error: error.message || 'Failed to create customer'
    };
  }
}

/**
 * Create a subscription for a customer
 */
export async function createSubscription(env, subscriptionData) {
  try {
    const client = initSquareClient(env);
    const subscriptionsApi = client.subscriptionsApi;
    
    const subscriptionRequest = {
      idempotencyKey: `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      locationId: subscriptionData.locationId,
      planId: subscriptionData.planId,
      customerId: subscriptionData.customerId,
      startDate: new Date().toISOString().split('T')[0], // Today's date
      taxPercentage: subscriptionData.taxPercentage || '0',
      priceOverrideMoney: subscriptionData.priceOverride ? {
        amount: subscriptionData.priceOverride,
        currency: 'GBP'
      } : undefined,
      cardId: subscriptionData.cardId, // Payment method
      timezone: 'Europe/London'
    };
    
    const { result } = await subscriptionsApi.createSubscription(subscriptionRequest);
    
    return {
      success: true,
      subscription: result.subscription
    };
  } catch (error) {
    console.error('Error creating subscription:', error);
    return {
      success: false,
      error: error.message || 'Failed to create subscription'
    };
  }
}

/**
 * Update subscription (pause, resume, cancel)
 */
export async function updateSubscription(env, subscriptionId, action, reason = null) {
  try {
    const client = initSquareClient(env);
    const subscriptionsApi = client.subscriptionsApi;
    
    let result;
    
    switch (action) {
      case 'pause':
        result = await subscriptionsApi.pauseSubscription(subscriptionId, {
          pauseEffectiveDate: new Date().toISOString().split('T')[0],
          pauseReason: reason || 'CUSTOMER_CHOICE'
        });
        break;
        
      case 'resume':
        result = await subscriptionsApi.resumeSubscription(subscriptionId, {
          resumeEffectiveDate: new Date().toISOString().split('T')[0],
          resumeReason: reason || 'CUSTOMER_CHOICE'
        });
        break;
        
      case 'cancel':
        result = await subscriptionsApi.cancelSubscription(subscriptionId);
        break;
        
      default:
        throw new Error(`Invalid action: ${action}`);
    }
    
    return {
      success: true,
      subscription: result.result.subscription
    };
  } catch (error) {
    console.error(`Error ${action} subscription:`, error);
    return {
      success: false,
      error: error.message || `Failed to ${action} subscription`
    };
  }
}

/**
 * Get subscription details
 */
export async function getSubscription(env, subscriptionId) {
  try {
    const client = initSquareClient(env);
    const subscriptionsApi = client.subscriptionsApi;
    
    const { result } = await subscriptionsApi.retrieveSubscription(subscriptionId);
    
    return {
      success: true,
      subscription: result.subscription
    };
  } catch (error) {
    console.error('Error retrieving subscription:', error);
    return {
      success: false,
      error: error.message || 'Failed to retrieve subscription'
    };
  }
}

/**
 * Handle Square webhook events
 */
export async function handleSquareWebhook(env, webhookBody, webhookSignature) {
  try {
    // Verify webhook signature here (implement signature verification)
    const event = JSON.parse(webhookBody);
    
    console.log('Square webhook received:', event.type);
    
    switch (event.type) {
      case 'subscription.created':
        return await handleSubscriptionCreated(env, event.data.object.subscription);
        
      case 'subscription.updated':
        return await handleSubscriptionUpdated(env, event.data.object.subscription);
        
      case 'invoice.payment_made':
        return await handlePaymentMade(env, event.data.object.invoice);
        
      case 'invoice.payment_failed':
        return await handlePaymentFailed(env, event.data.object.invoice);
        
      default:
        console.log(`Unhandled webhook event: ${event.type}`);
        return { success: true, message: 'Event not handled' };
    }
  } catch (error) {
    console.error('Error handling Square webhook:', error);
    return {
      success: false,
      error: error.message || 'Failed to handle webhook'
    };
  }
}

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(env, subscription) {
  try {
    // Update user's subscription status in D1 database
    const userId = subscription.customerId; // You may need to map this to internal user ID
    
    // This would update your D1 database
    // await updateUserSubscriptionStatus(env.DB, userId, 'active', subscription);
    
    console.log(`Subscription created for customer ${subscription.customerId}`);
    return { success: true };
  } catch (error) {
    console.error('Error handling subscription created:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(env, subscription) {
  try {
    // Update user's subscription status in D1 database
    const userId = subscription.customerId;
    const status = subscription.status.toLowerCase();
    
    console.log(`Subscription ${subscription.id} updated to ${status}`);
    return { success: true };
  } catch (error) {
    console.error('Error handling subscription updated:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle payment made event
 */
async function handlePaymentMade(env, invoice) {
  try {
    console.log(`Payment successful for invoice ${invoice.id}`);
    
    // Update subscription access, send confirmation email, etc.
    return { success: true };
  } catch (error) {
    console.error('Error handling payment made:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle payment failed event
 */
async function handlePaymentFailed(env, invoice) {
  try {
    console.log(`Payment failed for invoice ${invoice.id}`);
    
    // Send payment failure notification, update access, etc.
    return { success: true };
  } catch (error) {
    console.error('Error handling payment failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get Square location ID (needed for subscriptions)
 */
export async function getSquareLocation(env) {
  try {
    const client = initSquareClient(env);
    const locationsApi = client.locationsApi;
    
    const { result } = await locationsApi.listLocations();
    
    // Return the first active location
    const activeLocation = result.locations?.find(loc => loc.status === 'ACTIVE');
    
    return {
      success: true,
      location: activeLocation
    };
  } catch (error) {
    console.error('Error fetching Square location:', error);
    return {
      success: false,
      error: error.message || 'Failed to fetch location'
    };
  }
}
