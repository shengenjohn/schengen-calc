/**
 * Get Square Subscription Plans - Using direct API calls
 */
export async function onRequestGet({ request, env, params }) {
  try {
    // Direct Square API call instead of SDK
    const response = await fetch('https://connect.squareup.com/v2/catalog/list?types=SUBSCRIPTION_PLAN', {
      method: 'GET',
      headers: {
        'Square-Version': '2023-10-18',
        'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Square API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
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
