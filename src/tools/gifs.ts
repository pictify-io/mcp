import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

/*
 * Read-only by design. GIF *creation* is the video pipeline's job now —
 * pictify_render_video with format: "gif" — so pictify_create_gif (HTML with
 * CSS keyframes) and pictify_capture_gif (recording a live page) are gone.
 * These two stay because accounts still hold GIFs made the old way.
 */
export function registerGifTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_list_gifs",
    "List previously generated GIFs from your account with pagination. " +
      "Returns GIF URLs, IDs, dimensions, animation duration, and creation timestamps. " +
      "Use this to browse your GIF history or find a previously generated animation.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(30)
        .describe("Number of GIFs to return (1-100)"),
      offset: z
        .number()
        .min(0)
        .default(0)
        .describe("Number of GIFs to skip for pagination"),
    },
    async ({ limit, offset }) => {
      try {
        const result = await client.get<{ gifs: unknown[] }>("/gif", {
          limit,
          offset,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_get_gif",
    "Get details of a specific GIF by its UID. No authentication required. " +
      "Returns the GIF URL, dimensions, and animation details.",
    {
      gifId: z.string().describe("The GIF UID to retrieve"),
    },
    async ({ gifId }) => {
      try {
        const result = await client.get<unknown>(`/gif/${gifId}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
