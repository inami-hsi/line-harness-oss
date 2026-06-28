import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LineHarness, type Friend } from "@line-harness/sdk";
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

async function listAllByTag(
  client: LineHarness,
  tagId: string,
): Promise<Friend[]> {
  const items: Friend[] = [];
  let offset = 0;
  while (true) {
    const page = await client.friends.list({ tagId, limit: 100, offset });
    items.push(...page.items);
    if (!page.hasNextPage) break;
    offset += 100;
  }
  return items;
}

export function registerRunLottery(server: McpServer): void {
  server.tool(
    "run_lottery",
    "Run a lottery draw from friends who have the entry tag. Randomly picks winners, tags them, and sends a congratulatory LINE message.",
    {
      entryTagId: z
        .string()
        .describe("Tag ID that marks friends who entered the lottery"),
      prizeCount: z
        .number()
        .int()
        .positive()
        .describe("Number of winners to draw"),
      prizeName: z
        .string()
        .optional()
        .describe("Prize description shown in the winner message (default: '当選賞品')"),
      winnerMessage: z
        .string()
        .optional()
        .describe("Custom message sent to winners. If omitted, a default is generated."),
      loserMessage: z
        .string()
        .optional()
        .describe("Message sent to non-winners (optional)"),
      winnerTagName: z
        .string()
        .optional()
        .describe("Tag name applied to winners (default: 'lottery:winner')"),
    },
    async ({
      entryTagId,
      prizeCount,
      prizeName,
      winnerMessage,
      loserMessage,
      winnerTagName,
    }) => {
      try {
        const client = getClient();
        const entrants = await listAllByTag(client, entryTagId);

        if (entrants.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  entrantCount: 0,
                  winners: [],
                  message: "エントリーが0件のため抽選をスキップしました",
                }),
              },
            ],
          };
        }

        const shuffled = [...entrants].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(
          0,
          Math.min(prizeCount, entrants.length),
        );
        const winnerIds = new Set(winners.map((f) => f.id));

        const tagName = winnerTagName ?? "lottery:winner";
        const prize = prizeName ?? "当選賞品";
        const msg =
          winnerMessage ??
          `おめでとうございます！\n抽選の結果、${prize}に当選されました。\n担当者よりご連絡いたします。`;

        const winnerTagId = await ensureTag(client, tagName, "#F59E0B");

        await Promise.all([
          ...winners.map(async (f) => {
            await client.friends.addTag(f.id, winnerTagId);
            await client.sendTextToFriend(f.id, msg);
          }),
          ...(loserMessage
            ? entrants
                .filter((f) => !winnerIds.has(f.id))
                .map((f) => client.sendTextToFriend(f.id, loserMessage!))
            : []),
        ]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  entrantCount: entrants.length,
                  winners: winners.map((f) => ({
                    friendId: f.id,
                    displayName: f.displayName,
                  })),
                },
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
              text: JSON.stringify({ success: false, error: String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
