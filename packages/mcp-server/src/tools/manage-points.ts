import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManagePoints(server: McpServer): void {
  server.tool(
    "manage_points",
    "Add, subtract, or read a friend's mileage balance via the mileage ledger (postMileageEntry). This is a manual adjustment that bypasses the automatic mileage rule engine.",
    {
      action: z
        .enum(["add", "subtract", "get"])
        .describe("'add' posts a positive ledger entry, 'subtract' posts a negative one, 'get' reads the balance"),
      friendId: z.string().describe("Friend ID to operate on"),
      amount: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Point amount (required for add/subtract)"),
      reason: z
        .string()
        .optional()
        .describe("Reason for the point change (stored on the ledger entry, required for add/subtract)"),
    },
    async ({ action, friendId, amount, reason }) => {
      try {
        const client = getClient();

        if (action === "get") {
          const mileage = await client.friends.getMileage(friendId);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, friendId, summary: mileage.summary }, null, 2),
              },
            ],
          };
        }

        if (amount === undefined) {
          throw new Error("amount is required for add/subtract");
        }

        const signedAmount = action === "add" ? amount : -amount;
        const result = await client.friends.adjustMileage(
          friendId,
          signedAmount,
          reason ?? (action === "add" ? "手動付与" : "手動消費"),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, friendId, action, amount, summary: result.summary },
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
