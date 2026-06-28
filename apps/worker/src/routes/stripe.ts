import { Hono } from 'hono';
import {
  getStripeEvents,
  getStripeEventByStripeId,
  createStripeEvent,
  jstNow,
  getFriendByLineUserId,
} from '@line-crm/db';
import type { Env } from '../index.js';

const stripe = new Hono<Env>();

interface StripeWebhookBody {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
      customer?: string;
      status?: string;
    };
  };
}

interface CreateCheckoutSessionBody {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  lineHarnessFriendId?: string;
  lineUserId?: string;
  productId: string;
  offerId: string;
  refCode: string;
  mode?: 'payment' | 'subscription';
  quantity?: number;
  stripeCustomerId?: string;
  customerEmail?: string;
  campaignId?: string;
  entryScenarioId?: string;
  entryFormId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  allowPromotionCodes?: boolean;
}

function buildStripeMetadata(body: CreateCheckoutSessionBody): Record<string, string> {
  const metadata = {
    lineHarnessFriendId: body.lineHarnessFriendId,
    lineUserId: body.lineUserId,
    stripeCustomerId: body.stripeCustomerId,
    productId: body.productId,
    offerId: body.offerId,
    refCode: body.refCode,
    campaignId: body.campaignId,
    entryScenarioId: body.entryScenarioId,
    entryFormId: body.entryFormId,
    utmSource: body.utmSource,
    utmMedium: body.utmMedium,
    utmCampaign: body.utmCampaign,
    utmContent: body.utmContent,
  };

  return Object.fromEntries(
    Object.entries(metadata).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  );
}

async function createStripeCheckoutSession(
  secretKey: string,
  body: CreateCheckoutSessionBody,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  params.set('mode', body.mode ?? 'payment');
  params.set('success_url', body.successUrl);
  params.set('cancel_url', body.cancelUrl);
  params.set('client_reference_id', body.lineHarnessFriendId);
  params.set('line_items[0][price]', body.priceId);
  params.set('line_items[0][quantity]', String(body.quantity ?? 1));

  if (body.stripeCustomerId) {
    params.set('customer', body.stripeCustomerId);
  } else if (body.customerEmail) {
    params.set('customer_email', body.customerEmail);
  }

  if (body.allowPromotionCodes) {
    params.set('allow_promotion_codes', 'true');
  }

  const metadata = buildStripeMetadata(body);
  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, value);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

// ========== Stripeイベント一覧 ==========

