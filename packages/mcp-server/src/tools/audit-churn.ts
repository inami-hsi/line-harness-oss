import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LineHarness, type Friend } from "@line-harness/sdk";
import { getClient } from "../client.js";

type ChurnRisk = "low" | "medium" | "high" | "critical";

const RISK_COLORS: Record<ChurnRisk, string> = {
  low: "#22C55E",
  medium: "#F59E0B",
  high: "#F97316",
  critical: "#DC2626",
};

function estimateChurnRisk(lastActiveDateIso: string, today: Date): ChurnRisk {
  const days =
    (today.getTime() - new Date(lastActiveDateIso).getTime()) /
    (1000 * 60 * 60 * 24);
  if (days > 60) return "critical";
  if (days > 30) return "high";
  if (days > 14) return "medium";
  return "low";
}

function estimateLTV(meta: Record<string, unknown>): number {
  const revenue =
    typeof meta.totalRevenue === "number" ? meta.totalRevenue : 0;
  const count =
    typeof meta.purchaseCount === "number" ? meta.purchaseCount : 0;
  if (count === 0) return 0;
  const first = meta.firstPurchaseDate ?? meta.lastPurchaseDate;
  const last = meta.lastPurchaseDate;
  if (typeof first !== "string" || typeof last !== "string") return revenue;
  const months = Math.max(
    1,
    (new Date(last).getTime() - new Date(first).getTime()) /
      (1000 * 60 * 60 * 24 * 30),
  );
  return Math.round((revenue / months) * 12);
}

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

async function processFriend(
  client: LineHarness,
  friend: Friend,
  today: Date,
  reengagementMessage?: string,
): Promise<{
  friendId: string;
  displayName: string | null;
  risk: ChurnRisk;
  ltv: number;
  daysSinceActive: number;
} | null> {
  const meta = friend.metadata ?? {};
  const lastActive = meta.lastActiveDate ?? meta.lastPurchaseDate;
  if (typeof lastActive !== "string") return null;

  const risk = estimateChurnRisk(lastActive, today);
  const ltv = estimateLTV(meta);
  const daysSinceActive = Math.round(
    (today.getTime() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24),
  );

  const tagId = await ensureTag(
    client,
    `churn:${risk}`,
    RISK_COLORS[risk],
  );
  await client.friends.addTag(friend.id, tagId);
  await client.friends.setMetadata(friend.id, {
    churnRisk: risk,
    estimatedLTV: ltv,
    churnAuditedAt: today.toISOString(),
  });

  if (
    reengagementMessage &&
    (risk === "high" || risk === "critical")
  ) {
    await client.sendTextToFriend(friend.id, reengagementMessage);
  }

  return { friendId: friend.id, displayName: friend.displayName, risk, ltv, daysSinceActive };
}

export function registerAuditChurn(server: McpServer): void {
  server.tool(
    "audit_churn",
    "Scan friends' metadata to estimate churn risk (low/medium/high/critical), apply churn tags, update metadata, and optionally send re-engagement messages to high-risk friends.",
    {
      filterTagId: z
        .string()
        .optional()
        .describe(
          "Only audit friends with this tag (e.g. active-subscriber tag). If omitted all friends are scanned.",
        ),
      reengagementMessage: z
        .string()
        .optional()
        .describe(
          "LINE message sent to 'high' and 'critical' risk friends. If omitted, no message is sent.",
        ),
    },
    async ({ filterTagId, reengagementMessage }) => {
      try {
        const client = getClient();
        const today = new Date();
        const results: Array<{
          friendId: string;
          displayName: string | null;
          risk: ChurnRisk;
          ltv: number;
          daysSinceActive: number;
        }> = [];

        let offset = 0;
        while (true) {
          const page = await client.friends.list({
            limit: 100,
            offset,
            tagId: filterTagId,
          });

          const batch = await Promise.all(
            page.items.map((f) =>
              processFriend(client, f, today, reengagementMessage),
            ),
          );
          results.push(
            ...(batch.filter(Boolean) as typeof results),
          );

          if (!page.hasNextPage) break;
          offset += 100;
        }

        const riskOrder: Record<ChurnRisk, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        results.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);

        const summary = {
          total: results.length,
          critical: results.filter((r) => r.risk === "critical").length,
          high: results.filter((r) => r.risk === "high").length,
          medium: results.filter((r) => r.risk === "medium").length,
          low: results.filter((r) => r.risk === "low").length,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, summary, results },
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
