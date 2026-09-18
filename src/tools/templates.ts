import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { expectField, formatError, requireExactlyOne, ToolInputError } from "../utils.js";

export function registerTemplateTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_list_templates",
    "List saved templates in your Pictify account with pagination and filtering. " +
      "Templates are reusable HTML designs with {{variableName}} placeholders for dynamic content. " +
      "Use this to discover available templates before rendering. " +
      "Returns template names, IDs, dimensions, output formats, and pagination info.",
    {
      page: z
        .number()
        .min(1)
        .default(1)
        .describe("Page number for pagination (starts at 1)"),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(12)
        .describe("Number of templates per page (1-100, default 12)"),
      sort: z
        .enum(["newest", "oldest", "name"])
        .default("newest")
        .describe("Sort order for results"),
      outputFormat: z
        .enum(["all", "image", "pdf"])
        .default("all")
        .describe("Filter templates by their output format type"),
    },
    async ({ page, limit, sort, outputFormat }) => {
      try {
        const result = await client.get<{
          templates: unknown[];
          pagination: unknown;
        }>("/templates", { page, limit, sort, outputFormat });
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
    "pictify_get_template",
    "Get detailed information about a specific template by its ID. " +
      "Returns the template's name, dimensions, variable definitions, tags, output format, " +
      "thumbnail URL, and metadata. Use this to inspect a template before rendering.",
    {
      templateId: z.string().describe("The template UID to retrieve"),
    },
    async ({ templateId }) => {
      try {
        const result = await client.get<unknown>(`/templates/${templateId}`);
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
    "pictify_get_template_variables",
    "Get the variable definitions for a template. " +
      "IMPORTANT: Always call this before pictify_render_template, pictify_multi_size_render or " +
      "pictify_batch_render, to discover what variables are available. " +
      "Returns variable names, types (text, image, color, number, boolean), default values, and descriptions. " +
      "Variables support Pictify's expression engine with 50+ functions for dynamic content " +
      "(e.g., IF/ELSE conditionals, string manipulation, date formatting, math operations).",
    {
      templateId: z
        .string()
        .describe("The template UID to get variables for"),
    },
    async ({ templateId }) => {
      try {
        const result = await client.get<unknown>(
          `/templates/${templateId}/variables`,
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
    "pictify_render_template",
    "Render a saved template with variable substitutions to produce an image or a PDF. " +
      "This is also how you get a PDF out of Pictify: pass format: 'pdf'. " +
      "WORKFLOW: 1) Use pictify_list_templates to find a template, " +
      "2) Use pictify_get_template_variables to discover its variables, " +
      "3) Call this tool with the variable values. " +
      "Common use cases: OG images with dynamic titles, personalized social cards, " +
      "product images with prices/descriptions, event banners with speaker info. " +
      "For rendering the same template with many variable sets, use pictify_batch_render. " +
      "Returns the hosted image URL (CDN-backed).",
    {
      templateId: z
        .string()
        .describe("The template UID to render"),
      variables: z
        .record(z.unknown())
        .optional()
        .describe(
          "Template variables as key-value pairs. " +
            "Example: { title: 'My Blog Post', author: 'Jane Doe', avatar_url: 'https://...' }. " +
            "Use pictify_get_template_variables to see available variables and their types.",
        ),
      format: z
        .enum(["png", "jpeg", "webp", "pdf"])
        .default("png")
        .describe(
          "Output format. PNG for transparency, JPEG for photos, WebP for web optimization, PDF for documents.",
        ),
      quality: z
        .number()
        .min(0.1)
        .max(1)
        .default(0.9)
        .describe("Output quality (0.1-1.0). Lower values reduce file size. Only affects JPEG and WebP."),
      layout: z
        .string()
        .optional()
        .describe(
          "Render a specific layout variant (e.g., 'twitter-post', 'facebook-post'). " +
            "Omit for default layout. Use pictify_get_template to see available layouts.",
        ),
      layouts: z
        .array(z.string())
        .optional()
        .describe(
          "Render multiple layout variants in one request. " +
            "Use 'default' for the base layout. Example: ['default', 'twitter-post', 'facebook-post']. " +
            "Returns a results array with one entry per layout.",
        ),
    },
    async ({ templateId, variables, format, quality, layout, layouts }) => {
      try {
        const body: Record<string, unknown> = { variables, format, quality };
        if (layouts && layouts.length > 0) {
          body.layouts = layouts;
        } else if (layout) {
          body.layout = layout;
        }

        const result = await client.post<{
          results: Array<{
            layout: string;
            name: string;
            url: string;
            width: number;
            height: number;
            format: string;
          }>;
          totalRendered: number;
          totalErrors: number;
          templateUid: string;
        }>(
          `/templates/${templateId}/render`,
          body,
        );

        const results = expectField(
          result?.results,
          "results",
          `POST /templates/${templateId}/render`,
        );
        const lines = results.map(
          (r) => `  ${r.name} (${r.layout}) — ${r.width}x${r.height}: ${r.url}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Template rendered successfully (${result.totalRendered} layout${result.totalRendered > 1 ? "s" : ""}).\n\n` +
                lines.join("\n") +
                `\nFormat: ${format}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_create_template",
    "Create a new reusable template with variable placeholders for dynamic content generation. " +
      "Templates can use either FabricJS canvas data (from the Pictify visual editor) or raw HTML. " +
      "Provide ONE of 'html' or 'fabricJSData' — they are mutually exclusive. " +
      "For HTML templates, use {{variableName}} syntax for dynamic placeholders. " +
      "Pictify's expression engine supports 50+ functions: IF/ELSE conditionals, string manipulation " +
      "(toUpperCase, truncate, etc.), date formatting, math operations, and more. " +
      "After creating, use pictify_render_template to render it with specific values. " +
      "Returns the created template's ID.",
    {
      name: z.string().describe("Template name for identification and organization"),
      html: z
        .string()
        .optional()
        .describe(
          "HTML content for the template. Use {{variableName}} for dynamic placeholders. " +
            "Mutually exclusive with 'fabricJSData'. " +
            "Supports expressions: '{{IF(premium, \"PRO\", \"FREE\")}}', '{{price * 1.1}}'. " +
            "Include all styling inline or in <style> tags. Google Fonts supported via <link> tags.",
        ),
      fabricJSData: z
        .record(z.unknown())
        .optional()
        .describe(
          "FabricJS canvas JSON object (from canvas.toJSON()). Mutually exclusive with 'html'. " +
            "This is the standard format from Pictify's visual editor. " +
            "Canvas objects can have variable bindings for dynamic content.",
        ),
      width: z
        .number()
        .min(1)
        .max(4000)
        .optional()
        .describe(
          "Template width in pixels (1-4000). Common: 1200x630 (OG), 1080x1080 (social square), 1920x1080 (presentation)",
        ),
      height: z
        .number()
        .min(1)
        .max(4000)
        .optional()
        .describe("Template height in pixels (1-4000)"),
      type: z
        .string()
        .optional()
        .describe("Template type (e.g., 'banner', 'card', 'certificate')"),
      category: z
        .string()
        .optional()
        .describe("Template category for organization"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for organizing and filtering templates (e.g., ['social', 'marketing', 'og-image'])"),
      variableDefinitions: z
        .array(
          z.object({
            name: z.string().describe("Variable name"),
            type: z
              .enum(["text", "image", "color", "number", "boolean"])
              .describe("Variable type"),
            defaultValue: z.string().optional().describe("Default value if not provided at render time"),
            description: z.string().optional().describe("Human-readable description of this variable"),
          }),
        )
        .optional()
        .describe("Explicit variable definitions with types and defaults"),
      outputFormat: z
        .enum(["image", "pdf"])
        .optional()
        .describe("Default output format: 'image' for PNG/JPEG/WebP, 'pdf' for PDF documents"),
    },
    async ({ name, html, fabricJSData, width, height, type, category, tags, variableDefinitions, outputFormat }) => {
      try {
        requireExactlyOne(
          { html, fabricJSData },
          "Pass html for a markup template (use {{variableName}} placeholders), " +
            "or fabricJSData for a canvas built in the Pictify visual editor.",
        );

        const body: Record<string, unknown> = { name };
        if (html) body.html = html;
        if (fabricJSData) body.fabricJSData = fabricJSData;
        if (width) body.width = width;
        if (height) body.height = height;
        if (type) body.type = type;
        if (category) body.category = category;
        if (tags) body.tags = tags;
        if (variableDefinitions) body.variableDefinitions = variableDefinitions;
        if (outputFormat) body.outputFormat = outputFormat;

        const result = await client.post<{ template: { uid: string; name: string } }>(
          "/templates",
          body,
        );
        const template = expectField(result?.template, "template", "POST /templates");
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Template created successfully.\n\n` +
                `ID: ${template.uid}\n` +
                `Name: ${template.name}\n\n` +
                `Next steps:\n` +
                `1. Use pictify_get_template_variables with ID '${template.uid}' to see detected variables\n` +
                `2. Use pictify_render_template to render it with specific values`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_update_template",
    "Update an existing template's content, dimensions, name, or variable definitions. " +
      "Only the provided fields will be updated; others remain unchanged. " +
      "You can update HTML or FabricJS data — provide one or the other, not both. " +
      "Note: updating content may change the available variables.",
    {
      templateId: z.string().describe("The template UID to update"),
      name: z.string().optional().describe("New template name"),
      html: z
        .string()
        .optional()
        .describe("New HTML content. Mutually exclusive with 'fabricJSData'."),
      fabricJSData: z
        .record(z.unknown())
        .optional()
        .describe("New FabricJS canvas JSON. Mutually exclusive with 'html'."),
      width: z
        .number()
        .min(1)
        .max(4000)
        .optional()
        .describe("New width in pixels (1-4000)"),
      height: z
        .number()
        .min(1)
        .max(4000)
        .optional()
        .describe("New height in pixels (1-4000)"),
      variableDefinitions: z
        .array(
          z.object({
            name: z.string(),
            type: z.enum(["text", "image", "color", "number", "boolean"]),
            defaultValue: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional()
        .describe("Updated variable definitions"),
    },
    async ({ templateId, ...updates }) => {
      try {
        // Every field is optional here, so "update nothing" is a call the
        // schema accepts. It reads as success and changes nothing, which is
        // worse than being told.
        const body = Object.fromEntries(
          Object.entries(updates).filter(([, v]) => v !== undefined),
        );
        if (Object.keys(body).length === 0) {
          throw new ToolInputError(
            "Nothing to update. Pass at least one of name, html, fabricJSData, width, height or variableDefinitions.",
          );
        }
        if (updates.html !== undefined && updates.fabricJSData !== undefined) {
          throw new ToolInputError(
            "html and fabricJSData are mutually exclusive — update one or the other, not both.",
          );
        }

        const result = await client.put<{ template: { uid: string; name: string } }>(
          `/templates/${templateId}`,
          body,
        );
        const template = expectField(
          result?.template,
          "template",
          `PUT /templates/${templateId}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Template updated successfully.\n\nID: ${template.uid}\nName: ${template.name}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_delete_template",
    "Permanently delete a template. This action cannot be undone. " +
      "WARNING: Any batch jobs or bindings using this template will stop working.",
    {
      templateId: z.string().describe("The template UID to delete"),
    },
    async ({ templateId }) => {
      try {
        await client.del(`/templates/${templateId}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Template ${templateId} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_multi_size_render",
    "Render one template at several sizes in a single call — the same design as a 1200x630 OG card, " +
      "a 1080x1080 square and a 1600x900 banner, say. " +
      "Use this instead of calling pictify_render_template once per size: it is one request, one set of " +
      "variables, and the results come back labelled. " +
      "Different SIZES of one design; for different LAYOUT VARIANTS of it, use the 'layouts' argument " +
      "on pictify_render_template instead.",
    {
      templateId: z.string().describe("The template UID to render"),
      sizes: z
        .array(
          z.object({
            preset: z.string().optional().describe("Named size preset, if the template defines one"),
            width: z.number().min(10).max(4096).optional().describe("Width in pixels"),
            height: z.number().min(10).max(4096).optional().describe("Height in pixels"),
            label: z.string().optional().describe("Your name for this size, echoed back on the result"),
          }),
        )
        .min(1)
        .max(20)
        .describe(
          "The sizes to render (1-20). Each entry is either a preset, or an explicit width and height. " +
            "Example: [{ label: 'og', width: 1200, height: 630 }, { label: 'square', width: 1080, height: 1080 }]",
        ),
      variables: z
        .record(z.unknown())
        .optional()
        .describe(
          "Template variables, applied to every size. " +
            "Call pictify_get_template_variables to see what the template expects.",
        ),
      format: z.enum(["png", "jpeg", "webp"]).default("png").describe("Output format for every size"),
      quality: z
        .number()
        .min(0.1)
        .max(1)
        .default(0.9)
        .describe("Output quality (0.1-1.0). Only affects JPEG and WebP."),
    },
    async ({ templateId, sizes, variables, format, quality }) => {
      try {
        const result = await client.post<{
          results?: Array<{ label?: string; width: number; height: number; url: string }>;
        }>(`/templates/${templateId}/multi-size-render`, { sizes, variables, format, quality });

        const results = expectField(
          result?.results,
          "results",
          `POST /templates/${templateId}/multi-size-render`,
        );
        const lines = results.map(
          (r) => `  ${r.label || `${r.width}x${r.height}`} — ${r.width}x${r.height}: ${r.url}`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Rendered at ${results.length} size${results.length === 1 ? "" : "s"}.\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  /*
   * The template tools advertise "50+ expression functions" and, until these
   * two, gave no way to find out what they are or whether one you wrote parses.
   * The alternative was to save a template, render it, and read the failure.
   */

  server.tool(
    "pictify_validate_expression",
    "Check that a template expression parses before you put it in a template. " +
      "Pass the inside of the braces, not the braces: 'IF(premium, \"PRO\", \"FREE\")', not '{{...}}'. " +
      "Returns whether it is valid and, if not, what is wrong with it.",
    {
      expression: z
        .string()
        .describe(
          "The expression to check, without the surrounding {{ }}. " +
            "Examples: 'price * 1.1', 'toUpperCase(name)', 'IF(count > 0, \"in stock\", \"sold out\")'",
        ),
    },
    async ({ expression }) => {
      try {
        const result = await client.post<{ valid: boolean; error?: string | null }>(
          "/templates/expression/validate",
          { expression },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result?.valid
                ? `Valid: {{${expression}}}`
                : `Invalid: {{${expression}}}\n\n${result?.error || "Expression could not be parsed."}`,
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.tool(
    "pictify_list_expression_functions",
    "List the functions available inside template expressions, with a line on what each does. " +
      "Call this before writing template HTML with {{ }} logic, so the expressions use functions " +
      "that exist rather than ones that look like they should.",
    {},
    async () => {
      try {
        const result = await client.get<{ functions?: Array<{ name: string; description: string }> }>(
          "/templates/expression/functions",
        );
        const functions = expectField(
          result?.functions,
          "functions",
          "GET /templates/expression/functions",
        );
        return {
          content: [
            {
              type: "text" as const,
              text:
                `${functions.length} expression functions:\n\n` +
                functions.map((f) => `  ${f.name} — ${f.description}`).join("\n"),
            },
          ],
        };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
