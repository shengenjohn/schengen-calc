/**
 * Schengen Calc - Create Subscription API Endpoint (Simplified)
 * POST /api/create-subscription
 */

export async function onRequestPost({ request, env, params }) {
  try {
    const requestData = await request.json();
    
    // Basic validation
    const requiredFields = ['email', 'firstName', 'lastName', 'planType'];
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
    
    // For now, just return success response
    // We'll add Square integration after basic deployment works
    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription endpoint working',
      data: requestData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
