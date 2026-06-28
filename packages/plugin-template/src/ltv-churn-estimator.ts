/**
 * LTV & Churn Estimator — LINE Harness integrated
 *
 * Reads purchase metadata stored on friends (totalRevenue, purchaseCount,
 * lastPurchaseDate, lastActiveDate) and tags / notifies at-risk friends.
 *
 * Metadata keys read:
 *   friend.metadata.totalRevenue       (number, JPY)
 *   friend.metadata.purchaseCount      (number)
 *   friend.metadata.firstPurchaseDate  (ISO string)
 *   friend.metadata.lastPurchaseDate   (ISO string)
 *   friend.metadata.lastActiveDate     (ISO string — updated by tracking links, form submissions, etc.)
 */

import { LineHarness, type Friend } from '@line-harness/sdk'

// ─── Pure calculations ────────────────────────────────────

export interface CustomerActivity {
  totalRevenue: number
  purchaseCount: number
  firstPurchaseDate: string
  lastPurchaseDate: string
  lastActiveDate: string
}

export function estimateLTV(activity: CustomerActivity): number {
  if (activity.purchaseCount <= 0) return 0
  const firstDate = new Date(activity.firstPurchaseDate)
  const lastDate = new Date(activity.lastPurchaseDate)
  const monthsActive = Math.max(
    1,
    (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 30),
  )
  const avgMonthlyRevenue = activity.totalRevenue / monthsActive
  // Project 12 months forward
  return Math.round(avgMonthlyRevenue * 12)
}

export type ChurnRisk = 'low' | 'medium' | 'high' | 'critical'

export function estimateChurnRisk(
  activity: CustomerActivity,
  today: Date = new Date(),
): ChurnRisk {
  const daysSinceActive =
    (today.getTime() - new Date(activity.lastActiveDate).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceActive > 60) return 'critical'
  if (daysSinceActive > 30) return 'high'
  if (daysSinceActive > 14) return 'medium'
  return 'low'
}

// ─── LINE Harness integration ─────────────────────────────

export interface ChurnAuditOptions {
  /**
   * Only audit friends with this tag (e.g. 'stripe:subscription:active').
   * If omitted, all friends are scanned — may be slow for large lists.
   */
  filterTagId?: string
  /** Message sent to 'high' and 'critical' risk friends. If omitted, no LINE message is sent. */
  reengagementMessage?: string
  /** Tag name format for churn risk (default: 'churn:{risk}'). */
  tagNameFormat?: (risk: ChurnRisk) => string
}

export interface ChurnAuditResult {
  friendId: string
  displayName: string | null
  risk: ChurnRisk
  ltv: number
  daysSinceActive: number
}

function activityFromMetadata(metadata: Record<string, unknown>): CustomerActivity | null {
  const lastActiveDate = metadata.lastActiveDate ?? metadata.lastPurchaseDate
  if (typeof lastActiveDate !== 'string') return null
  return {
    totalRevenue: typeof metadata.totalRevenue === 'number' ? metadata.totalRevenue : 0,
    purchaseCount: typeof metadata.purchaseCount === 'number' ? metadata.purchaseCount : 0,
    firstPurchaseDate:
      typeof metadata.firstPurchaseDate === 'string'
        ? metadata.firstPurchaseDate
        : lastActiveDate,
    lastPurchaseDate:
      typeof metadata.lastPurchaseDate === 'string' ? metadata.lastPurchaseDate : lastActiveDate,
    lastActiveDate,
  }
}

async function ensureTag(harness: LineHarness, name: string, color: string): Promise<string> {
  const tags = await harness.tags.list()
  const existing = tags.find((t) => t.name === name)
  if (existing) return existing.id
  const created = await harness.tags.create({ name, color })
  return created.id
}

const RISK_COLORS: Record<ChurnRisk, string> = {
  low: '#22C55E',
  medium: '#F59E0B',
  high: '#F97316',
  critical: '#DC2626',
}

/**
 * Scan friends, estimate churn risk, apply tags, and optionally send re-engagement messages.
 * Returns an audit summary sorted by risk descending.
 */
export async function auditChurnRisk(
  harness: LineHarness,
  opts: ChurnAuditOptions = {},
): Promise<ChurnAuditResult[]> {
  const today = new Date()
  const tagNameFor = opts.tagNameFormat ?? ((risk: ChurnRisk) => `churn:${risk}`)
  const results: ChurnAuditResult[] = []

  let offset = 0
  const limit = 100
  while (true) {
    const page = await harness.friends.list({
      limit,
      offset,
      tagId: opts.filterTagId,
    })

    const batchResults = await Promise.all(
      page.items.map(async (friend: Friend) => {
        const activity = activityFromMetadata(friend.metadata ?? {})
        if (!activity) return null

        const risk = estimateChurnRisk(activity, today)
        const ltv = estimateLTV(activity)
        const daysSinceActive = Math.round(
          (today.getTime() - new Date(activity.lastActiveDate).getTime()) /
            (1000 * 60 * 60 * 24),
        )

        const tagId = await ensureTag(harness, tagNameFor(risk), RISK_COLORS[risk])
        await harness.friends.addTag(friend.id, tagId)
        await harness.friends.setMetadata(friend.id, {
          churnRisk: risk,
          estimatedLTV: ltv,
          churnAuditedAt: today.toISOString(),
        })

        if (
          opts.reengagementMessage &&
          (risk === 'high' || risk === 'critical')
        ) {
          await harness.sendTextToFriend(friend.id, opts.reengagementMessage)
        }

        return { friendId: friend.id, displayName: friend.displayName, risk, ltv, daysSinceActive }
      }),
    )

    results.push(...(batchResults.filter(Boolean) as ChurnAuditResult[]))
    if (!page.hasNextPage) break
    offset += limit
  }

  const riskOrder: Record<ChurnRisk, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return results.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])
}
