import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerGifTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_create_gif",
    "Create an animated GIF from HTML content with CSS animations, a URL, or a template. " +
      "The HTML must contain CSS @keyframes animations, transitions, or JavaScript animations to produce frames. " +
      "Common use cases: animated banners, loading spinners, product demos, social media animations, " +
      "animated logos, and eye-catching ad creatives. " +
      "Provide ONE of: 'html' (custom animated HTML/CSS), 'url' (capture from webpage), " +
      "or 'template' + 'variables' (render a saved template). " +
      "For recording a GIF from a live website over a specified duration, use pictify_capture_gif instead. " +
      "Returns the hosted GIF URL and animation duration. Maximum dimensions: 2000x2000 pixels.",
    {
      html: z
        .string()
        .optional()
        .describe(
          "HTML content with CSS animations to render as an animated GIF. " +
            "Must include CSS @keyframes or transitions for animation. " +
            "Mutually exclusive with 'url' and 'template'.",
        ),
      url: z
        .string()
        .url()
        .optional()
        .describe(
          "URL of a web page to capture as a GIF. Mutually exclusive with 'html' and 'template'.",
        ),
      template: z
        .string()
        .optional()
        .describe(
          "Template UID to render as a GIF. Use with 'variables'. Mutually exclusive with 'html' and 'url'.",
        ),
      variables: z
        .record(z.unknown())
        .optional()
        .describe("Template variables as key-value pairs. Only used when 'template' is provided."),
      width: z
        .number()
        .min(1)
        .max(2000)
        .default(800)
        .describe("GIF width in pixels (1-2000). Keep dimensions reasonable for file size."),
      height: z
        .number()
        .min(1)
        .max(2000)
        .default(600)
        .describe("GIF height in pixels (1-2000)"),
    },
    async ({ html, url, template, variables, width, height }) => {
      try {
        const body: Record<string, unknown> = { width, height };
        if (html) body.html = html;
        if (url) body.url = url;
        if (template) body.template = template;
        if (variables) body.variables = variables;

        const result = await client.post<{
          gif: { url: string; uid: string; animationLength: number };
        }>("/gif", body);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `GIF created successfully.\n\n` +
                `URL: ${result.gif.url}\n` +
                `ID: ${result.gif.uid}\n` +
                `Animation length: ${result.gif.animationLength}s\n` +
                `Dimensions: ${width}x${height}`,
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
    "Record an animated GIF from a live web page URL by capturing its on-screen activity over time. " +
      "The page is loaded in a headless browser and recorded for the specified duration. " +
      "Use cases: capturing CSS/JS animations on live sites, recording interactive demos, " +
      "documenting UI transitions, creating product walkthroughs. " +
      "This operation takes time proportional to the duration setting (up to 30 seconds). " +
      "For creating GIFs from custom HTML with CSS animations, use pictify_create_gif instead. " +
      "Returns the hosted GIF URL.",
    {
      url: z
        .string()
        .url()
        .describe("URL of the web page to capture as a GIF. Must be a publicly accessible http:// or https:// URL."),
      width: z
        .number()
        .min(1)
        .max(2000)
        .default(800)
        .describe("Capture viewport width in pixels (1-2000)"),
      height: z
        .number()
        .min(1)
        .max(2000)
        .default(600)
        .describe("Capture viewport height in pixels (1-2000)"),
      quality: z
        .enum(["low", "medium", "high"])
        .default("medium")
        .describe(
          "GIF quality preset. 'low' (10fps, up to 10s), 'medium' (15fps, up to 15s), " +
            "'high' (24fps, up to 30s). Higher quality = larger file size.",
        ),
      frameDurationSeconds: z
        .number()
        .min(1)
        .max(30)
        .optional()
        .describe(
          "Recording duration in seconds (1-30). The page is captured for this many seconds. " +
            "Longer durations produce larger GIF files and take longer to process.",
        ),
    },
    async ({ url, width, height, quality, frameDurationSeconds }) => {
      try {
        const body: Record<string, unknown> = { url, width, height, quality };
        if (frameDurationSeconds) body.frameDurationSeconds = frameDurationSeconds;

        const result = await client.post<{
          gif: { url: string; uid: string };
        }>("/gif/capture", body);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `GIF captured successfully.\n\n` +
                `URL: ${result.gif.url}\n` +
                `ID: ${result.gif.uid}`,
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
