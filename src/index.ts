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
);

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
    "Error: PICTIFY_API_KEY environment variable is required.\n" +
      "Get your API key at https://pictify.io/dashboard\n\n" +
      "Set it in your MCP client configuration:\n" +
      '  "env": { "PICTIFY_API_KEY": "pk_live_your_key_here" }',
  );
  process.exit(1);
}

if (!apiKey.startsWith("pk_live_") && !apiKey.startsWith("pk_test_")) {
  console.error(
    'Warning: API key does not match expected format (pk_live_* or pk_test_*). ' +
    'Proceeding anyway, but requests may fail if the key is invalid.',
  );
}

if (apiKey.startsWith("pk_test_")) {
  console.error(
    "Note: Using test API key. Renders will be sandboxed and rate-limited.",
  );
}

// Initialize client
const baseUrl = process.env.PICTIFY_BASE_URL || "https://api.pictify.io";
const client = new PictifyClient(apiKey, baseUrl);

log(`Initializing with base URL: ${baseUrl}`);
log(`API key: ${apiKey.substring(0, 12)}...`);

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
