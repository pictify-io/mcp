import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PictifyClient } from "../api-client.js";
import { formatError } from "../utils.js";

export function registerTemplateTools(server: McpServer, client: PictifyClient) {
  server.tool(
    "pictify_list_templates",
    "List saved templates with pagination and filtering. " +
      "Templates are reusable designs with variable placeholders. " +
      "Returns template names, IDs, dimensions, and output formats.",
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
        .default(20)
        .describe("Number of templates per page (1-100)"),
      sort: z
        .enum(["createdAt", "updatedAt", "name"])
        .optional()
        .describe("Sort order for results"),
      outputFormat: z
        .enum(["png", "jpeg", "webp", "pdf", "gif"])
        .optional()
        .describe("Filter templates by output format"),
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
      "Returns the template's name, HTML content, dimensions, variable definitions, and metadata.",
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
      "Call this before pictify_render_template to know what variables are available, " +
      "their types (text, image, color, number, boolean), and default values. " +
      "Returns an array of variable definitions.",
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
    "Render a saved template with variable substitutions to produce an image. " +
      "Use pictify_get_template_variables first to discover available variables and their types. " +
      "For rendering raw HTML without a template, use pictify_create_image instead. " +
      "Returns the rendered image URL.",
    {
      templateId: z
        .string()
        .describe("The template UID to render"),
      variables: z
        .record(z.unknown())
        .optional()
        .describe(
          "Template variables as key-value pairs. Use pictify_get_template_variables to see available variables.",
        ),
      format: z
        .enum(["png", "jpeg", "webp", "pdf"])
        .default("png")
        .describe("Output format for the rendered image"),
      quality: z
        .number()
        .min(0.1)
        .max(1)
        .default(1)
        .describe("Output quality (0.1-1.0). Lower values reduce file size."),
    },
    async ({ templateId, variables, format, quality }) => {
      try {
        const result = await client.post<{ url: string }>(
          `/templates/${templateId}/render`,
          { variables, format, quality },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Template rendered successfully.\n\nURL: ${result.url}`,
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
    "Create a new reusable template from HTML content. " +
      "Templates support variable placeholders for dynamic content. " +
      "Define variables using {{variableName}} syntax in the HTML. " +
      "Returns the created template's ID and details.",
    {
      name: z.string().describe("Template name for identification"),
      html: z
        .string()
        .describe(
          "HTML content for the template. Use {{variableName}} for dynamic placeholders.",
        ),
      width: z
        .number()
        .min(1)
        .max(4000)
        .default(1200)
        .describe("Template width in pixels (1-4000)"),
      height: z
        .number()
        .min(1)
        .max(4000)
        .default(630)
        .describe("Template height in pixels (1-4000)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for organizing and filtering templates"),
    },
    async ({ name, html, width, height, tags }) => {
      try {
        const result = await client.post<{ uid: string; name: string }>(
          "/templates",
          { name, html, width, height, tags },
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Template created successfully.\n\nID: ${result.uid}\nName: ${result.name}`,
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
    "Update an existing template's HTML, dimensions, or metadata. " +
      "Only the provided fields will be updated; others remain unchanged.",
    {
      templateId: z.string().describe("The template UID to update"),
      name: z.string().optional().describe("New template name"),
      html: z.string().optional().describe("New HTML content"),
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
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags for the template"),
    },
    async ({ templateId, ...updates }) => {
      try {
        const body = Object.fromEntries(
          Object.entries(updates).filter(([, v]) => v !== undefined),
        );
        const result = await client.put<{ uid: string; name: string }>(
          `/templates/${templateId}`,
          body,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Template updated successfully.\n\nID: ${result.uid}\nName: ${result.name}`,
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
      "Any batch jobs or bindings using this template will stop working.",
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
}
