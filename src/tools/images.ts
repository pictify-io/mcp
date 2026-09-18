import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError, requireExactlyOne } from "../utils.js";

export function registerImageTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_create_image",
    "Generate a static image (PNG, JPEG, or WebP) from HTML/CSS content, a URL screenshot, or a template. " +
      "Common use cases: Open Graph (OG) images for link previews, social media cards (Twitter/LinkedIn/Facebook), " +
      "product screenshots, marketing banners, event invitations, and custom graphics. " +
      "Provide ONE of: 'html' (custom HTML/CSS), 'url' (screenshot a webpage), or 'template' + 'variables' (render a saved template). " +
      "Returns the hosted image URL (CDN-backed) and asset ID. Maximum dimensions: 4000x4000 pixels. " +
      "IMPORTANT: The renderer captures the element's actual rendered size, not the viewport. " +
      "If your HTML content is shorter than the requested height, the output image will be clipped to the content height. " +
      "To ensure exact dimensions, set explicit width and height on your root element (e.g., a wrapper div) using " +
      "CSS like: position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; — this guarantees the element " +
      "fills the full requested area.",
    {
      html: z
        .string()
        .optional()
        .describe(
          "HTML content to render as an image. Include inline CSS or <style> tags for styling. " +
            "Google Fonts supported via <link> tags. Mutually exclusive with 'url' and 'template'. " +
            "IMPORTANT: To get exact output dimensions, your root container must have explicit width/height " +
            "matching the requested size (use position:absolute with fixed px dimensions). " +
            "Without this, the image will be clipped to the content's natural height.",
        ),
      url: z
        .string()
        .url()
        .optional()
        .describe(
          "URL of a web page to screenshot. Must be publicly accessible http:// or https://. " +
            "Mutually exclusive with 'html' and 'template'.",
        ),
      template: z
        .string()
        .optional()
        .describe(
          "Template UID to render. Use with 'variables' to substitute dynamic values. " +
            "Mutually exclusive with 'html' and 'url'. Use pictify_list_templates to find templates.",
        ),
      variables: z
        .record(z.unknown())
        .optional()
        .describe("Template variables as key-value pairs. Only used when 'template' is provided."),
      width: z
        .number()
        .min(1)
        .max(4000)
        .default(1200)
        .describe(
          "Image width in pixels (1-4000). Common sizes: 1200x630 (OG image), 1080x1080 (Instagram), " +
            "1200x675 (Twitter card), 1920x1080 (presentation slide)",
        ),
      height: z
        .number()
        .min(1)
        .max(4000)
        .default(630)
        .describe("Image height in pixels (1-4000)"),
      fileExtension: z
        .enum(["png", "jpg", "jpeg", "webp"])
        .default("png")
        .describe(
          "Output image format. PNG for transparency support, JPEG/JPG for photos (smaller file size), WebP for best compression.",
        ),
      selector: z
        .string()
        .optional()
        .describe(
          "CSS selector to capture a specific element instead of the full page (e.g., '.card', '#hero'). " +
            "Useful when your HTML contains multiple elements but you only want to capture one.",
        ),
    },
    async ({ html, url, template, variables, width, height, fileExtension, selector }) => {
      try {
        requireExactlyOne(
          { html, url, template },
          "Pass html to render markup you have, url to screenshot a live page, " +
            "or template (a template UID, with variables) to render a saved template.",
        );

        const body: Record<string, unknown> = { width, height, fileExtension };
        if (html) body.html = html;
        if (url) body.url = url;
        if (template) body.template = template;
        if (variables) body.variables = variables;
        if (selector) body.selector = selector;

        const result = await client.post<{ url: string; id: string }>("/image", body);
        return {
          content: [
            {
              type: "text" as const,
              text: `Image generated successfully.\n\nURL: ${result.url}\nID: ${result.id}\nDimensions: ${width}x${height}\nFormat: ${fileExtension}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_get_image",
    "Get details of a specific image by its UID. " +
      "Returns the image URL, dimensions, format, and creation timestamp.",
    {
      imageId: z.string().describe("The image UID to retrieve"),
    },
    async ({ imageId }) => {
      try {
        const result = await client.get<unknown>(`/image/${imageId}`);
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
