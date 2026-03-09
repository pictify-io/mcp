import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerPdfTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_render_pdf",
    "Generate a single-page PDF from a saved template with variable substitutions. " +
      "Use pictify_get_template_variables first to discover available variables. " +
      "Returns the PDF URL. Supports standard page sizes (A4, Letter, etc.) and custom dimensions.",
    {
      templateId: z
        .string()
        .describe("The template UID to render as a PDF"),
      variables: z
        .record(z.unknown())
        .optional()
        .describe("Template variables as key-value pairs (e.g., { title: 'Hello', name: 'World' })"),
      preset: z
        .string()
        .optional()
        .describe("PDF page size preset (e.g., 'A4', 'Letter', 'Legal'). Use pictify_list_pdf_presets to see available options."),
      title: z
        .string()
        .optional()
        .describe("PDF document title metadata"),
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
    "Generate a multi-page PDF from a template with multiple sets of variables. " +
      "Each variable set produces one page. Supports 1-100 pages per document. " +
      "Use pictify_get_template_variables first to discover available variables. " +
      "Returns the combined PDF URL.",
    {
      templateId: z
        .string()
        .describe("The template UID to render as a multi-page PDF"),
      variableSets: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(100)
        .describe("Array of variable sets, one per page (1-100 items). Each item is a key-value object of template variables."),
      preset: z
        .string()
        .optional()
        .describe("PDF page size preset (e.g., 'A4', 'Letter')"),
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
    "List available PDF page size presets (e.g., A4, Letter, Legal). " +
      "Use these preset names when calling pictify_render_pdf or pictify_render_multi_page_pdf. " +
      "Returns preset names with their dimensions.",
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
