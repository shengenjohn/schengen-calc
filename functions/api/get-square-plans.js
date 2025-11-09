/**
 * Get Square Subscription Plans - Debug endpoint
 */
import { Client, Environment } from 'squareup';

export async function onRequestGet({ request, env, params }) {
  try {
    const client = new Client({
      accessToken: env.SQUARE_ACCESS_TOKEN,
      environment: env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
      applicationId: env.SQUARE_APPLICATION_ID
    });
    
    const catalogApi = client.catalogApi;
    const { result } = await catalogApi.listCatalog(undefined, 'SUBSCRIPTION_PLAN');
    
    return new Response(JSON.stringify({
      success: true,
      plans: result.objects || [],
      message: "Square subscription plans fetched successfully"
    }, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
