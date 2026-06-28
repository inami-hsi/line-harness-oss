/**
 * LINE Harness Plugin: Stripe
 *
 * Cloudflare Worker that syncs Stripe customer/subscription state into
 * LINE Harness and reacts to Stripe webhooks for evergreen launch flows.
 */

import { LineHarness, type Friend } from '@line-harness/sdk'
import { syncExternalData } from './sync.js'
import { checkAndNotify } from './notify.js'

type JsonRecord = Record<string, unknown>

interface StripeEventEnvelope extends JsonRecord {
  id?: string
  type?: string
  data?: {
    object?: JsonRecord
  }
}

export interface Env {
  LINE_HARNESS_API_URL: string
  LINE_HARNESS_API_KEY: string
  STRIPE_SECRET_KEY: string
  LINE_ACCOUNT_ID?: string
  STRIPE_WEBHOOK_SECRET?: string
}

function createHarness(env: Env): LineHarness {
  return new LineHarness({
    apiUrl: env.LINE_HARNESS_API_URL,
    apiKey: env.LINE_HARNESS_API_KEY,
    lineAccountId: env.LINE_ACCOUNT_ID,
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getEventObject(payload: StripeEventEnvelope): JsonRecord {
  return isRecord(payload.data?.object) ? payload.data.object : {}
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function getStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry
    }
  }
  return result
}

async function ensureTag(harness: LineHarness, name: string, color: string): Promise<string> {
  const tags = await harness.tags.list()
  const existing = tags.find((tag) => tag.name === name)
  if (existing) return existing.id
  const created = await harness.tags.create({ name, color })
  return created.id
}

async function verifyStripeSignature(
  secret: string,
  rawBody: string,
  sigHeader: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    sigHeader.split(',').map((part) => {
      const [key, ...rest] = part.split('=')
      return [key, rest.join('=')]
    }),
  )

  const timestamp = parts.t
  const expectedSig = parts.v1
  if (!timestamp || !expectedSig) return false

  const payload = `${timestamp}.${rawBody}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  )

  const computed = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return computed === expectedSig
}

async function findFriendByStripeCustomerId(
  harness: LineHarness,
  stripeCustomerId: string,
): Promise<Friend | null> {
  let offset = 0
  const limit = 100

  while (true) {
    const page = await harness.friends.list({ limit, offset })
    const friend = page.items.find(
      (item) => item.metadata?.stripeCustomerId === stripeCustomerId,
    )
    if (friend) return friend
    if (!page.hasNextPage) return null
    offset += limit
  }
}

async function resolveFriendFromStripeObject(
  harness: LineHarness,
  object: JsonRecord,
): Promise<Friend | null> {
  const metadata = getStringRecord(object.metadata)
  const directFriendId = metadata.lineHarnessFriendId ?? metadata.friendId
  if (directFriendId) {
    try {
      return await harness.friends.get(directFriendId)
    } catch {
      return null
    }
  }

  const stripeCustomerId = getString(object.customer) ?? metadata.stripeCustomerId
  if (stripeCustomerId) {
    return findFriendByStripeCustomerId(harness, stripeCustomerId)
  }

  return null
}

async function handleCheckoutCompleted(
  harness: LineHarness,
  object: JsonRecord,
): Promise<JsonRecord> {
  const friend = await resolveFriendFromStripeObject(harness, object)
  if (!friend) return { handled: false, reason: 'friend_not_found' }

  const metadata = getStringRecord(object.metadata)
  await harness.friends.setMetadata(friend.id, {
    stripeCheckoutSessionId: getString(object.id),
    stripeCustomerId: getString(object.customer) ?? metadata.stripeCustomerId ?? null,
    stripeLastCheckoutMode: getString(object.mode),
    stripeLastProductId: metadata.productId ?? metadata.product_id ?? null,
  })

  const purchasedTagId = await ensureTag(harness, 'stripe:checkout-completed', '#16A34A')
  await harness.friends.addTag(friend.id, purchasedTagId)
  await harness.sendTextToFriend(friend.id, 'お申し込みありがとうございます。決済が完了しました。')

  return { handled: true, action: 'checkout_completed', friendId: friend.id }
}

async function handleInvoicePaymentFailed(
  harness: LineHarness,
  object: JsonRecord,
): Promise<JsonRecord> {
  const friend = await resolveFriendFromStripeObject(harness, object)
  if (!friend) return { handled: false, reason: 'friend_not_found' }

  const failedTagId = await ensureTag(harness, 'stripe:payment-failed', '#DC2626')
  await harness.friends.addTag(friend.id, failedTagId)
  await harness.friends.setMetadata(friend.id, {
    stripeLatestInvoiceId: getString(object.id),
    stripeLatestInvoiceStatus: getString(object.status),
    stripeAmountDue: object.amount_due ?? null,
    stripeHostedInvoiceUrl: getString(object.hosted_invoice_url),
  })

  const amountDue = typeof object.amount_due === 'number'
    ? `${(object.amount_due / 100).toLocaleString('ja-JP')} ${(getString(object.currency) ?? 'JPY').toUpperCase()}`
    : null

  const message = [
    'お支払いの確認がまだ完了していません。',
    amountDue ? `請求額: ${amountDue}` : null,
    getString(object.hosted_invoice_url) ? `お支払いURL: ${getString(object.hosted_invoice_url)}` : null,
  ].filter(Boolean).join('\n')

  await harness.sendTextToFriend(friend.id, message)
  return { handled: true, action: 'invoice_payment_failed', friendId: friend.id }
}

async function handleSubscriptionUpdated(
  harness: LineHarness,
  object: JsonRecord,
): Promise<JsonRecord> {
  const friend = await resolveFriendFromStripeObject(harness, object)
  if (!friend) return { handled: false, reason: 'friend_not_found' }

  const status = getString(object.status) ?? 'unknown'
  await harness.friends.setMetadata(friend.id, {
    stripeSubscriptionId: getString(object.id),
    stripeSubscriptionStatus: status,
    stripeCancelAtPeriodEnd: object.cancel_at_period_end ?? null,
    stripeCurrentPeriodEnd: typeof object.current_period_end === 'number'
      ? new Date(object.current_period_end * 1000).toISOString()
      : null,
  })

  const statusTagId = await ensureTag(harness, `stripe:subscription:${status}`, '#7C3AED')
  await harness.friends.addTag(friend.id, statusTagId)
  return { handled: true, action: 'subscription_updated', friendId: friend.id, status }
}

async function processStripeEvent(
  payload: StripeEventEnvelope,
  env: Env,
): Promise<JsonRecord> {
  const eventType = getString(payload.type)
  if (!eventType) return { handled: false, reason: 'missing_event_type' }

  const harness = createHarness(env)
  const object = getEventObject(payload)

  switch (eventType) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(harness, object)

    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(harness, object)

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return handleSubscriptionUpdated(harness, object)

    default:
      console.log(`[Stripe Plugin] Unhandled event type: ${eventType}`)
      return { handled: false, reason: 'unhandled_event_type', eventType }
  }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log('[Stripe Plugin] Cron triggered')
    await syncExternalData(env)
    await checkAndNotify(env)
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', plugin: 'stripe' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const rawBody = await request.text()

        if (env.STRIPE_WEBHOOK_SECRET) {
          const signature = request.headers.get('Stripe-Signature') ?? ''
          const valid = await verifyStripeSignature(
            env.STRIPE_WEBHOOK_SECRET,
            rawBody,
            signature,
          )

          if (!valid) {
            return new Response(JSON.stringify({ error: 'Invalid Stripe signature' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
          }
        }

        const payload = JSON.parse(rawBody) as StripeEventEnvelope
        const result = await processStripeEvent(payload, env)

        return new Response(JSON.stringify({ received: true, ...result }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        console.error('[Stripe Plugin] Webhook error:', error)
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
}
