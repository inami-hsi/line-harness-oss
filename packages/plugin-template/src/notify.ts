/**
 * Stripe-triggered evergreen launch notifications.
 *
 * Good starter automations:
 * - Payment failed follow-up
 * - Trial ending reminder
 */

import { LineHarness, type Friend } from '@line-harness/sdk'
import { StripeClient } from './external-api.js'
import type { Env } from './index.js'

function createClients(env: Env) {
  const harness = new LineHarness({
    apiUrl: env.LINE_HARNESS_API_URL,
    apiKey: env.LINE_HARNESS_API_KEY,
    lineAccountId: env.LINE_ACCOUNT_ID,
  })
  const stripe = new StripeClient(env.STRIPE_SECRET_KEY)
  return { harness, stripe }
}

async function ensureTag(harness: LineHarness, name: string, color: string): Promise<string> {
  const tags = await harness.tags.list()
  const existing = tags.find((tag) => tag.name === name)
  if (existing) return existing.id
  const created = await harness.tags.create({ name, color })
  return created.id
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

function diffInDays(isoString: string): number {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  return Math.ceil((then - now) / (1000 * 60 * 60 * 24))
}

async function notifyTrialEnding(
  harness: LineHarness,
  stripe: StripeClient,
): Promise<void> {
  const subscriptions = await stripe.listSubscriptions('all', 100)
  const reminderTagId = await ensureTag(harness, 'stripe:trial-ending-reminded', '#F59E0B')

  for (const subscription of subscriptions) {
    if (subscription.status !== 'trialing' || !subscription.trialEnd) continue
    const daysLeft = diffInDays(subscription.trialEnd)
    if (daysLeft < 0 || daysLeft > 3) continue

    const friend = await findFriendByStripeCustomerId(harness, subscription.customer)
    if (!friend) continue

    if (friend.tags.some((tag) => tag.name === 'stripe:trial-ending-reminded')) {
      continue
    }

    await harness.friends.addTag(friend.id, reminderTagId)
    await harness.sendTextToFriend(
      friend.id,
      `無料期間の終了が近づいています。\n残り ${daysLeft} 日です。\n継続をご希望の場合は決済ページをご確認ください。`,
    )
  }
}

async function notifyPaymentFailed(
  harness: LineHarness,
  stripe: StripeClient,
): Promise<void> {
  const invoices = await stripe.listInvoices('open', 100)
  const failedTagId = await ensureTag(harness, 'stripe:payment-followup', '#DC2626')

  for (const invoice of invoices) {
    if (!invoice.customer || invoice.amountDue <= 0) continue

    const friend = await findFriendByStripeCustomerId(harness, invoice.customer)
    if (!friend) continue

    if (friend.tags.some((tag) => tag.name === 'stripe:payment-followup')) {
      continue
    }

    await harness.friends.addTag(friend.id, failedTagId)

    const amount = invoice.amountDue / 100
    const currency = (invoice.currency ?? 'jpy').toUpperCase()
    const message = [
      'お支払いの確認がまだ完了していません。',
      `請求額: ${amount.toLocaleString('ja-JP')} ${currency}`,
      invoice.dueDate ? `お支払い期限: ${new Date(invoice.dueDate).toLocaleDateString('ja-JP')}` : null,
      invoice.hostedInvoiceUrl ? `お支払いURL: ${invoice.hostedInvoiceUrl}` : null,
    ].filter(Boolean).join('\n')

    await harness.sendTextToFriend(friend.id, message)
  }
}

export async function checkAndNotify(env: Env): Promise<void> {
  const { harness, stripe } = createClients(env)

  await notifyTrialEnding(harness, stripe)
  await notifyPaymentFailed(harness, stripe)
}
