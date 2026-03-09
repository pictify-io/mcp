import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient, PictifyApiError } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerImageTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_create_image",
    "Generate a static image (PNG, JPEG, or WebP) from raw HTML/CSS content. " +
      "Use this when the user wants to create an image from scratch with custom HTML. " +
      "For rendering a saved template, use pictify_render_template instead. " +
      "Returns the image URL and metadata. Maximum dimensions: 4000x4000 pixels.",
    {
      html: z
        .string()
        .describe(
          "Complete HTML content to render as an image. Include inline CSS for styling.",
        ),
      width: z
        .number()
        .min(1)
        .max(4000)
        .default(1200)
        .describe("Image width in pixels (1-4000)"),
      height: z
        .number()
        .min(1)
        .max(4000)
        .default(630)
        .describe("Image height in pixels (1-4000)"),
      format: z
        .enum(["png", "jpeg", "webp"])
        .default("png")
        .describe("Output image format"),
    },
    async ({ html, width, height, format }) => {
      try {
        const result = await client.post<{ url: string; id: string }>("/image", {
          html,
          width,
          height,
          fileExtension: format,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Image generated successfully.\n\nURL: ${result.url}\nID: ${result.id}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_screenshot",
    "Capture a screenshot of a web page at a given URL. " +
      "Use this when the user wants to take a screenshot of an existing website or web page. " +
      "For creating images from custom HTML, use pictify_create_image instead. " +
      "Returns the screenshot image URL.",
    {
      url: z
        .string()
        .url()
        .describe("URL of the web page to screenshot. Must be http:// or https://"),
      width: z
        .number()
        .min(1)
        .max(4000)
        .default(1200)
        .describe("Viewport width in pixels (1-4000)"),
      height: z
        .number()
        .min(1)
        .max(4000)
        .default(630)
        .describe("Viewport height in pixels (1-4000)"),
      fullPage: z
        .boolean()
        .default(false)
        .describe("Whether to capture the full page including scrollable content"),
    },
    async ({ url, width, height, fullPage }) => {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: URL must start with http:// or https://",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.post<{ url: string; id: string }>("/image", {
          url,
          width,
          height,
          fullPage,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Screenshot captured successfully.\n\nURL: ${result.url}\nID: ${result.id}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_list_images",
    "List previously generated images with pagination. " +
      "Returns image URLs, IDs, and creation dates. " +
      "Use limit and offset for pagination.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of images to return (1-100)"),
      offset: z
        .number()
        .min(0)
        .default(0)
        .describe("Number of images to skip for pagination"),
    },
    async ({ limit, offset }) => {
      try {
        const result = await client.get<{ images: unknown[] }>("/image", {
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
