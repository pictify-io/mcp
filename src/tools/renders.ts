import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { expectField, formatError } from "../utils.js";

/*
 * One history across every format.
 *
 * There used to be a list tool per collection — images and GIFs each had one,
 * PDFs and videos had none — so "what did I render this week" was three calls
 * that could not be merged and two formats that could not be seen at all. This
 * wraps GET /render, which is the same feed the dashboard's Renders page uses,
 * so the answer here and the answer on screen come from one query.
 */
export function registerRenderTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_list_renders",
    "List what this account has rendered — images, GIFs, PDFs and videos in one feed, newest first. " +
      "Filter by format, by the template that produced them, or by what called for them. " +
      "Use this to find an earlier render's URL, to check whether a batch produced what was expected, " +
      "or to report on recent usage. Returns each render's URL, format, dimensions, template and timestamp, " +
      "plus per-format counts and a 14-day daily histogram.",
    {
      format: z
        .enum(["ALL", "PNG", "PDF", "GIF", "MP4"])
        .default("ALL")
        .describe(
          "Restrict to one output format. PNG covers every still image (PNG, JPEG, WebP); " +
            "MP4 covers video renders.",
        ),
      template: z
        .string()
        .optional()
        .describe("Only renders produced by this template UID (image or video template)."),
      source: z
        .string()
        .optional()
        .describe(
          "Only renders made by a particular caller, e.g. 'api' for API-key traffic. " +
            "Omit for every source.",
        ),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(24)
        .describe("How many renders to return (1-100)."),
      offset: z
        .number()
        .min(0)
        .default(0)
        .describe("Skip this many renders, for paging through the feed."),
    },
    async ({ format, template, source, limit, offset }) => {
      try {
        const result = await client.get<{
          renders: Array<Record<string, unknown>>;
          pagination: { total: number; limit: number; offset: number; hasMore: boolean };
          counts: Record<string, unknown>;
        }>("/render", { format, template, source, limit, offset });

        const renders = expectField(result?.renders, "renders", "GET /render");
        const pagination = result?.pagination;

        if (renders.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No renders found${format !== "ALL" ? ` for format ${format}` : ""}` +
                  `${template ? ` from template ${template}` : ""}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                `${renders.length} render${renders.length === 1 ? "" : "s"}` +
                (pagination ? ` of ${pagination.total}` : "") +
                `.\n\n` +
                JSON.stringify({ renders, counts: result?.counts, pagination }, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
