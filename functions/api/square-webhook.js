/**
 * Schengen Calc - Square Webhook Handler (Simplified)
 * POST /api/square-webhook
 */

export async function onRequestPost({ request, env, params }) {
  try {
    // Get webhook body
    const webhookBody = await request.text();
    const webhookSignature = request.headers.get('x-square-signature');
    
    // For now, just log and return success
    console.log('Square webhook received:', webhookBody?.substring(0, 100));
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook received successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error processing Square webhook:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: 'Webhook processing failed'
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
