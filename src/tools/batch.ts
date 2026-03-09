import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerBatchTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_batch_render",
    "Start a batch render job for a template with multiple variable sets. " +
      "Supports up to 100 items per batch. Returns a batchId immediately (does not wait for completion). " +
      "Use pictify_get_batch_results to check job status and retrieve results. " +
      "Use pictify_get_template_variables to discover available variables first.",
    {
      templateId: z
        .string()
        .describe("The template UID to batch render"),
      variableSets: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(100)
        .describe(
          "Array of variable sets (1-100 items). Each item is rendered as a separate image with its own variables.",
        ),
      format: z
        .enum(["png", "jpeg", "webp"])
        .default("png")
        .describe("Output format for all rendered images"),
      quality: z
        .number()
        .min(0.1)
        .max(1)
        .default(1)
        .describe("Output quality (0.1-1.0) for all rendered images"),
      concurrency: z
        .number()
        .min(1)
        .max(10)
        .default(5)
        .describe("Number of concurrent renders (1-10). Higher values are faster but use more quota."),
    },
    async ({ templateId, variableSets, format, quality, concurrency }) => {
      try {
        const result = await client.post<{
          batchId: string;
          total: number;
          status: string;
        }>(`/templates/${templateId}/batch-render`, {
          variableSets,
          format,
          quality,
          concurrency,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Batch render started successfully.\n\n` +
                `Batch ID: ${result.batchId}\n` +
                `Total items: ${result.total}\n` +
                `Status: ${result.status}\n\n` +
                `Use pictify_get_batch_results with this batchId to check progress and get results.`,
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
      "Returns the job status (pending, processing, completed, failed), " +
      "progress information, and result URLs when complete. " +
      "Call this after pictify_batch_render to monitor and retrieve results.",
    {
      batchId: z
        .string()
        .describe("The batch job ID returned by pictify_batch_render"),
    },
    async ({ batchId }) => {
      try {
        const result = await client.get<{
          batchId: string;
          status: string;
          total: number;
          completed: number;
          results: unknown[];
        }>(`/templates/batch/${batchId}/results`);
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
      "Already completed items will retain their results. " +
      "Remaining items will not be processed.",
    {
      batchId: z
        .string()
        .describe("The batch job ID to cancel"),
    },
    async ({ batchId }) => {
      try {
        const result = await client.post<{ status: string }>(
          `/templates/batch/${batchId}/cancel`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Batch job ${batchId} cancelled. Status: ${result.status}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
