import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerPdfTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_render_pdf",
    "Generate a single-page PDF from a saved template with variable substitutions. " +
      "Common use cases: invoices, certificates, receipts, contracts, reports, event tickets, " +
      "shipping labels, and any document that needs to be generated programmatically. " +
      "WORKFLOW: Call pictify_get_template_variables first to discover available variables and their types, " +
      "then call this tool with the appropriate variable values. " +
      "Supports standard page sizes (A4, Letter, Legal, etc.) — use pictify_list_pdf_presets to see all options. " +
      "Returns the hosted PDF URL.",
    {
      templateId: z
        .string()
        .describe("The template UID to render as a PDF. Use pictify_list_templates to find available templates."),
      variables: z
        .record(z.unknown())
        .optional()
        .describe(
          "Template variables as key-value pairs (e.g., { title: 'Invoice #001', amount: '$1,000', date: '2024-03-09' }). " +
            "Use pictify_get_template_variables to discover available variable names and types.",
        ),
      preset: z
        .string()
        .optional()
        .describe(
          "PDF page size preset (e.g., 'A4', 'Letter', 'Legal'). " +
            "Use pictify_list_pdf_presets to see all available presets with their dimensions. " +
            "If not specified, uses the template's default dimensions.",
        ),
      title: z
        .string()
        .optional()
        .describe("PDF document title metadata — appears in the browser tab when the PDF is opened"),
    },
    async ({ templateId, variables, preset, title }) => {
      try {
        const options: Record<string, unknown> = {};
        if (preset) options.preset = preset;
        if (title) options.title = title;

        const result = await client.post<{
          success: boolean;
          url: string;
          pageCount: number;
          preset: string;
        }>("/pdf/render", {
          templateUid: templateId,
          variables,
          options: Object.keys(options).length > 0 ? options : undefined,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `PDF generated successfully.\n\nURL: ${result.url}\nPages: ${result.pageCount}\nPreset: ${result.preset}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_render_multi_page_pdf",
    "Generate a multi-page PDF from a template by providing multiple sets of variables. " +
      "Each variable set produces one page in the final document. Supports 1-100 pages per PDF. " +
      "Common use cases: bulk invoice generation, certificate batches for events/courses, " +
      "multi-page reports, product catalogs, and employee ID cards. " +
      "WORKFLOW: Call pictify_get_template_variables first to discover available variables, " +
      "then provide an array of variable sets (one per page). " +
      "Returns a single combined PDF URL. For generating separate image files per set, use pictify_batch_render instead.",
    {
      templateId: z
        .string()
        .describe("The template UID to render as a multi-page PDF"),
      variableSets: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(100)
        .describe(
          "Array of variable sets, one per page (1-100 items). " +
            "Example: [{ name: 'Alice', score: '95' }, { name: 'Bob', score: '87' }] produces a 2-page PDF.",
        ),
      preset: z
        .string()
        .optional()
        .describe("PDF page size preset (e.g., 'A4', 'Letter'). Use pictify_list_pdf_presets to see options."),
      title: z
        .string()
        .optional()
        .describe("PDF document title metadata"),
    },
    async ({ templateId, variableSets, preset, title }) => {
      try {
        const options: Record<string, unknown> = {};
        if (preset) options.preset = preset;
        if (title) options.title = title;

        const result = await client.post<{
          success: boolean;
          url: string;
          pageCount: number;
        }>("/pdf/multi-page", {
          templateUid: templateId,
          variableSets,
          options: Object.keys(options).length > 0 ? options : undefined,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Multi-page PDF generated successfully.\n\nURL: ${result.url}\nPages: ${result.pageCount}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_list_pdf_presets",
    "List all available PDF page size presets with their dimensions. " +
      "Use these preset names when calling pictify_render_pdf or pictify_render_multi_page_pdf. " +
      "Common presets include A4 (210x297mm), Letter (8.5x11in), Legal (8.5x14in), and more.",
    {},
    async () => {
      try {
        const result = await client.get<{ presets: unknown[] }>("/pdf/presets");
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
