import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LineHarness } from "@line-harness/sdk";
import { getClient } from "../client.js";

async function ensureTag(
  client: LineHarness,
  name: string,
  color: string,
): Promise<string> {
  const tags = await client.tags.list();
  const existing = tags.find((t) => t.name === name);
  if (existing) return existing.id;
  const created = await client.tags.create({ name, color });
  return created.id;
}

interface PointEvent {
  change: number;
  reason: string;
  balanceAfter: number;
  date: string;
}

async function applyPoints(
  client: LineHarness,
  friendId: string,
  change: number,
  reason: string,
  opts?: { notify?: boolean; thresholdTags?: Array<{ minPoints: number; tagName: string }> },
): Promise<{ newBalance: number }> {
  const friend = await client.friends.get(friendId);
  const current =
    typeof friend.metadata?.points === "number" ? friend.metadata.points : 0;

  if (change < 0 && current + change < 0) {
    throw new Error(
      `ポイント不足: 保有 ${current} pt, 必要 ${Math.abs(change)} pt`,
    );
  }

  const next = current + change;
  const event: PointEvent = {
    change,
    reason,
    balanceAfter: next,
    date: new Date().toISOString(),
  };

  const history: PointEvent[] = Array.isArray(friend.metadata?.pointHistory)
    ? (friend.metadata.pointHistory as PointEvent[])
    : [];
  history.push(event);

  await client.friends.setMetadata(friendId, {
    points: next,
    pointsLastUpdated: event.date,
    pointHistory: history.slice(-50),
  });

  if (opts?.notify) {
    const verb = change >= 0 ? `${change} pt 付与` : `${Math.abs(change)} pt 消費`;
    await client.sendTextToFriend(
      friendId,
      `ポイントが${verb}されました（${reason}）\n現在のポイント: ${next} pt`,
    );
  }

  if (opts?.thresholdTags) {
    await Promise.all(
      opts.thresholdTags.map(async ({ minPoints, tagName }) => {
        if (next >= minPoints) {
          const tagId = await ensureTag(client, tagName, "#6366F1");
          await client.friends.addTag(friendId, tagId);
        }
      }),
    );
  }

  return { newBalance: next };
}

export function registerManagePoints(server: McpServer): void {
  server.tool(
    "manage_points",
    "Add or subtract points for a friend (stored in metadata.points). Optionally notify via LINE and apply threshold tags.",
    {
      action: z
        .enum(["add", "subtract", "get"])
        .describe("'add' adds points, 'subtract' deducts, 'get' reads balance"),
      friendId: z.string().describe("Friend ID to operate on"),
      amount: z
        .number()
        .positive()
        .optional()
        .describe("Point amount (required for add/subtract)"),
      reason: z
        .string()
        .optional()
        .describe("Reason for the point change (logged in history)"),
      notify: z
        .boolean()
        .optional()
        .describe("Send LINE message to friend about balance change (default: false)"),
      thresholdTags: z
        .array(
          z.object({
            minPoints: z.number(),
            tagName: z.string(),
          }),
        )
        .optional()
        .describe(
          "Apply tags when balance reaches thresholds, e.g. [{minPoints:1000, tagName:'points:gold'}]",
        ),
    },
    async ({ action, friendId, amount, reason, notify, thresholdTags }) => {
      try {
        const client = getClient();

        if (action === "get") {
          const friend = await client.friends.get(friendId);
          const balance =
            typeof friend.metadata?.points === "number"
              ? friend.metadata.points
              : 0;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    friendId,
                    displayName: friend.displayName,
                    balance,
                    lastUpdated: friend.metadata?.pointsLastUpdated ?? null,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (amount === undefined) {
          throw new Error("amount is required for add/subtract");
        }

        const change = action === "add" ? amount : -amount;
        const { newBalance } = await applyPoints(
          client,
          friendId,
          change,
          reason ?? (action === "add" ? "手動付与" : "手動消費"),
          { notify, thresholdTags },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, friendId, action, amount, newBalance },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: false, error: String(error) },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
