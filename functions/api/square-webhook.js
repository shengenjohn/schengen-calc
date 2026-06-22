/**
 * Schengen Calc — Square Webhook Handler
 * Cloudflare Pages Function · POST /api/square-webhook
 *
 * Replaces the previous stub. This version:
 *   1. Verifies Square's HMAC-SHA256 signature (rejects forged events).
 *   2. Maps the event back to a D1 user (by buyer email, then by stored Square customer ID).
 *   3. Flips users.subscription_active and writes subscriptions / payments rows.
 *
 * Confirmed against Square docs (Jun 2026):
 *   - Header: x-square-hmacsha256-signature
 *   - Signature = base64( HMAC-SHA256( signatureKey, notificationURL + rawBody ) )
 *   - Suspension comes from subscription.updated -> DEACTIVATED/CANCELED, NOT a failure event.
 *
 * REQUIRES two environment variables (set via Pages dashboard or wrangler):
 *   SQUARE_WEBHOOK_SIGNATURE_KEY  — the signature key from the Square webhook subscription
 *   SQUARE_WEBHOOK_URL            — the EXACT notification URL configured in Square
 *                                  (must match character-for-character, incl. trailing slash)
 *
 * D1 binding in Pages Functions context is `DB` (same as auth-api / test-db).
 *
 * NOTE: the exact nested field paths below are extracted from Square's documented
 * payloads, but Square payloads vary by event/version. The handler logs the full raw
 * event so you can confirm the real shape against your FIRST live deliveries in the
 * Pages logs, and adjust the extract* helpers if anything sits in a different place.
 */

// Your four live Square plan-variation IDs -> internal plan/frequency labels.
const PLAN_VARIATIONS = {
  DQ3KFFL36KY3CNYSVIPTE7KX: { plan_type: 'pro',      frequency: 'monthly' },
  TETWEGEEMWRIG4Q6WNM4RQYA: { plan_type: 'pro',      frequency: 'yearly'  },
  RZNISSIWZLDP75SVWUB7AC6N: { plan_type: 'business', frequency: 'monthly' },
  GO6N6ZZJXIDEZU3NTJQNWXIF: { plan_type: 'business', frequency: 'yearly'  },
};

export async function onRequestPost({ request, env }) {
  // Read the RAW body exactly as received — required for signature verification.
  const rawBody = await request.text();
  const signature = request.headers.get('x-square-hmacsha256-signature');

  // 1) Verify authenticity. Fail closed.
  const ok = await isValidSquareSignature(
    rawBody,
    signature,
    env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    env.SQUARE_WEBHOOK_URL
  );
  if (!ok) {
    console.warn('⛔ Square webhook signature invalid — rejected');
    return json({ success: false, error: 'invalid signature' }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ success: false, error: 'bad json' }, 400);
  }

  console.log(`📨 Square event: ${event.type} (${event.event_id})`);

  try {
    switch (event.type) {
      case 'payment.created':
      case 'payment.updated':
        await handlePayment(env, event);
        break;

      case 'invoice.payment_made':
        await handleInvoicePaymentMade(env, event);
        break;

      case 'subscription.created':
      case 'subscription.updated':
        await handleSubscriptionChange(env, event);
        break;

      default:
        // Acknowledge everything else with 200 so Square stops retrying,
        // but log it in case it's something we should handle later.
        console.log(`ℹ️ Unhandled event ${event.type} — full payload:`, rawBody);
    }
  } catch (err) {
    // Log full event on error so you can see the real shape, but still 200
    // unless it's a transient DB issue you'd want Square to retry.
    console.error(`Error handling ${event.type}:`, err, '\nRAW:', rawBody);
    return json({ success: false, error: 'processing error' }, 500);
  }

  // Square requires a prompt 2xx to mark the event delivered.
  return json({ success: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-square-hmacsha256-signature',
    },
  });
}

/* ───────────────────────── signature verification ───────────────────────── */

async function isValidSquareSignature(body, signature, signatureKey, notificationUrl) {
  if (!signature || !signatureKey || !notificationUrl) {
    console.warn('Signature check skipped: missing signature, key, or URL env var');
    return false;
  }
  // Square signs the concatenation of the notification URL and the raw body.
  const payload = notificationUrl + body;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return constantTimeEqual(expected, signature);
}

// Length-checked constant-time-ish comparison to avoid timing leaks.
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ───────────────────────────── event handlers ───────────────────────────── */

async function handlePayment(env, event) {
  const payment = event?.data?.object?.payment || {};
  // Only act on a settled payment.
  const status = (payment.status || '').toUpperCase();
  if (status && status !== 'COMPLETED' && status !== 'APPROVED') {
    console.log(`Payment ${payment.id} status ${status} — not granting yet`);
    return;
  }

  const email = (payment.buyer_email_address || '').toLowerCase();
  const customerId = payment.customer_id || null;
  const amount = payment?.amount_money?.amount ?? null;     // integer pennies
  const currency = payment?.amount_money?.currency || 'GBP';
  const squarePaymentId = payment.id || null;

  const user = await findUser(env, email, customerId);
  if (!user) {
    console.warn(`No user match for payment ${squarePaymentId} (email=${email}, customer=${customerId}). Logged for manual review.`);
    return;
  }

  // Store the Square customer id so subscription-only events can map back later.
  if (customerId && !user.square_customer_id) {
    await env.DB.prepare('UPDATE users SET square_customer_id = ? WHERE id = ?')
      .bind(customerId, user.id).run();
  }

  // Grant access.
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 1, subscription_status = 'active', updated_at = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  // Record the payment (idempotent on square_payment_id).
  await recordPayment(env, {
    user_id: user.id,
    subscription_id: null,
    amount,
    currency,
    status: 'COMPLETED',
    square_payment_id: squarePaymentId,
    failure_reason: null,
  });

  console.log(`✅ Access granted to user ${user.id} (${user.email}) from payment ${squarePaymentId}`);
}

