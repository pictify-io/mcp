#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PictifyClient } from "./api-client.js";
import { registerImageTools } from "./tools/images.js";
import { registerGifTools } from "./tools/gifs.js";
import { registerPdfTools } from "./tools/pdfs.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerExperimentTools } from "./tools/experiments.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

const DEBUG = process.env.PICTIFY_DEBUG === "true";

function log(message: string) {
  if (DEBUG) {
    console.error(`[pictify-mcp] ${message}`);
  }
}

// Validate API key
const apiKey = process.env.PICTIFY_API_KEY;
if (!apiKey) {
  console.error(
    "Error: PICTIFY_API_KEY environment variable is required.\n\n" +
      "To get your API key:\n" +
      "  1. Sign up or log in at https://pictify.io\n" +
      "  2. Go to https://pictify.io/dashboard/api-tokens\n" +
      "  3. Create a new API token and copy it\n\n" +
      "Then set it in your MCP client configuration:\n" +
      '  "env": { "PICTIFY_API_KEY": "your_api_key" }',
  );
  process.exit(1);
}

// Initialize client
const baseUrl = process.env.PICTIFY_BASE_URL || "https://api.pictify.io";
const client = new PictifyClient(apiKey, baseUrl, pkg.version);

log(`Initializing with base URL: ${baseUrl}`);

// Create MCP server
const server = new McpServer({
  name: "pictify",
  version: pkg.version,
});

// Register all tools
registerImageTools(server, client);
registerGifTools(server, client);
registerPdfTools(server, client);
registerTemplateTools(server, client);
registerBatchTools(server, client);
registerExperimentTools(server, client);

log("All tools registered");

// Connect transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Pictify MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Pictify MCP server:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Shutting down...");
  process.exit(0);
});
