import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerGifTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_create_gif",
    "Create an animated GIF from HTML content with CSS animations. " +
      "The HTML must contain CSS animations or transitions to produce animation frames. " +
      "For capturing a GIF from a live website, use pictify_capture_gif instead. " +
      "Returns the GIF URL. Maximum dimensions: 2000x2000 pixels.",
    {
      html: z
        .string()
        .describe(
          "HTML content with CSS animations to render as an animated GIF.",
        ),
      width: z
        .number()
        .min(1)
        .max(2000)
        .default(800)
        .describe("GIF width in pixels (1-2000)"),
      height: z
        .number()
        .min(1)
        .max(2000)
        .default(600)
        .describe("GIF height in pixels (1-2000)"),
    },
    async ({ html, width, height }) => {
      try {
        const result = await client.post<{
          gif: { url: string; uid: string; animationLength: number };
        }>("/gif", { html, width, height });
        return {
          content: [
            {
              type: "text" as const,
              text: `GIF created successfully.\n\nURL: ${result.gif.url}\nID: ${result.gif.uid}\nAnimation length: ${result.gif.animationLength}s`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_capture_gif",
    "Capture an animated GIF from a live web page URL. " +
      "Records the page for a specified duration and converts it to a GIF. " +
      "This operation can take up to 30 seconds depending on the duration setting. " +
      "For creating GIFs from custom HTML with CSS animations, use pictify_create_gif instead. " +
      "Returns the GIF URL.",
    {
      url: z
        .string()
        .url()
        .describe("URL of the web page to capture as a GIF. Must be http:// or https://"),
      width: z
        .number()
        .min(1)
        .max(2000)
        .default(800)
        .describe("Capture width in pixels (1-2000)"),
      height: z
        .number()
        .min(1)
        .max(2000)
        .default(600)
        .describe("Capture height in pixels (1-2000)"),
      quality: z
        .enum(["low", "medium", "high"])
        .default("medium")
        .describe("GIF quality level. Higher quality = larger file size."),
      duration: z
        .number()
        .min(1)
        .max(30)
        .default(3)
        .describe("Capture duration in seconds (1-30). Longer durations take more time to process."),
    },
    async ({ url, width, height, quality, duration }) => {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          content: [
            { type: "text" as const, text: "Error: URL must start with http:// or https://" },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.post<{
          gif: { url: string; uid: string };
        }>("/gif/capture", {
          url,
          width,
          height,
          quality,
          frameDurationSeconds: duration,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `GIF captured successfully.\n\nURL: ${result.gif.url}\nID: ${result.gif.uid}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_list_gifs",
    "List previously generated GIFs with pagination. " +
      "Returns GIF URLs, IDs, dimensions, and animation details. " +
      "Use limit and offset for pagination.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
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
}
