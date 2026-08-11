#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrument } from "@posthog/mcp";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PictifyClient } from "./api-client.js";
import {
  createAnalyticsClient,
  dropExpectedExceptions,
  identityResolver,
  shutdownAnalytics,
} from "./analytics.js";
import { registerImageTools } from "./tools/images.js";
import { registerGifTools } from "./tools/gifs.js";
import { registerPdfTools } from "./tools/pdfs.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerVideoTools } from "./tools/videos.js";

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
// PICTIFY_MCP_SOURCE attributes installs to specific MCP directories (mcp.so,
// glama, smithery, etc.) — forwarded as X-Pictify-MCP-Source on every API
// call so the backend can fire the `mcp_install_source` PostHog event. PIC-6.
const baseUrl = process.env.PICTIFY_BASE_URL || "https://api.pictify.io";
const source = process.env.PICTIFY_MCP_SOURCE || "unknown";
const client = new PictifyClient(apiKey, baseUrl, pkg.version, source);

log(`Initializing with base URL: ${baseUrl}`);
log(`Install source: ${source}`);

// Create MCP server
const server = new McpServer({
  name: "pictify",
  version: pkg.version,
});

// PostHog MCP analytics — opt out with PICTIFY_ANALYTICS_DISABLED=1.
// logger routes SDK warnings to stderr; stdout is reserved for the protocol.
const posthog = createAnalyticsClient();
if (posthog) {
  instrument(server, posthog, {
    identify: identityResolver(apiKey, baseUrl),
    logger: (message) => log(`[analytics] ${message}`),
    eventProperties: () => ({ mcp_source: source, transport: "stdio" }),
    // Injects a `context` parameter on every tool so agents state their intent
    // — captured as $mcp_intent and clustered in PostHog MCP Analytics.
    context: true,
    // Keep expected failures (auth mistakes, scanner probes) out of error
    // tracking; the failed tool_call events still go through.
    beforeSend: dropExpectedExceptions,
  });
  log("PostHog MCP analytics enabled");
}

// Register all tools
registerImageTools(server, client);
registerGifTools(server, client);
registerPdfTools(server, client);
registerTemplateTools(server, client);
registerBatchTools(server, client);
registerVideoTools(server, client);

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

// Graceful shutdown — flush queued analytics events before exiting.
async function shutdown() {
  log("Shutting down...");
  await shutdownAnalytics(posthog);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
