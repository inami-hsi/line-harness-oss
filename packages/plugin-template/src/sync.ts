/**
 * Sync Stripe customer/subscription state into LINE Harness metadata and tags.
 */

import { LineHarness, type Friend } from '@line-harness/sdk'
import { StripeClient, type StripeCustomer, type StripeSubscription } from './external-api.js'
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

async function syncCustomerMetadata(
  harness: LineHarness,
  customer: StripeCustomer,
): Promise<Friend | null> {
  const friend = await findFriendByStripeCustomerId(harness, customer.id)
  if (!friend) return null

  await harness.friends.setMetadata(friend.id, {
    stripeCustomerId: customer.id,
    stripeEmail: customer.email,
    stripeCustomerName: customer.name,
  })

  return friend
}

async function syncSubscriptionState(
  harness: LineHarness,
  subscription: StripeSubscription,
): Promise<void> {
  const friend = await findFriendByStripeCustomerId(harness, subscription.customer)
  if (!friend) return

  await harness.friends.setMetadata(friend.id, {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: subscription.status,
    stripeCurrentPeriodEnd: subscription.currentPeriodEnd,
    stripeTrialEnd: subscription.trialEnd,
    stripeCancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    stripePriceIds: subscription.priceIds,
    stripeProductIds: subscription.productIds,
  })

  const statusTagId = await ensureTag(
    harness,
    `stripe:subscription:${subscription.status}`,
    '#7C3AED',
  )
  await harness.friends.addTag(friend.id, statusTagId)

  for (const productId of subscription.productIds) {
    const productTagId = await ensureTag(harness, `stripe:product:${productId}`, '#2563EB')
    await harness.friends.addTag(friend.id, productTagId)
  }
}

export async function syncExternalData(env: Env): Promise<void> {
  const { harness, stripe } = createClients(env)

  const [customers, subscriptions] = await Promise.all([
    stripe.listCustomers(100),
    stripe.listSubscriptions('all', 100),
  ])

  for (const customer of customers) {
    try {
      await syncCustomerMetadata(harness, customer)
    } catch (error) {
      console.error(`[Stripe Sync] Failed to sync customer ${customer.id}:`, error)
    }
  }

  for (const subscription of subscriptions) {
    try {
      await syncSubscriptionState(harness, subscription)
    } catch (error) {
      console.error(`[Stripe Sync] Failed to sync subscription ${subscription.id}:`, error)
    }
  }

  console.log(
    `[Stripe Sync] Completed. Customers=${customers.length}, Subscriptions=${subscriptions.length}`,
  )
}
