import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { expectField, formatError, ToolInputError } from "../utils.js";

/*
 * Video templates: render MP4/GIF from saved templates, and generate new
 * templates from a prompt.
 *
 * Renders are LONG requests — the API waits for the finished file and a
 * full video takes minutes, so the render and generate tools override the
 * client's default 60s timeout rather than aborting every real render.
 */
/*
 * Headroom over the backend's own caps, not equal to them: the render cap is
 * 5m server-side (+30s socket grace), and generation is a 5m cap PLUS an
 * awaited poster render — aborting at the exact server cap turns a slow
 * SUCCESS (billed, saved) into a client-side 408 where the agent never
 * learns the template uid.
 */
const RENDER_TIMEOUT_MS = 6 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 11 * 60 * 1000;

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
      "GIF output: timeline templates are palette-converted and capped at 15fps / 720px wide; " +
      "code (tsx) templates encode GIF natively at half the composition frame rate with no width cap. " +
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
    "pictify_create_video_template",
    "Upload a Remotion scene YOU wrote as a new video template. Use when you want full creative " +
      "control over the composition — write the TSX yourself instead of delegating the design to " +
      "pictify_generate_video_template. The source passes a compile gate before anything is saved: " +
      "on failure you get the compiler errors back and NO template is created, so fix the code and " +
      "call again. " +
      "SCENE RULES (violations fail the compile gate or the render): " +
      "(1) Single file. It must contain `export const schema = z.object({...})` AND `export default` " +
      "a React function component typed with the schema's props. Every schema field must be flat, " +
      "carry .default(...), and use .describe('...') — fields become the template's editable variables. " +
      "(2) Imports ONLY from 'remotion', 'react' and 'zod'. No other packages, no relative imports. " +
      "(3) ALL animation via useCurrentFrame() + useVideoConfig() with interpolate() and spring(). " +
      "CSS transitions/animations and Tailwind are forbidden. Always clamp: " +
      "{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }. " +
      "(4) Layout with <AbsoluteFill>, inline styles, system font stacks. If you use <Sequence>, it " +
      "MUST carry layout=\"none\" and integer literals for from/durationInFrames. " +
      "(5) No external assets: no fetch, no hard-coded media URLs. Media only via optional string " +
      "props rendered with <Img> from 'remotion'. Use remotion's random(seed), never Math.random(). " +
      "(6) Never reference require, eval, dynamic import(), fs, child_process, or the word 'process' " +
      "— not even in comments or identifiers.",
    {
      name: z.string().min(1).max(200).describe("Template name shown in the dashboard"),
      tsx: z
        .string()
        .min(1)
        .describe("The complete single-file Remotion scene source, following the rules above"),
      width: z.number().min(16).max(4096).default(1080).describe("Canvas width in pixels"),
      height: z.number().min(16).max(4096).default(1080).describe("Canvas height in pixels"),
      fps: z.number().min(1).max(60).default(30).describe("Frames per second"),
      durationSeconds: z
        .number()
        .min(1)
        .max(60)
        .default(8)
        .describe("Video length in seconds (1-60)"),
    },
    async ({ name, tsx, width, height, fps, durationSeconds }) => {
      try {
        const result = await client.post<{
          template: {
            uid: string;
            name: string;
            variableDefinitions?: Array<{ name: string }>;
          };
        }>(
          "/video/templates",
          {
            name,
            kind: "tsx",
            tsx,
            width,
            height,
            fps,
            durationInFrames: Math.round(durationSeconds * fps),
            status: "draft",
          },
          // The compile gate bundles the scene with webpack — comfortably
          // slower than the 60s default on a cold cache.
          { timeoutMs: 3 * 60 * 1000 },
        );
        const variables = (result.template?.variableDefinitions || [])
          .map((v) => v.name)
          .join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Video template created and compiled.\n\nUID: ${result.template?.uid}\nName: ${result.template?.name}` +
                (variables ? `\nEditable variables (from your schema): ${variables}` : "") +
                `\n\nRender it with pictify_render_video (mp4 or gif), or open it in the studio to refine. ` +
                `A poster thumbnail is rendered automatically in the background.`,
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

  /*
   * Parity with the image-template tools. A video template could be created,
   * listed and rendered but never read back, edited or removed — so an agent
   * that made one it did not want had no way to clean up, and no way to change
   * a name or a duration without going to the dashboard.
   */

  server.tool(
    "pictify_get_video_template",
    "Get one video template in full — its kind (timeline or tsx code), dimensions, fps, duration, " +
      "variable definitions and current status. Use this before updating one, to see what is there.",
    {
      templateId: z.string().describe("The video template UID to retrieve"),
    },
    async ({ templateId }) => {
      try {
        const result = await client.get<unknown>(`/video/templates/${templateId}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_update_video_template",
    "Update a video template's name, dimensions, frame rate, duration, variable definitions, " +
      "or — for code (tsx) templates only — its Remotion source. " +
      "Only the fields you pass change. " +
      "Timeline templates reject 'tsx': those are edited as a scene graph, not as code.",
    {
      templateId: z.string().describe("The video template UID to update"),
      name: z.string().optional().describe("New template name"),
      tsx: z
        .string()
        .optional()
        .describe(
          "Replacement Remotion component source. Code (tsx) templates only — sending this " +
            "for a timeline template is rejected.",
        ),
      width: z.number().min(1).max(4000).optional().describe("Composition width in pixels"),
      height: z.number().min(1).max(4000).optional().describe("Composition height in pixels"),
      fps: z.number().min(1).max(120).optional().describe("Frames per second"),
      durationInFrames: z
        .number()
        .min(1)
        .optional()
        .describe("Composition length in frames (seconds x fps)"),
      variableDefinitions: z
        .record(z.unknown())
        .optional()
        .describe("Replacement variable schema for the template"),
    },
    async ({ templateId, ...updates }) => {
      try {
        const body = Object.fromEntries(
          Object.entries(updates).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(body).length === 0) {
          throw new ToolInputError(
            "Nothing to update. Pass at least one of name, tsx, width, height, fps, " +
              "durationInFrames or variableDefinitions.",
          );
        }

        const result = await client.put<{ template?: { uid: string; name: string } }>(
          `/video/templates/${templateId}`,
          body,
        );
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Video template updated.\n\nUID: ${result?.template?.uid ?? templateId}` +
                `\nName: ${result?.template?.name ?? "(unchanged)"}` +
                `\nChanged: ${Object.keys(body).join(", ")}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_duplicate_video_template",
    "Copy a video template into a new one, leaving the original untouched. " +
      "Use this to branch a working template before changing it. " +
      "The copy counts against the saved-template limit on your plan.",
    {
      templateId: z.string().describe("The video template UID to copy"),
    },
    async ({ templateId }) => {
      try {
        const result = await client.post<{ template?: { uid: string; name: string } }>(
          `/video/templates/${templateId}/duplicate`,
        );
        const template = expectField(
          result?.template,
          "template",
          `POST /video/templates/${templateId}/duplicate`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Video template duplicated.\n\nNew UID: ${template.uid}\nName: ${template.name}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_delete_video_template",
    "Permanently delete a video template. This cannot be undone, and any automation rendering " +
      "from it stops working. Renders already produced from it are unaffected.",
    {
      templateId: z.string().describe("The video template UID to delete"),
    },
    async ({ templateId }) => {
      try {
        await client.del(`/video/templates/${templateId}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Video template ${templateId} deleted.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
