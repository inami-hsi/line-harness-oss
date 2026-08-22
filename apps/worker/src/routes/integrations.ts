/**
 * Integrations — Lottery
 *
 * POST /api/integrations/lottery/run — draw winners from a tag, notify via LINE
 *
 * Point management intentionally lives on the mileage ledger
 * (POST /api/friends/:id/mileage/adjust) instead of a parallel points system here.
 */

import { Hono } from 'hono';
import {
  getFriendsByTag,
  getTags,
  createTag,
  addTagToFriend,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';

const integrations = new Hono<Env>();

async function ensureTag(db: D1Database, name: string, color: string): Promise<string> {
  const tags = await getTags(db);
  const existing = tags.find((t) => t.name === name);
  if (existing) return existing.id;
  const created = await createTag(db, { name, color });
  return created.id;
}

async function accessTokenForFriend(
  db: D1Database,
  defaultToken: string,
  friendLineAccountId: string | null,
): Promise<string> {
  if (!friendLineAccountId) return defaultToken;
  const account = await getLineAccountById(db, friendLineAccountId);
  return account?.channel_access_token ?? defaultToken;
}

integrations.post('/api/integrations/lottery/run', async (c) => {
  try {
    const body = await c.req.json<{
      entryTagId: string;
      prizeCount: number;
      winnerTagName?: string;
      winnerMessage?: string;
      loserMessage?: string;
    }>();

    if (!body.entryTagId) return c.json({ success: false, error: 'entryTagId is required' }, 400);
    if (!body.prizeCount || body.prizeCount < 1) return c.json({ success: false, error: 'prizeCount must be >= 1' }, 400);

    const db = c.env.DB;
    const entrants = await getFriendsByTag(db, body.entryTagId);

    if (entrants.length === 0) {
      return c.json({ success: true, data: { entrantCount: 0, winners: [], message: 'エントリーが0件' } });
    }

    const shuffled = [...entrants].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, Math.min(body.prizeCount, entrants.length));
    const winnerIds = new Set(winners.map((f) => f.id));

    const winnerTagName = body.winnerTagName ?? 'lottery:winner';
    const winnerTagId = await ensureTag(db, winnerTagName, '#F59E0B');

    const prizeName = 'ご当選賞品';
    const winnerMsg = body.winnerMessage
      ?? `おめでとうございます！\n抽選の結果、${prizeName}に当選されました。\n担当者よりご連絡いたします。`;

    await Promise.all([
      ...winners.map(async (f) => {
        await addTagToFriend(db, f.id, winnerTagId);
        const accessToken = await accessTokenForFriend(db, c.env.LINE_CHANNEL_ACCESS_TOKEN, f.line_account_id);
        const lineClient = new LineClient(accessToken);
        await lineClient.pushTextMessage(f.line_user_id, winnerMsg).catch(() => {});

        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_account_id, created_at)
             VALUES (?, ?, 'outgoing', 'text', ?, ?, ?)`,
          )
          .bind(logId, f.id, winnerMsg, f.line_account_id, jstNow())
          .run();
      }),
      ...(body.loserMessage
        ? entrants
            .filter((f) => !winnerIds.has(f.id))
            .map(async (f) => {
              const accessToken = await accessTokenForFriend(db, c.env.LINE_CHANNEL_ACCESS_TOKEN, f.line_account_id);
              const lineClient = new LineClient(accessToken);
              await lineClient.pushTextMessage(f.line_user_id, body.loserMessage!).catch(() => {});
            })
        : []),
    ]);

    return c.json({
      success: true,
      data: {
        entrantCount: entrants.length,
        winnerCount: winners.length,
        winners: winners.map((f) => ({ id: f.id, displayName: f.display_name })),
      },
    });
  } catch (err) {
    console.error('POST /api/integrations/lottery/run error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { integrations };
