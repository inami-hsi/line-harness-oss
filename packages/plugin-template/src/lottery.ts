/**
 * Lottery / Draw feature — LINE Harness integrated
 *
 * Picks winners from friends tagged with an entry tag,
 * tags them as winners, and sends a congratulatory LINE message.
 */

import { LineHarness, type Friend } from '@line-harness/sdk'

export interface LotteryOptions {
  /** Tag ID that marks friends who entered the lottery */
  entryTagId: string
  /** Tag name to apply to winners (default: 'lottery:winner') */
  winnerTagName?: string
  /** Number of winners to draw */
  prizeCount: number
  /** Human-readable prize name used in the message */
  prizeName?: string
  /** Custom winner message. If omitted, a default is generated. */
  winnerMessage?: string
  /** Message sent to non-winners (optional) */
  loserMessage?: string
}

export interface LotteryResult {
  friendId: string
  displayName: string | null
  isWinner: boolean
  prize?: string
}

async function ensureTag(harness: LineHarness, name: string, color: string): Promise<string> {
  const tags = await harness.tags.list()
  const existing = tags.find((t) => t.name === name)
  if (existing) return existing.id
  const created = await harness.tags.create({ name, color })
  return created.id
}

async function listAllByTag(harness: LineHarness, tagId: string): Promise<Friend[]> {
  const items: Friend[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const page = await harness.friends.list({ tagId, limit, offset })
    items.push(...page.items)
    if (!page.hasNextPage) break
    offset += limit
  }
  return items
}

/**
 * Run a lottery draw against all friends who have `opts.entryTagId`.
 * Winners are tagged and notified via LINE.
 */
export async function runLottery(
  harness: LineHarness,
  opts: LotteryOptions,
): Promise<LotteryResult[]> {
  const entrants = await listAllByTag(harness, opts.entryTagId)
  if (entrants.length === 0) return []

  const shuffled = [...entrants].sort(() => Math.random() - 0.5)
  const winners = shuffled.slice(0, Math.min(opts.prizeCount, entrants.length))
  const winnerIds = new Set(winners.map((f) => f.id))

  const winnerTagName = opts.winnerTagName ?? 'lottery:winner'
  const winnerTagId = await ensureTag(harness, winnerTagName, '#F59E0B')
  const prizeName = opts.prizeName ?? '当選賞品'
  const winnerMessage =
    opts.winnerMessage ??
    `おめでとうございます！\n抽選の結果、${prizeName}に当選されました。\n担当者よりご連絡いたします。`

  await Promise.all([
    ...winners.map(async (friend) => {
      await harness.friends.addTag(friend.id, winnerTagId)
      await harness.sendTextToFriend(friend.id, winnerMessage)
    }),
    ...(opts.loserMessage
      ? entrants
          .filter((f) => !winnerIds.has(f.id))
          .map((friend) => harness.sendTextToFriend(friend.id, opts.loserMessage!))
      : []),
  ])

  return entrants.map((friend) => ({
    friendId: friend.id,
    displayName: friend.displayName,
    isWinner: winnerIds.has(friend.id),
    prize: winnerIds.has(friend.id) ? prizeName : undefined,
  }))
}