async function handleInvoicePaymentMade(env, event) {
  const invoice = event?.data?.object?.invoice || {};
  const subscriptionId = invoice.subscription_id || null;
  const recipient = invoice.primary_recipient || {};
  const email = (recipient.email_address || '').toLowerCase();
  const customerId = recipient.customer_id || null;
  const pr = Array.isArray(invoice.payment_requests) ? invoice.payment_requests[0] : null;
  const amount = pr?.computed_amount_money?.amount ?? null;
  const currency = pr?.computed_amount_money?.currency || 'GBP';

  // Map by subscription first (renewals), then email, then customer id.
  let user = null;
  if (subscriptionId) {
    const sub = await env.DB.prepare(
      'SELECT user_id FROM subscriptions WHERE square_subscription_id = ?'
    ).bind(subscriptionId).first();
    if (sub) user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(sub.user_id).first();
  }
  if (!user) user = await findUser(env, email, customerId);
  if (!user) {
    console.warn(`No user match for invoice ${invoice.id} (sub=${subscriptionId}, email=${email}). Logged for manual review.`);
    return;
  }

  await env.DB.prepare(
    "UPDATE users SET subscription_active = 1, subscription_status = 'active', updated_at = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  await recordPayment(env, {
    user_id: user.id,
    subscription_id: subscriptionId,
    amount,
    currency,
    status: 'COMPLETED',
    square_payment_id: invoice.id || null,
    failure_reason: null,
  });

  console.log(`✅ Renewal recorded + access kept for user ${user.id} (invoice ${invoice.id})`);
}

async function handleSubscriptionChange(env, event) {
  const sub = event?.data?.object?.subscription || {};
  const squareSubId = sub.id || null;
  const customerId = sub.customer_id || null;
  const status = (sub.status || '').toUpperCase(); // ACTIVE, PAUSED, CANCELED, DEACTIVATED
  const variation = PLAN_VARIATIONS[sub.plan_variation_id] || {};
  const planType = variation.plan_type || sub.plan_variation_id || 'unknown';
  const frequency = variation.frequency || 'unknown';

  // Subscription events only carry customer_id — map via stored square_customer_id.
  let user = null;
  if (customerId) {
    user = await env.DB.prepare('SELECT * FROM users WHERE square_customer_id = ?')
      .bind(customerId).first();
  }
  if (!user && squareSubId) {
    const existing = await env.DB.prepare(
      'SELECT user_id FROM subscriptions WHERE square_subscription_id = ?'
    ).bind(squareSubId).first();
    if (existing) user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(existing.user_id).first();
  }
  if (!user) {
    console.warn(`No user match for subscription ${squareSubId} (customer=${customerId}). Will map once a payment event links the customer id.`);
    return;
  }

  // Upsert the subscriptions row (square_subscription_id is UNIQUE).
  await env.DB.prepare(
    `INSERT INTO subscriptions
       (user_id, square_subscription_id, plan_type, status, price_amount, currency, frequency, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'GBP', ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(square_subscription_id) DO UPDATE SET
       status = excluded.status,
       plan_type = excluded.plan_type,
       frequency = excluded.frequency,
       updated_at = datetime('now')`
  ).bind(
    user.id,
    squareSubId,
    planType,
    status,
    0,                       // price set from payment events; 0 placeholder on subscription event
    frequency,
    sub.start_date || null
  ).run();

  // Active vs. suspended.
  const activeStatuses = ['ACTIVE', 'PENDING'];
  const isActive = activeStatuses.includes(status);
  await env.DB.prepare(
    "UPDATE users SET subscription_active = ?, subscription_status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(isActive ? 1 : 0, isActive ? 'active' : status.toLowerCase(), user.id).run();

  console.log(`🔄 Subscription ${squareSubId} -> ${status}; user ${user.id} active=${isActive ? 1 : 0}`);
}

/* ───────────────────────────────── helpers ──────────────────────────────── */

// Find a user by email first, then by stored Square customer id.
async function findUser(env, email, customerId) {
  if (email) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (u) return u;
  }
  if (customerId) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE square_customer_id = ?').bind(customerId).first();
    if (u) return u;
  }
  return null;
}

// Insert a payment row, guarded so duplicate Square deliveries don't double-record.
async function recordPayment(env, p) {
  if (p.square_payment_id) {
    const dupe = await env.DB.prepare(
      'SELECT id FROM payments WHERE square_payment_id = ?'
    ).bind(p.square_payment_id).first();
    if (dupe) {
      console.log(`Payment ${p.square_payment_id} already recorded — skipping insert`);
      return;
    }
  }
  await env.DB.prepare(
    `INSERT INTO payments
       (user_id, subscription_id, amount, currency, status, square_payment_id, failure_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    p.user_id,
    p.subscription_id,
    p.amount ?? 0,
    p.currency || 'GBP',
    p.status || 'COMPLETED',
    p.square_payment_id,
    p.failure_reason
  ).run();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
