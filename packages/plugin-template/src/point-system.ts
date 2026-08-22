/**
 * Point System — LINE Harness integrated
 *
 * Stores points and history in friend.metadata (D1-backed via LINE Harness).
 * Optionally notifies friends via LINE when their balance changes.
 * Optionally applies threshold-based tags (e.g. 'points:gold' at 1000 pt).
 */

import { LineHarness } from '@line-harness/sdk'

export interface PointEvent {
  change: number
  reason: string
  balanceAfter: number
  date: string
}

export interface ThresholdTag {
  minPoints: number
  tagName: string
  color?: string
}

async function ensureTag(harness: LineHarness, name: string, color: string): Promise<string> {
  const tags = await harness.tags.list()
  const existing = tags.find((t) => t.name === name)
  if (existing) return existing.id
  const created = await harness.tags.create({ name, color })
  return created.id
}

/** Read current point balance from friend metadata. */
export async function getPoints(harness: LineHarness, friendId: string): Promise<number> {
  const friend = await harness.friends.get(friendId)
  const pts = friend.metadata?.points
  return typeof pts === 'number' ? pts : 0
}

async function applyChange(
  harness: LineHarness,
  friendId: string,
  change: number,
  reason: string,
  opts?: { notify?: boolean; allowNegative?: boolean; thresholds?: ThresholdTag[] },
): Promise<number> {
  const friend = await harness.friends.get(friendId)
  const current = typeof friend.metadata?.points === 'number' ? friend.metadata.points : 0

  if (change < 0 && !opts?.allowNegative && current + change < 0) {
    throw new Error(`ポイント不足: 保有 ${current} pt, 必要 ${Math.abs(change)} pt`)
  }

  const next = current + change
  const event: PointEvent = {
    change,
    reason,
    balanceAfter: next,
    date: new Date().toISOString(),
  }

  const history: PointEvent[] = Array.isArray(friend.metadata?.pointHistory)
    ? (friend.metadata.pointHistory as PointEvent[])
    : []
  history.push(event)

  await harness.friends.setMetadata(friendId, {
    points: next,
    pointsLastUpdated: event.date,
    pointHistory: history.slice(-50),
  })

  if (opts?.notify) {
    const verb = change >= 0 ? `${change} pt 付与` : `${Math.abs(change)} pt 消費`
    await harness.sendTextToFriend(
      friendId,
      `ポイントが${verb}されました（${reason}）\n現在のポイント: ${next} pt`,
    )
  }

  if (opts?.thresholds) {
    await Promise.all(
      opts.thresholds.map(async ({ minPoints, tagName, color }) => {
        if (next >= minPoints) {
          const tagId = await ensureTag(harness, tagName, color ?? '#6366F1')
          await harness.friends.addTag(friendId, tagId)
        }
      }),
    )
  }

  return next
}

/** Add points. Returns new balance. */
export async function addPoints(
  harness: LineHarness,
  friendId: string,
  amount: number,
  reason: string,
  opts?: { notify?: boolean; thresholds?: ThresholdTag[] },
): Promise<number> {
  return applyChange(harness, friendId, amount, reason, opts)
}

/** Subtract points. Throws if balance is insufficient unless allowNegative is true. */
export async function subtractPoints(
  harness: LineHarness,
  friendId: string,
  amount: number,
  reason: string,
  opts?: { notify?: boolean; allowNegative?: boolean; thresholds?: ThresholdTag[] },
): Promise<number> {
  return applyChange(harness, friendId, -amount, reason, opts)
}
