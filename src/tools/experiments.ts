import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

const RESERVED_SLUGS = [
  "events",
  "api",
  "admin",
  "health",
  "status",
  "pixel",
  "track",
  "sdk",
];

export function registerExperimentTools(
  server: McpServer,
  client: PictifyClient,
) {
  server.tool(
    "pictify_list_experiments",
    "List A/B test experiments with optional filtering by type and status. " +
      "Returns experiment names, IDs, types, statuses, and variant details.",
    {
      type: z
        .enum(["ab_test", "smart_link", "scheduled"])
        .optional()
        .describe("Filter by experiment type"),
      status: z
        .enum(["draft", "running", "paused", "completed"])
        .optional()
        .describe("Filter by experiment status"),
    },
    async ({ type, status }) => {
      try {
        const result = await client.get<{ experiments: unknown[] }>(
          "/experiments/api",
          { type, status },
        );
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
    "pictify_create_experiment",
    "Create a new A/B test experiment. " +
      "Requires at least 2 variants. Variant weights must sum to exactly 10000 (basis points). " +
      "The slug must be unique, 3-60 characters, and cannot be a reserved word " +
      "(events, api, admin, health, status, pixel, track, sdk). " +
      "Experiment starts in 'draft' status. Use pictify_start_experiment to activate it.",
    {
      name: z.string().describe("Human-readable experiment name"),
      type: z
        .enum(["ab_test", "smart_link", "scheduled"])
        .default("ab_test")
        .describe("Experiment type"),
      slug: z
        .string()
        .min(3)
        .max(60)
        .describe(
          "Unique URL-safe identifier (3-60 chars). Cannot be: events, api, admin, health, status, pixel, track, sdk",
        ),
      variants: z
        .array(
          z.object({
            id: z.string().describe("Unique variant identifier"),
            name: z.string().describe("Human-readable variant name"),
            weight: z
              .number()
              .min(0)
              .max(10000)
              .describe(
                "Traffic weight in basis points. All variant weights must sum to 10000.",
              ),
            config: z
              .record(z.unknown())
              .optional()
              .describe("Variant-specific configuration as a JSON object"),
          }),
        )
        .min(2)
        .describe("At least 2 variants required. Weights must sum to 10000."),
      hypothesis: z
        .string()
        .optional()
        .describe("Hypothesis being tested by this experiment"),
    },
    async ({ name, type, slug, variants, hypothesis }) => {
      // Client-side validations
      if (RESERVED_SLUGS.includes(slug)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: The slug "${slug}" is reserved. Choose a different slug.\nReserved slugs: ${RESERVED_SLUGS.join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
      if (totalWeight !== 10000) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Variant weights must sum to 10000, but yours sum to ${totalWeight}.\nAdjust variant weights so they total exactly 10000 (basis points).`,
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.post<{
          uid: string;
          name: string;
          status: string;
        }>("/experiments/api", { name, type, slug, variants, hypothesis });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Experiment created successfully.\n\n` +
                `ID: ${result.uid}\n` +
                `Name: ${result.name}\n` +
                `Status: ${result.status}\n\n` +
                `Use pictify_start_experiment to activate this experiment.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_get_experiment",
    "Get detailed information about a specific experiment including " +
      "variants, traffic allocation, status, and performance metrics.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to retrieve"),
    },
    async ({ experimentId }) => {
      try {
        const result = await client.get<unknown>(
          `/experiments/api/${experimentId}`,
        );
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
    "pictify_update_experiment",
    "Update an existing experiment. Only provided fields will be updated. " +
      "Some fields may not be editable depending on experiment status " +
      "(e.g., variants cannot be changed while running).",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to update"),
      name: z.string().optional().describe("New experiment name"),
      hypothesis: z
        .string()
        .optional()
        .describe("Updated hypothesis"),
      variants: z
        .array(
          z.object({
            id: z.string().describe("Variant identifier"),
            name: z.string().describe("Variant name"),
            weight: z.number().min(0).max(10000).describe("Traffic weight in basis points"),
            config: z.record(z.unknown()).optional().describe("Variant configuration"),
          }),
        )
        .min(2)
        .optional()
        .describe("Updated variants. Weights must sum to 10000."),
    },
    async ({ experimentId, ...updates }) => {
      // Validate weights if variants provided
      if (updates.variants) {
        const totalWeight = updates.variants.reduce(
          (sum, v) => sum + v.weight,
          0,
        );
        if (totalWeight !== 10000) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Variant weights must sum to 10000, but yours sum to ${totalWeight}.`,
              },
            ],
            isError: true,
          };
        }
      }

      try {
        const body = Object.fromEntries(
          Object.entries(updates).filter(([, v]) => v !== undefined),
        );
        const result = await client.put<{ uid: string; name: string }>(
          `/experiments/api/${experimentId}`,
          body,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment updated successfully.\n\nID: ${result.uid}\nName: ${result.name}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_delete_experiment",
    "Delete an experiment. This is a soft delete and cannot be undone. " +
      "Running experiments should be paused or completed first.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to delete"),
    },
    async ({ experimentId }) => {
      try {
        await client.del(`/experiments/api/${experimentId}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment ${experimentId} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_start_experiment",
    "Start a draft or paused experiment, making it active and routing traffic to variants. " +
      "Only valid for experiments in 'draft' or 'paused' status. " +
      "Running or completed experiments cannot be started.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to start"),
    },
    async ({ experimentId }) => {
      try {
        const result = await client.post<{ uid: string; status: string }>(
          `/experiments/api/${experimentId}/start`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment started.\n\nID: ${result.uid}\nStatus: ${result.status}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_pause_experiment",
    "Pause a running experiment, stopping traffic routing to variants. " +
      "Only valid for experiments in 'running' status. " +
      "Use pictify_start_experiment to resume a paused experiment.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to pause"),
    },
    async ({ experimentId }) => {
      try {
        const result = await client.post<{ uid: string; status: string }>(
          `/experiments/api/${experimentId}/pause`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment paused.\n\nID: ${result.uid}\nStatus: ${result.status}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_complete_experiment",
    "Complete an experiment by declaring a winning variant. " +
      "Only valid for experiments in 'running' or 'paused' status. " +
      "This is a final action — completed experiments cannot be restarted. " +
      "Requires the winning variant's ID.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to complete"),
      winnerVariantId: z
        .string()
        .describe(
          "The ID of the winning variant. Must be one of the experiment's variant IDs.",
        ),
    },
    async ({ experimentId, winnerVariantId }) => {
      try {
        const result = await client.post<{ uid: string; status: string }>(
          `/experiments/api/${experimentId}/complete`,
          { winnerVariantId },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment completed.\n\nID: ${result.uid}\nStatus: ${result.status}\nWinner: ${winnerVariantId}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
