import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError, requireExactlyOne, ToolInputError } from "../utils.js";

export function registerBatchTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_batch_render",
    "Render one template many times — one image per row of data.\n\n" +
      "Pass EITHER variableSets (rows inline) OR csvUrl with mappings (rows from a hosted CSV). " +
      "Exactly one; a call with neither is rejected.\n\n" +
      "Steps: call pictify_get_template_variables first to see what the template expects, " +
      "call this tool, then poll pictify_get_batch_results with the returned batchId. " +
      "The job is asynchronous — this returns immediately, before any image exists.\n\n" +
      "Up to 100 rows per batch, plan-dependent. " +
      "For many rows in one PDF instead of many images, use pictify_render_multi_page_pdf.",
    {
      templateId: z
        .string()
        .describe("The template UID to batch render"),
      variableSets: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Array of variable sets (1-100 items). Each item produces a separate image. " +
            "Example: [{ name: 'Alice', role: 'CEO' }, { name: 'Bob', role: 'CTO' }] generates 2 images. " +
            "Provide EITHER variableSets OR csvUrl, not both.",
        ),
      csvUrl: z
        .string()
        .url()
        .optional()
        .describe(
          "CSV mode: URL of a publicly fetchable CSV file — every row becomes one render. " +
            "Use with 'mappings' to map CSV columns onto template variables. " +
            "Provide EITHER csvUrl OR variableSets, not both.",
        ),
      mappings: z
        .record(z.string())
        .optional()
        .describe(
          "CSV mode: { templateVariable: 'CSV Column' } pairs — the KEY is the template variable, " +
            "the VALUE is the CSV column name, e.g. { name: 'attendee_name' }. " +
            "Required when csvUrl is provided.",
        ),
      format: z
        .enum(["png", "jpeg", "webp"])
        .default("png")
        .describe("Output format for all rendered images"),
      quality: z
        .number()
        .min(0.1)
        .max(1)
        .default(0.9)
        .describe("Output quality (0.1-1.0) for all rendered images. Only affects JPEG and WebP."),
      concurrency: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe(
          "Number of concurrent renders (1-10). Higher values complete faster but consume quota faster. " +
            "Plan limits: Free=1, Pro=3, Business=10.",
        ),
      layout: z
        .string()
        .optional()
        .describe(
          "Render all batch items using a specific layout variant (e.g., 'twitter-post'). " +
            "Omit for default layout.",
        ),
      layouts: z
        .array(z.string())
        .optional()
        .describe(
          "Render all batch items across multiple layout variants. " +
            "Use 'default' for the base layout. Example: ['default', 'twitter-post']. " +
            "Each batch item will produce one image per layout (2D results).",
        ),
    },
    async ({ templateId, variableSets, csvUrl, mappings, format, quality, concurrency, layout, layouts }) => {
      try {
        requireExactlyOne(
          { variableSets, csvUrl },
          "variableSets is an array of { variable: value } objects, one per image. " +
            "csvUrl is a publicly fetchable CSV whose rows become the images, and needs mappings. " +
            "Call pictify_get_template_variables first to see which variables the template expects.",
        );
        if (csvUrl && !mappings) {
          throw new ToolInputError("CSV mode needs 'mappings' ({ templateVariable: 'CSV Column' }).");
        }
        const body: Record<string, unknown> = {
          format,
          quality,
          concurrency,
        };
        if (variableSets) body.variableSets = variableSets;
        if (csvUrl) {
          body.csvUrl = csvUrl;
          body.mappings = mappings;
        }
        if (layouts && layouts.length > 0) {
          body.layouts = layouts;
        } else if (layout) {
          body.layout = layout;
        }

        const result = await client.post<{
          batchId: string;
          totalItems: number;
          status: string;
          message: string;
        }>(`/templates/${templateId}/batch-render`, body);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Batch render started successfully.\n\n` +
                `Batch ID: ${result.batchId}\n` +
                `Total items: ${result.totalItems}\n` +
                `Status: ${result.status}\n\n` +
                `The job is processing in the background.\n` +
                `Use pictify_get_batch_results with batchId '${result.batchId}' to check progress and retrieve image URLs.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_get_batch_results",
    "Check the status and results of a batch render job. " +
      "Returns the job status (pending, processing, completed, failed, partial, cancelled), " +
      "progress percentage, item counts, and image URLs for completed items. " +
      "Each result includes index, success boolean, URL, dimensions, and error message (if failed). " +
      "Call this after pictify_batch_render. " +
      "If status is 'processing', call again after a few seconds to check for updates.",
    {
      batchId: z
        .string()
        .describe("The batch job ID returned by pictify_batch_render"),
    },
    async ({ batchId }) => {
      try {
        const result = await client.get<unknown>(`/templates/batch/${batchId}/results`);
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
    "pictify_cancel_batch",
    "Cancel a running batch render job. " +
      "Already completed items will retain their results and URLs. " +
      "Remaining unprocessed items will be skipped. " +
      "Use this if you started a batch with incorrect data or no longer need the remaining results.",
    {
      batchId: z
        .string()
        .describe("The batch job ID to cancel"),
    },
    async ({ batchId }) => {
      try {
        const result = await client.post<{ batchId: string; status: string; message: string }>(
          `/templates/batch/${batchId}/cancel`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Batch job ${result.batchId} cancelled.\nStatus: ${result.status}\n${result.message || ""}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
