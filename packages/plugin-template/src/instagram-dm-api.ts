/**
 * Instagram DM Client (Meta Graph API) + LINE Harness integration
 *
 * Requires Meta Business account with Instagram messaging permission (approved).
 * friend.metadata.instagramUserId must be set to send DMs.
 *
 * Meta Graph API DM送信は事前に申請・審査が必要です。
 * https://developers.facebook.com/docs/messenger-platform/instagram
 */

import { LineHarness } from '@line-harness/sdk'

// ─── API Client ──────────────────────────────────────────

const IG_GRAPH_API_URL = 'https://graph.facebook.com/v19.0'

export interface InstagramDM {
  recipientId: string
  message: string
}

export class InstagramDMClient {
  private readonly accessToken: string
  private readonly igBusinessAccountId: string

  constructor(accessToken: string, igBusinessAccountId: string) {
    this.accessToken = accessToken
    this.igBusinessAccountId = igBusinessAccountId
  }

  async sendDM(dm: InstagramDM): Promise<void> {
    const url = `${IG_GRAPH_API_URL}/${this.igBusinessAccountId}/messages`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: dm.recipientId },
        message: { text: dm.message },
        access_token: this.accessToken,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Instagram DM API error ${response.status}: ${text}`)
    }
  }
}

// ─── LINE Harness Integration ─────────────────────────────

export interface SendInstagramDMToFriendOptions {
  message: string
  /** Tag name to apply after a successful DM (e.g. 'instagram:dm:sent') */
  tagOnSend?: string
}

/**
 * Send an Instagram DM to a friend using their metadata.instagramUserId.
 * Records send timestamp in metadata and optionally tags them.
 */
export async function sendInstagramDMToFriend(
  harness: LineHarness,
  client: InstagramDMClient,
  friendId: string,
  opts: SendInstagramDMToFriendOptions,
): Promise<void> {
  const friend = await harness.friends.get(friendId)
  const instagramUserId = friend.metadata?.instagramUserId
  if (typeof instagramUserId !== 'string' || !instagramUserId) {
    throw new Error(`Friend ${friendId} has no instagramUserId in metadata`)
  }

  await client.sendDM({ recipientId: instagramUserId, message: opts.message })

  await harness.friends.setMetadata(friendId, {
    lastInstagramDMSentAt: new Date().toISOString(),
    lastInstagramDMBody: opts.message.slice(0, 100),
  })

  if (opts.tagOnSend) {
    const tags = await harness.tags.list()
    const existing = tags.find((t) => t.name === opts.tagOnSend)
    const tagId =
      existing?.id ?? (await harness.tags.create({ name: opts.tagOnSend!, color: '#E1306C' })).id
    await harness.friends.addTag(friendId, tagId)
  }
}

/**
 * Send an Instagram DM to all friends with a given tag who have metadata.instagramUserId set.
 * Returns { sent, skipped } counts.
 */
export async function sendInstagramDMBroadcast(
  harness: LineHarness,
  client: InstagramDMClient,
  tagId: string,
  opts: SendInstagramDMToFriendOptions,
): Promise<{ sent: number; skipped: number }> {
  let sent = 0
  let skipped = 0
  let offset = 0
  const limit = 100

  while (true) {
    const page = await harness.friends.list({ tagId, limit, offset })
    await Promise.all(
      page.items.map(async (friend) => {
        const instagramUserId = friend.metadata?.instagramUserId
        if (typeof instagramUserId !== 'string' || !instagramUserId) {
          skipped++
          return
        }
        try {
          await client.sendDM({ recipientId: instagramUserId, message: opts.message })
          await harness.friends.setMetadata(friend.id, {
            lastInstagramDMSentAt: new Date().toISOString(),
            lastInstagramDMBody: opts.message.slice(0, 100),
          })
          sent++
        } catch {
          skipped++
        }
      }),
    )
    if (!page.hasNextPage) break
    offset += limit
  }

  return { sent, skipped }
}
