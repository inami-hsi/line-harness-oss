/**
 * Integrations — Lottery & Points endpoints
 *
 * POST /api/integrations/lottery/run    — draw winners from a tag, notify via LINE
 * GET  /api/integrations/points/leaderboard — top friends by metadata.points
 * POST /api/integrations/points/adjust  — add or subtract points for a friend
 */

import { Hono } from 'hono';
import {
  getFriendsByTag,
  getFriendById,
  getTags,
  createTag,
  addTagToFriend,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';

const integrations = new Hono<Env>();

// ─── Helpers ──────────────────────────────────────────────

async function ensureTag(
  db: D1Database,
  name: string,
  color: string,
): Promise<string> {
  const tags = await getTags(db);
  const existing = tags.find((t) => t.name === name);
  if (existing) return existing.id;
  const created = await createTag(db, { name, color });
  return created.id;
}

async function getAccessToken(db: D1Database, defaultToken: string, lineAccountId?: string): Promise<string> {
  if (!lineAccountId) return defaultToken;
  const account = await db
    .prepare('SELECT access_token FROM line_accounts WHERE id = ?')
    .bind(lineAccountId)
    .first<{ access_token: string }>();
  return account?.access_token ?? defaultToken;
}

// ─── Lottery ──────────────────────────────────────────────

integrations.post('/api/integrations/lottery/run', async (c) => {
  try {
    const body = await c.req.json<{
      entryTagId: string;
      prizeCount: number;
      winnerTagName?: string;
      winnerMessage?: string;
      loserMessage?: string;
      lineAccountId?: string;
    }>();

    if (!body.entryTagId) return c.json({ success: false, error: 'entryTagId is required' }, 400);
    if (!body.prizeCount || body.prizeCount < 1) return c.json({ success: false, error: 'prizeCount must be >= 1' }, 400);

    const db = c.env.DB;
    const entrants = await getFriendsByTag(db, body.entryTagId);

    if (entrants.length === 0) {
      return c.json({ success: true, data: { entrantCount: 0, winners: [], message: 'エントリーが0件' } });
    }

    // Shuffle and pick
    const shuffled = [...entrants].sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, Math.min(body.prizeCount, entrants.length));
    const winnerIds = new Set(winners.map((f) => f.id));

    const winnerTagName = body.winnerTagName ?? 'lottery:winner';
    const winnerTagId = await ensureTag(db, winnerTagName, '#F59E0B');

    const accessToken = await getAccessToken(db, c.env.LINE_CHANNEL_ACCESS_TOKEN, body.lineAccountId);
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(accessToken);

    const prizeName = 'ご当選賞品';
    const winnerMsg = body.winnerMessage
      ?? `おめでとうございます！\n抽選の結果、${prizeName}に当選されました。\n担当者よりご連絡いたします。`;

    await Promise.all([
      ...winners.map(async (f) => {
        await addTagToFriend(db, f.id, winnerTagId);
        await lineClient.pushTextMessage(f.line_user_id, winnerMsg).catch(() => {});

        const logId = crypto.randomUUID();
        await db
          .prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', 'text', ?, ?)`)
          .bind(logId, f.id, winnerMsg, jstNow())
          .run();
      }),
      ...(body.loserMessage
        ? entrants
            .filter((f) => !winnerIds.has(f.id))
            .map(async (f) => {
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

// ─── Points leaderboard ───────────────────────────────────

integrations.get('/api/integrations/points/leaderboard', async (c) => {
  try {
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
    const rows = await c.env.DB
      .prepare(`
        SELECT id, display_name, picture_url, metadata, updated_at
        FROM friends
        WHERE json_extract(metadata, '$.points') IS NOT NULL
          AND json_extract(metadata, '$.points') > 0
        ORDER BY json_extract(metadata, '$.points') DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<{ id: string; display_name: string; picture_url: string | null; metadata: string; updated_at: string }>();

    const items = rows.results.map((r) => {
      const meta = JSON.parse(r.metadata || '{}') as Record<string, unknown>;
      return {
        id: r.id,
        displayName: r.display_name,
        pictureUrl: r.picture_url,
        points: typeof meta.points === 'number' ? meta.points : 0,
        pointsLastUpdated: meta.pointsLastUpdated ?? null,
        updatedAt: r.updated_at,
      };
    });

    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/integrations/points/leaderboard error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── Points adjust ────────────────────────────────────────

integrations.post('/api/integrations/points/adjust', async (c) => {
  try {
    const body = await c.req.json<{
      friendId: string;
      change: number;     // positive = add, negative = subtract
      reason?: string;
      notify?: boolean;
      lineAccountId?: string;
    }>();

    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    if (body.change === undefined || body.change === 0) return c.json({ success: false, error: 'change must be non-zero' }, 400);

    const db = c.env.DB;
    const friend = await getFriendById(db, body.friendId);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    const meta = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    const current = typeof meta.points === 'number' ? meta.points : 0;
    const next = current + body.change;

    interface PointEvent { change: number; reason: string; balanceAfter: number; date: string }
    const history: PointEvent[] = Array.isArray(meta.pointHistory) ? (meta.pointHistory as PointEvent[]) : [];
    history.push({ change: body.change, reason: body.reason ?? '管理画面から調整', balanceAfter: next, date: jstNow() });

    const updatedMeta = JSON.stringify({
      ...meta,
      points: next,
      pointsLastUpdated: jstNow(),
      pointHistory: history.slice(-50),
    });

    await db
      .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
      .bind(updatedMeta, jstNow(), body.friendId)
      .run();

    if (body.notify) {
      const accessToken = await getAccessToken(db, c.env.LINE_CHANNEL_ACCESS_TOKEN, body.lineAccountId);
      const { LineClient } = await import('@line-crm/line-sdk');
      const lineClient = new LineClient(accessToken);
      const verb = body.change >= 0 ? `${body.change} pt 付与` : `${Math.abs(body.change)} pt 消費`;
      const msg = `ポイントが${verb}されました（${body.reason ?? '管理画面から調整'}）\n現在のポイント: ${next} pt`;
      await lineClient.pushTextMessage(friend.line_user_id, msg).catch(() => {});
    }

    return c.json({ success: true, data: { friendId: body.friendId, previousBalance: current, change: body.change, newBalance: next } });
  } catch (err) {
    console.error('POST /api/integrations/points/adjust error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { integrations };
