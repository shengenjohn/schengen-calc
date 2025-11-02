export async function onRequest(context) {
  try {
    const { DB } = context.env;
    
    // Test database connection
    const plansQuery = await DB.prepare(
      "SELECT * FROM subscription_plans ORDER BY price_monthly"
    ).all();
    
    const usersQuery = await DB.prepare(
      "SELECT id, email, first_name, subscription_status, created_at FROM users"
    ).all();
    
    const complianceQuery = await DB.prepare(
      "SELECT COUNT(*) as count FROM compliance_requirements"
    ).first();
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Database connected via GitHub + D1!',
      data: {
        subscription_plans: plansQuery.results,
        users: usersQuery.results,
        compliance_count: complianceQuery.count,
        timestamp: new Date().toISOString()
      }
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
