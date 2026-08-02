import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

/*
 * Video templates: render MP4/GIF from saved templates, and generate new
 * templates from a prompt.
 *
 * Renders are LONG requests — the API waits for the finished file and a
 * full video takes minutes, so the render and generate tools override the
 * client's default 60s timeout rather than aborting every real render.
 */
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;

export function registerVideoTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_list_video_templates",
    "List the user's video templates with their UIDs, dimensions, duration and kind. " +
      "Video templates come in two kinds: 'timeline' (built in the visual studio) and 'tsx' " +
      "(single-file Remotion scenes, often AI-generated). Both render the same way. " +
      "WORKFLOW: call this first to find a template UID, then pictify_get_video_template_variables " +
      "to see what it accepts, then pictify_render_video.",
    {},
    async () => {
      try {
        const result = await client.get<{
          templates: Array<{
            uid: string;
            name: string;
            kind: string;
            width: number;
            height: number;
            fps: number;
            durationInFrames: number;
          }>;
        }>("/video/templates");
        const lines = (result.templates || []).map(
          (t) =>
            `- ${t.name || "Untitled"} (${t.uid}) — ${t.kind}, ${t.width}x${t.height}, ` +
            `${Math.round((t.durationInFrames / (t.fps || 30)) * 10) / 10}s`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: lines.length
                ? `${lines.length} video template(s):\n${lines.join("\n")}`
                : "No video templates yet. Create one in the studio at https://pictify.io/dashboard/video-templates/new, or generate one with pictify_generate_video_template.",
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_get_video_template_variables",
    "Get a video template's variable definitions — the fields you can set when rendering it " +
      "(texts, colors, image URLs). Call before pictify_render_video to know what to pass.",
    {
      templateId: z
        .string()
        .describe("The video template UID. Use pictify_list_video_templates to find one."),
    },
    async ({ templateId }) => {
      try {
        const result = await client.get<{
          templateName: string;
          kind: string;
          variables: Array<{ name: string; type?: string; defaultValue?: unknown; description?: string }>;
        }>(`/video/templates/${templateId}/variables`);
        const lines = (result.variables || []).map(
          (v) =>
            `- ${v.name}${v.type ? ` (${v.type})` : ""}${
              v.defaultValue !== undefined ? ` — default: ${JSON.stringify(v.defaultValue)}` : ""
            }${v.description ? ` — ${v.description}` : ""}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: lines.length
                ? `Variables for "${result.templateName}" (${result.kind}):\n${lines.join("\n")}`
                : `"${result.templateName}" declares no variables — it renders the same every time.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_render_video",
    "Render a video template to an MP4 video or an animated GIF, with variable substitutions. " +
      "Common use cases: personalized video messages, social video posts, animated certificates, " +
      "product announcement clips, and GIFs for places an MP4 cannot autoplay (chat, email, READMEs). " +
      "GIF output is palette-optimised and capped at 15fps / 720px wide so files stay shareable. " +
      "WORKFLOW: pictify_list_video_templates → pictify_get_video_template_variables → this tool. " +
      "The render takes up to a few minutes; this tool waits and returns the hosted file URL. " +
      "Each render consumes one video credit.",
    {
      templateId: z
        .string()
        .describe("The video template UID to render"),
      variables: z
        .record(z.unknown())
        .optional()
        .describe(
          "Template variables as key-value pairs. " +
            "Use pictify_get_video_template_variables to discover names and types.",
        ),
      format: z
        .enum(["mp4", "gif"])
        .default("mp4")
        .describe("Output format. 'mp4' for video; 'gif' for an animated GIF of the same render."),
    },
    async ({ templateId, variables, format }) => {
      try {
        const result = await client.post<{
          url: string;
          durationInFrames: number;
          format: string;
        }>(
          `/video/templates/${templateId}/render`,
          { variables, format },
          { timeoutMs: RENDER_TIMEOUT_MS },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `${result.format === "gif" ? "GIF" : "Video"} rendered successfully.\n\nURL: ${result.url}\nDuration: ${result.durationInFrames} frames`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_generate_video_template",
    "Generate a new video template from a text prompt using AI. The service designs a motion " +
      "brief (palette, beats, typography), writes the scene as code, compiles it, renders preview " +
      "frames and visually reviews them — then saves a draft template whose text, colors and " +
      "optional image are editable variables. Use when the user wants a NEW video design; to " +
      "re-render an existing template with different values, use pictify_render_video instead. " +
      "Takes 30-60 seconds and is metered as one render. Returns the template UID and a preview " +
      "image URL; render it with pictify_render_video, or refine it in the studio.",
    {
      prompt: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "What the video is for, with any mood/style guidance. " +
            "Example: 'An 8 second product launch teaser for a developer tool called ShipFast — dark, electric, type-driven'",
        ),
      width: z.number().min(16).max(4096).default(1080).describe("Canvas width in pixels"),
      height: z.number().min(16).max(4096).default(1080).describe("Canvas height in pixels"),
      durationSeconds: z
        .number()
        .min(1)
        .max(60)
        .default(8)
        .describe("Video length in seconds (1-60)"),
      brandColor: z
        .string()
        .optional()
        .describe("Optional brand color (hex) to build the palette around, e.g. '#ff5533'"),
    },
    async ({ prompt, width, height, durationSeconds, brandColor }) => {
      try {
        const result = await client.post<{
          template: { uid: string; name: string; variableDefinitions?: Array<{ name: string }> };
          previewUrl: string | null;
        }>(
          "/video/templates/generate",
          { prompt, width, height, durationSeconds, brandColor },
          { timeoutMs: GENERATE_TIMEOUT_MS },
        );
        const variables = (result.template?.variableDefinitions || [])
          .map((v) => v.name)
          .join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Video template generated.\n\nUID: ${result.template?.uid}\nName: ${result.template?.name}` +
                (variables ? `\nEditable variables: ${variables}` : "") +
                (result.previewUrl ? `\nPreview frame: ${result.previewUrl}` : "") +
                `\n\nRender it with pictify_render_video, or open it in the studio to refine.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
