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
      "Pictify experiments let you test different image variants to optimize for engagement. " +
      "Types: 'ab_test' (split traffic between variants with Thompson Sampling auto-optimization), " +
      "'smart_link' (rules-based personalization by device/geo/time/browser/referrer), " +
      "'scheduled' (time-based image swapping with cron/daily/weekly recurrence). " +
      "Returns experiment names, IDs, types, statuses, variant details, and pagination info.",
    {
      type: z
        .enum(["ab_test", "smart_link", "scheduled"])
        .optional()
        .describe(
          "Filter by experiment type. " +
            "'ab_test': split traffic between image variants with auto-optimization. " +
            "'smart_link': serve different images based on rules (device, location, time, browser, referrer). " +
            "'scheduled': swap images on a schedule (daily, weekly, cron expression).",
        ),
      status: z
        .enum(["draft", "running", "paused", "completed"])
        .optional()
        .describe("Filter by experiment status"),
      page: z
        .number()
        .min(1)
        .default(1)
        .optional()
        .describe("Page number for pagination"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .optional()
        .describe("Number of results per page (1-100)"),
    },
    async ({ type, status, page, limit }) => {
      try {
        const result = await client.get<unknown>(
          "/experiments/api",
          { type, status, page, limit },
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
    "Create a new experiment to test different image variants. " +
      "WORKFLOW: 1) Create the experiment (starts in 'draft' status), " +
      "2) Use pictify_start_experiment to begin routing traffic, " +
      "3) Use pictify_get_experiment to monitor variant impressions/clicks, " +
      "4) Use pictify_complete_experiment to declare a winner. " +
      "Requires at least 2 variants. Variant weights must sum to exactly 10000 (basis points, i.e., 5000 = 50%). " +
      "The slug becomes part of the experiment URL and must be unique, 3-60 chars, lowercase alphanumeric and hyphens. " +
      "For A/B tests, enable banditConfig to use Thompson Sampling auto-optimization.",
    {
      name: z.string().describe("Human-readable experiment name (e.g., 'Homepage CTA Button Test')"),
      type: z
        .enum(["ab_test", "smart_link", "scheduled"])
        .describe(
          "Experiment type. " +
            "'ab_test': randomly split traffic between variants (supports auto-optimization). " +
            "'smart_link': serve variants based on condition rules (device, country, time, custom properties). " +
            "'scheduled': automatically swap images on a time-based schedule (daily, weekly, cron).",
        ),
      slug: z
        .string()
        .min(3)
        .max(60)
        .describe(
          "Unique URL-safe identifier for this experiment (3-60 chars, lowercase alphanumeric + hyphens). " +
            "Used in tracking URLs: /s/{slug}/pixel.gif, /s/{slug}/click. " +
            "Cannot be reserved words: events, api, admin, health, status, pixel, track, sdk.",
        ),
      variants: z
        .array(
          z.object({
            id: z.string().describe("Unique variant identifier (e.g., 'control', 'variant-a'). Alphanumeric, hyphens, underscores."),
            name: z.string().optional().describe("Human-readable variant name (e.g., 'Original Design', 'Green CTA Button')"),
            templateUid: z.string().optional().describe("Template UID for this variant (overrides the experiment-level templateUid)"),
            variables: z
              .record(z.unknown())
              .optional()
              .describe("Template variables for this variant"),
            weight: z
              .number()
              .min(0)
              .max(10000)
              .describe(
                "Traffic weight in basis points (100 = 1%). All variant weights must sum to exactly 10000. " +
                  "Example: 2 variants at 5000 each = 50/50 split.",
              ),
            isDefault: z.boolean().optional().describe("Whether this is the default/fallback variant"),
            conditions: z
              .record(z.unknown())
              .optional()
              .describe(
                "Condition tree for smart_link type. Nested AND/OR rules (max depth 3). " +
                  "Rule properties: device, country, time, custom. " +
                  "Operators: equals, not_equals, contains, not_contains, starts_with, ends_with, gt, lt, gte, lte.",
              ),
            schedule: z
              .record(z.unknown())
              .optional()
              .describe(
                "Schedule config for scheduled type. Fields: startAt (ISO 8601), endAt (ISO 8601), " +
                  "recurrence: { type: none|daily|weekly|cron, cronExpression, timezone }.",
              ),
          }),
        )
        .min(2)
        .describe(
          "At least 2 variants required. Weights must sum to 10000. " +
            "Example: [{ id: 'control', name: 'Original', weight: 5000, templateUid: 'tmpl_123' }, " +
            "{ id: 'variant-a', name: 'New Design', weight: 5000, templateUid: 'tmpl_456' }]",
        ),
      templateUid: z
        .string()
        .optional()
        .describe("Default template UID for all variants. Individual variants can override this."),
      goalConfig: z
        .object({
          type: z
            .enum(["impressions_only", "click_through"])
            .default("impressions_only")
            .describe("Goal type. 'click_through' requires destinationUrl."),
          destinationUrl: z
            .string()
            .url()
            .optional()
            .describe("Redirect URL for click-through goals. Users clicking the experiment link go here."),
        })
        .optional()
        .describe("Goal configuration. Determines what counts as a conversion."),
      banditConfig: z
        .object({
          enabled: z.boolean().default(false).describe("Enable auto-optimization (A/B tests only)"),
          algorithm: z
            .enum(["thompson_sampling", "epsilon_greedy"])
            .default("thompson_sampling")
            .describe("Optimization algorithm"),
          warmupImpressions: z
            .number()
            .default(50)
            .optional()
            .describe("Minimum impressions per variant before optimization begins"),
          recomputeIntervalMinutes: z
            .number()
            .default(15)
            .optional()
            .describe("How often to recalculate optimal weights (minutes)"),
        })
        .optional()
        .describe("Auto-optimization settings. Only applies to ab_test type. Uses Thompson Sampling to shift traffic toward the winning variant."),
      hypothesis: z
        .string()
        .max(500)
        .optional()
        .describe(
          "Hypothesis being tested (e.g., 'A green CTA button will increase click-through rate by 15%'). " +
            "Optional but recommended for tracking experiment goals.",
        ),
      minimumSampleSize: z
        .number()
        .default(1000)
        .optional()
        .describe("Minimum impressions before results are considered statistically significant"),
      confidenceThreshold: z
        .number()
        .default(0.95)
        .optional()
        .describe("Required confidence level (0-1) to declare a winner (default 0.95 = 95%)"),
      minimumRunDays: z
        .number()
        .default(7)
        .optional()
        .describe("Minimum days the experiment must run before completion"),
      outputConfig: z
        .object({
          format: z.enum(["png", "jpeg", "webp"]).default("png"),
          quality: z.number().default(90),
        })
        .optional()
        .describe("Output image format and quality for rendered variants"),
      fallbackImageUrl: z
        .string()
        .url()
        .optional()
        .describe("Fallback image URL to serve if the experiment or variant fails to render"),
    },
    async ({ name, type, slug, variants, templateUid, goalConfig, banditConfig, hypothesis, minimumSampleSize, confidenceThreshold, minimumRunDays, outputConfig, fallbackImageUrl }) => {
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
              text: `Error: Variant weights must sum to 10000, but yours sum to ${totalWeight}.\nAdjust variant weights so they total exactly 10000 (basis points). Example: 2 variants at 5000 each = 50/50 split.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const body: Record<string, unknown> = { name, type, slug, variants };
        if (templateUid) body.templateUid = templateUid;
        if (goalConfig) body.goalConfig = goalConfig;
        if (banditConfig) body.banditConfig = banditConfig;
        if (hypothesis) body.hypothesis = hypothesis;
        if (minimumSampleSize !== undefined) body.minimumSampleSize = minimumSampleSize;
        if (confidenceThreshold !== undefined) body.confidenceThreshold = confidenceThreshold;
        if (minimumRunDays !== undefined) body.minimumRunDays = minimumRunDays;
        if (outputConfig) body.outputConfig = outputConfig;
        if (fallbackImageUrl) body.fallbackImageUrl = fallbackImageUrl;

        const result = await client.post<{
          experiment: { uid: string; name: string; status: string };
        }>("/experiments/api", body);
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Experiment created successfully.\n\n` +
                `ID: ${result.experiment.uid}\n` +
                `Name: ${result.experiment.name}\n` +
                `Status: ${result.experiment.status} (not yet routing traffic)\n\n` +
                `Next steps:\n` +
                `1. Use pictify_start_experiment with ID '${result.experiment.uid}' to begin routing traffic\n` +
                `2. Embed tracking pixel: /s/${slug}/pixel.gif\n` +
                `3. Click tracking link: /s/${slug}/click`,
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
    "Get detailed information about a specific experiment. " +
      "Returns the experiment's name, type, status, slug, variants with their configurations, " +
      "traffic weights, impression/click counts per variant, hypothesis, goal and bandit configuration, " +
      "confidence threshold, minimum run days, and timestamps. " +
      "Use this to monitor experiment performance and review setup before making changes.",
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
    "pictify_get_experiment_quota",
    "Check experiment usage and limits for your current plan. " +
      "Returns quota usage for each experiment type (ab_test, smart_link, scheduled), " +
      "maximum variants allowed per experiment, and analytics retention period in days. " +
      "Use this before creating experiments to check if you have quota remaining.",
    {},
    async () => {
      try {
        const result = await client.get<unknown>("/experiments/api/quota");
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
    "Update an existing experiment. Available fields depend on the current status:\n" +
      "- draft/paused: All fields can be updated (name, slug, variants, goalConfig, banditConfig, hypothesis, etc.)\n" +
      "- running: Only name, confidenceThreshold, minimumRunDays, goalConfig.destinationUrl\n" +
      "- completed: Only name\n\n" +
      "If updating variants, weights must still sum to 10000.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to update"),
      name: z.string().optional().describe("New experiment name"),
      slug: z.string().optional().describe("New slug (only when draft/paused)"),
      hypothesis: z.string().optional().describe("Updated hypothesis"),
      variants: z
        .array(
          z.object({
            id: z.string().describe("Variant identifier"),
            name: z.string().optional().describe("Variant name"),
            templateUid: z.string().optional(),
            variables: z.record(z.unknown()).optional(),
            weight: z.number().min(0).max(10000).describe("Traffic weight in basis points"),
            conditions: z.record(z.unknown()).optional(),
            schedule: z.record(z.unknown()).optional(),
          }),
        )
        .min(2)
        .optional()
        .describe("Updated variants. Weights must sum to 10000. Only editable when draft/paused."),
      goalConfig: z.record(z.unknown()).optional().describe("Updated goal configuration"),
      banditConfig: z.record(z.unknown()).optional().describe("Updated auto-optimization settings"),
      confidenceThreshold: z.number().optional().describe("Updated confidence threshold (editable when running)"),
      minimumRunDays: z.number().optional().describe("Updated minimum run days (editable when running)"),
      outputConfig: z.record(z.unknown()).optional().describe("Updated output format/quality"),
      fallbackImageUrl: z.string().url().optional().describe("Updated fallback image URL"),
    },
    async ({ experimentId, ...updates }) => {
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
        const result = await client.put<{ experiment: { uid: string; name: string } }>(
          `/experiments/api/${experimentId}`,
          body,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment updated successfully.\n\nID: ${result.experiment.uid}\nName: ${result.experiment.name}`,
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
    "Soft-delete an experiment. This cannot be undone. " +
      "Running experiments must be paused or completed first before deletion.",
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
    "Start a draft or paused experiment, activating traffic routing to its variants. " +
      "Once started, the experiment serves different image variants and tracks events. " +
      "Valid transitions: draft -> running, paused -> running. " +
      "If banditConfig is enabled (A/B tests), Thompson Sampling auto-optimizes traffic toward the winning variant.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to start"),
    },
    async ({ experimentId }) => {
      try {
        const result = await client.post<{ experiment: { uid: string; status: string; slug: string } }>(
          `/experiments/api/${experimentId}/start`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Experiment started — now routing traffic to variants.\n\n` +
                `ID: ${result.experiment.uid}\n` +
                `Status: ${result.experiment.status}\n\n` +
                `Tracking URLs:\n` +
                `- Pixel: /s/${result.experiment.slug}/pixel.gif\n` +
                `- Click: /s/${result.experiment.slug}/click\n\n` +
                `Use pictify_get_experiment to monitor impression/click counts.`,
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
    "Pause a running experiment, temporarily stopping traffic routing and event tracking. " +
      "Valid transition: running -> paused. " +
      "The experiment can be resumed later with pictify_start_experiment. " +
      "Collected data is preserved.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to pause"),
    },
    async ({ experimentId }) => {
      try {
        const result = await client.post<{ experiment: { uid: string; status: string } }>(
          `/experiments/api/${experimentId}/pause`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Experiment paused.\n\nID: ${result.experiment.uid}\nStatus: ${result.experiment.status}\n\nUse pictify_start_experiment to resume.`,
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
      "This is a FINAL action — completed experiments cannot be restarted. " +
      "After completion, all traffic is routed to the winning variant. " +
      "Valid transitions: running -> completed, paused -> completed. " +
      "WORKFLOW: Check pictify_get_experiment first to review per-variant impression/click counts, " +
      "then declare the winner based on data.",
    {
      experimentId: z
        .string()
        .describe("The experiment UID to complete"),
      winnerVariantId: z
        .string()
        .describe(
          "The ID of the winning variant. Must be one of the experiment's variant IDs. " +
            "Use pictify_get_experiment to see available variant IDs and their performance.",
        ),
    },
    async ({ experimentId, winnerVariantId }) => {
      try {
        const result = await client.post<{ experiment: { uid: string; status: string } }>(
          `/experiments/api/${experimentId}/complete`,
          { winnerVariantId },
        );
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Experiment completed.\n\n` +
                `ID: ${result.experiment.uid}\n` +
                `Status: ${result.experiment.status}\n` +
                `Winner: ${winnerVariantId}\n\n` +
                `All traffic is now routed to the winning variant.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_track_experiment_events",
    "Track impressions, views, clicks, and conversions for experiments. " +
      "Use this to send event data from your application to Pictify's analytics. " +
      "Accepts a single event or an array of up to 100 events. " +
      "Authentication: Uses the API key (Bearer token). For client-side tracking, " +
      "use the X-Write-Key header or writeKey field instead (safe to expose in browser code). " +
      "Rate limit: 1000 requests/minute per IP.",
    {
      events: z
        .array(
          z.object({
            event: z
              .enum(["impression", "view", "click", "conversion"])
              .describe("Event type"),
            experiment: z
              .string()
              .max(60)
              .describe("Experiment slug (not UID)"),
            variantId: z
              .string()
              .optional()
              .describe("Variant that triggered the event"),
            channel: z
              .enum(["web", "email", "ad", "in-app", "social", "other"])
              .optional()
              .describe("Traffic channel"),
            device: z
              .enum(["mobile", "desktop", "tablet"])
              .optional()
              .describe("Device type"),
            referrer: z.string().optional().describe("Referrer URL"),
            metadata: z
              .record(z.unknown())
              .optional()
              .describe("Custom metadata (max 10KB, max depth 3)"),
          }),
        )
        .min(1)
        .max(100)
        .describe("Array of events to track (1-100)"),
    },
    async ({ events }) => {
      try {
        const body = events.length === 1 ? events[0] : events;
        const result = await client.post<{
          ok: boolean;
          processed: number;
          errors: Array<{ index: number; error: string }>;
          warning?: string;
        }>("/s/events", body);

        let text = `Events tracked: ${result.processed} processed.`;
        if (result.errors && result.errors.length > 0) {
          text += `\n\nErrors:\n` + result.errors.map((e) => `- Index ${e.index}: ${e.error}`).join("\n");
        }
        if (result.warning) {
          text += `\n\nWarning: ${result.warning}`;
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