stripe.get('/api/integrations/stripe/events', async (c) => {
  try {
    const friendId = c.req.query('friendId') ?? undefined;
    const eventType = c.req.query('eventType') ?? undefined;
    const limit = Number(c.req.query('limit') ?? '100');
    const items = await getStripeEvents(c.env.DB, { friendId, eventType, limit });
    return c.json({
      success: true,
      data: items.map((e) => ({
        id: e.id,
        stripeEventId: e.stripe_event_id,
        eventType: e.event_type,
        friendId: e.friend_id,
        amount: e.amount,
        currency: e.currency,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        processedAt: e.processed_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/integrations/stripe/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== Checkout Session作成 ==========

stripe.post('/api/integrations/stripe/checkout-sessions', async (c) => {
  try {
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return c.json({ success: false, error: 'STRIPE_SECRET_KEY is not configured' }, 500);
    }

    const body = await c.req.json<CreateCheckoutSessionBody>();
    let lineHarnessFriendId = body.lineHarnessFriendId;

    if (!lineHarnessFriendId && body.lineUserId) {
      const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
      if (friend) {
        lineHarnessFriendId = friend.id;
      }
    }

    if (
      !body.priceId ||
      !body.successUrl ||
      !body.cancelUrl ||
      !lineHarnessFriendId ||
      !body.productId ||
      !body.offerId ||
      !body.refCode
    ) {
      return c.json({ success: false, error: 'Missing required checkout session fields' }, 400);
    }

    if (!body.stripeCustomerId && !body.customerEmail) {
      return c.json({ success: false, error: 'stripeCustomerId or customerEmail is required' }, 400);
    }

    const payload = { ...body, lineHarnessFriendId };
    const session = await createStripeCheckoutSession(secretKey, payload);

    return c.json({
      success: true,
      data: {
        id: session.id,
        url: session.url,
        mode: session.mode,
        customer: session.customer,
        clientReferenceId: session.client_reference_id,
        metadata: session.metadata ?? buildStripeMetadata(payload),
      },
    });
  } catch (err) {
    console.error('POST /api/integrations/stripe/checkout-sessions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== Stripe Webhookレシーバー ==========

/** Stripe署名検証 */
async function verifyStripeSignature(secret: string, rawBody: string, sigHeader: string): Promise<boolean> {
  // Stripe署名形式: t=timestamp,v1=signature
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k, v.join('=')];
    }),
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedSig === expectedSig;
}

stripe.post('/api/integrations/stripe/webhook', async (c) => {
  try {
    const stripeSecret = (c.env as unknown as Record<string, string | undefined>).STRIPE_WEBHOOK_SECRET;
    let body: StripeWebhookBody;

    if (stripeSecret) {
      // 署名検証モード（本番環境）
      const sigHeader = c.req.header('Stripe-Signature') ?? '';
      const rawBody = await c.req.text();

      const valid = await verifyStripeSignature(stripeSecret, rawBody, sigHeader);
      if (!valid) {
        return c.json({ success: false, error: 'Stripe signature verification failed' }, 401);
      }
      body = JSON.parse(rawBody) as StripeWebhookBody;
    } else {
      // シークレット未設定（開発環境向け）
      body = await c.req.json<StripeWebhookBody>();
    }

    // 冪等性チェック
    const existing = await getStripeEventByStripeId(c.env.DB, body.id);
    if (existing) {
      return c.json({ success: true, data: { message: 'Already processed' } });
    }

    const obj = body.data.object;
    const db = c.env.DB;

    // メタデータからfriendIdを取得（Stripeのメタデータにline_friend_idを設定している想定）
    const friendId = obj.metadata?.line_friend_id ?? null;

    // イベントを記録
    const event = await createStripeEvent(db, {
      stripeEventId: body.id,
      eventType: body.type,
      friendId: friendId ?? undefined,
      amount: obj.amount,
      currency: obj.currency,
      metadata: JSON.stringify(obj.metadata ?? {}),
    });

    // 決済成功時の自動処理
    if (body.type === 'payment_intent.succeeded' && friendId) {
      const { applyScoring } = await import('@line-crm/db');
      await applyScoring(db, friendId, 'purchase');

      // 自動タグ付け（product_idベース）
      const productId = obj.metadata?.product_id;
      if (productId) {
        const tag = await db
          .prepare(`SELECT id FROM tags WHERE name = ?`)
          .bind(`purchased_${productId}`)
          .first<{ id: string }>();
        if (tag) {
          await db
            .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
            .bind(friendId, tag.id, jstNow())
            .run();
        }
      }

      // イベントバスに発火（自動化ルール用）
      const { fireEvent } = await import('../services/event-bus.js');
      await fireEvent(db, 'cv_fire', { friendId, eventData: { type: 'purchase', amount: obj.amount, stripeEventId: body.id } });
    }

    // サブスクリプションイベント処理
    if (body.type === 'customer.subscription.deleted' && friendId) {
      const cancelledTag = await db
        .prepare(`SELECT id FROM tags WHERE name = 'subscription_cancelled'`)
        .first<{ id: string }>();
      if (cancelledTag) {
        await db
          .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
          .bind(friendId, cancelledTag.id, jstNow())
          .run();
      }
    }

    return c.json({
      success: true,
      data: { id: event.id, stripeEventId: event.stripe_event_id, eventType: event.event_type, processedAt: event.processed_at },
    });
  } catch (err) {
    console.error('POST /api/integrations/stripe/webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { stripe };
