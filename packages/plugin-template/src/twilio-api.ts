/**
 * Twilio SMS Client + LINE Harness integration
 *
 * Usage:
 *   const twilio = new TwilioClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
 *   await sendSmsToFriend(harness, twilio, friendId, { from: '+81...', body: 'ありがとうございます' })
 *
 * Requires friend.metadata.phone to be set (E.164 format, e.g. '+819012345678').
 */

import { LineHarness } from '@line-harness/sdk'

// ─── API Client ──────────────────────────────────────────

export interface TwilioSMS {
  to: string
  from: string
  body: string
}

const TWILIO_API_URL = 'https://api.twilio.com/2010-04-01/Accounts'

export class TwilioClient {
  private readonly accountSid: string
  private readonly authToken: string

  constructor(accountSid: string, authToken: string) {
    this.accountSid = accountSid
    this.authToken = authToken
  }

  async sendSMS(sms: TwilioSMS): Promise<void> {
    const url = `${TWILIO_API_URL}/${this.accountSid}/Messages.json`
    const params = new URLSearchParams({ To: sms.to, From: sms.from, Body: sms.body })
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Twilio API error ${response.status}: ${text}`)
    }
  }
}

// ─── LINE Harness Integration ─────────────────────────────

export interface SendSmsToFriendOptions {
  from: string
  body: string
  /** Tag name to apply after a successful send (e.g. 'sms:sent:campaign-a') */
  tagOnSend?: string
}

/**
 * Send an SMS to a single friend using their metadata.phone address (E.164).
 * Records send timestamp in metadata and optionally tags them.
 */
export async function sendSmsToFriend(
  harness: LineHarness,
  twilio: TwilioClient,
  friendId: string,
  opts: SendSmsToFriendOptions,
): Promise<void> {
  const friend = await harness.friends.get(friendId)
  const phone = friend.metadata?.phone
  if (typeof phone !== 'string' || !phone) {
    throw new Error(`Friend ${friendId} has no phone in metadata`)
  }

  await twilio.sendSMS({ to: phone, from: opts.from, body: opts.body })

  await harness.friends.setMetadata(friendId, {
    lastSmsSentAt: new Date().toISOString(),
    lastSmsBody: opts.body.slice(0, 100),
  })

  if (opts.tagOnSend) {
    const tags = await harness.tags.list()
    const existing = tags.find((t) => t.name === opts.tagOnSend)
    const tagId =
      existing?.id ?? (await harness.tags.create({ name: opts.tagOnSend!, color: '#10B981' })).id
    await harness.friends.addTag(friendId, tagId)
  }
}

/**
 * Send an SMS to all friends with a given tag who have metadata.phone set.
 * Returns { sent, skipped } counts.
 */
export async function sendSmsBroadcast(
  harness: LineHarness,
  twilio: TwilioClient,
  tagId: string,
  opts: SendSmsToFriendOptions,
): Promise<{ sent: number; skipped: number }> {
  let sent = 0
  let skipped = 0
  let offset = 0
  const limit = 100

  while (true) {
    const page = await harness.friends.list({ tagId, limit, offset })
    await Promise.all(
      page.items.map(async (friend) => {
        const phone = friend.metadata?.phone
        if (typeof phone !== 'string' || !phone) {
          skipped++
          return
        }
        try {
          await twilio.sendSMS({ to: phone, from: opts.from, body: opts.body })
          await harness.friends.setMetadata(friend.id, {
            lastSmsSentAt: new Date().toISOString(),
            lastSmsBody: opts.body.slice(0, 100),
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
