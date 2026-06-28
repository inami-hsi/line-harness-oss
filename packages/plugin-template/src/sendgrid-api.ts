/**
 * SendGrid API Client + LINE Harness integration
 *
 * Usage:
 *   const sg = new SendGridClient(env.SENDGRID_API_KEY)
 *   await sendEmailToFriend(harness, sg, friendId, { from: '...', subject: '...', html: '...' })
 *
 * Requires friend.metadata.email to be set (e.g. from a LIFF form submission).
 */

import { LineHarness } from '@line-harness/sdk'

// ─── API Client ──────────────────────────────────────────

export interface SendGridMail {
  to: string
  from: string
  subject: string
  text?: string
  html?: string
}

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send'

export class SendGridClient {
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async sendMail(mail: SendGridMail): Promise<void> {
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to }] }],
        from: { email: mail.from },
        subject: mail.subject,
        content: [
          mail.text ? { type: 'text/plain', value: mail.text } : null,
          mail.html ? { type: 'text/html', value: mail.html } : null,
        ].filter(Boolean),
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`SendGrid API error ${response.status}: ${text}`)
    }
  }
}

// ─── LINE Harness Integration ─────────────────────────────

export interface SendEmailToFriendOptions {
  from: string
  subject: string
  text?: string
  html?: string
  /** Tag name to apply after a successful send (e.g. 'email:sent:campaign-a') */
  tagOnSend?: string
}

/**
 * Send an email to a single friend using their metadata.email address.
 * Records send timestamp/subject in metadata and optionally tags them.
 */
export async function sendEmailToFriend(
  harness: LineHarness,
  sendgrid: SendGridClient,
  friendId: string,
  opts: SendEmailToFriendOptions,
): Promise<void> {
  const friend = await harness.friends.get(friendId)
  const email = friend.metadata?.email
  if (typeof email !== 'string' || !email) {
    throw new Error(`Friend ${friendId} has no email in metadata`)
  }

  await sendgrid.sendMail({ to: email, from: opts.from, subject: opts.subject, text: opts.text, html: opts.html })

  await harness.friends.setMetadata(friendId, {
    lastEmailSentAt: new Date().toISOString(),
    lastEmailSubject: opts.subject,
  })

  if (opts.tagOnSend) {
    const tags = await harness.tags.list()
    const existing = tags.find((t) => t.name === opts.tagOnSend)
    const tagId =
      existing?.id ?? (await harness.tags.create({ name: opts.tagOnSend!, color: '#0EA5E9' })).id
    await harness.friends.addTag(friendId, tagId)
  }
}

/**
 * Send an email to all friends with a given tag who have metadata.email set.
 * Returns { sent, skipped } counts.
 */
export async function sendEmailBroadcast(
  harness: LineHarness,
  sendgrid: SendGridClient,
  tagId: string,
  opts: SendEmailToFriendOptions,
): Promise<{ sent: number; skipped: number }> {
  let sent = 0
  let skipped = 0
  let offset = 0
  const limit = 100

  while (true) {
    const page = await harness.friends.list({ tagId, limit, offset })
    await Promise.all(
      page.items.map(async (friend) => {
        const email = friend.metadata?.email
        if (typeof email !== 'string' || !email) {
          skipped++
          return
        }
        try {
          await sendgrid.sendMail({ to: email, from: opts.from, subject: opts.subject, text: opts.text, html: opts.html })
          await harness.friends.setMetadata(friend.id, {
            lastEmailSentAt: new Date().toISOString(),
            lastEmailSubject: opts.subject,
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
