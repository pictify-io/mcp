#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Request, Response } from "express";
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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

const baseUrl = process.env.PICTIFY_BASE_URL || "https://api.pictify.io";
const authServerUrl =
  process.env.PICTIFY_AUTH_SERVER_URL || "https://api.pictify.io";
const port = parseInt(process.env.MCP_PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Token verification — validates Bearer tokens against the Pictify backend
// ---------------------------------------------------------------------------

const verifyAccessToken = async (token: string): Promise<AuthInfo> => {
  const res = await fetch(`${baseUrl}/api/users/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error("Invalid or expired token");
  }
  return {
    token,
    clientId: "pictify-mcp",
    scopes: ["mcp:tools"],
  };
};

// ---------------------------------------------------------------------------
// MCP server factory — one server per session, each with its own API key
// ---------------------------------------------------------------------------

function createMcpServer(apiKey: string): McpServer {
  const client = new PictifyClient(apiKey, baseUrl, pkg.version);
  const server = new McpServer({ name: "pictify", version: pkg.version });

  registerImageTools(server, client);
  registerGifTools(server, client);
  registerPdfTools(server, client);
  registerTemplateTools(server, client);
  registerBatchTools(server, client);
  registerExperimentTools(server, client);

  return server;
}

// ---------------------------------------------------------------------------
// Express application
// ---------------------------------------------------------------------------

const app = createMcpExpressApp({ host: "0.0.0.0" });

// --- OAuth metadata router -------------------------------------------------
// Advertises Protected Resource Metadata pointing clients to the Pictify
// backend's OAuth authorization server so they can discover how to obtain
// tokens.

const mcpServerUrl = new URL(`http://localhost:${port}`);

const oauthMetadata = {
  issuer: authServerUrl,
  authorization_endpoint: `${authServerUrl}/oauth/authorize`,
  token_endpoint: `${authServerUrl}/oauth/token`,
  registration_endpoint: `${authServerUrl}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
  code_challenge_methods_supported: ["S256"],
} satisfies OAuthMetadata;

app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpServerUrl,
    resourceName: "Pictify MCP Server",
  }),
);

// --- Bearer auth middleware -------------------------------------------------

const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpServerUrl);

const authMiddleware = requireBearerAuth({
  verifier: { verifyAccessToken },
  requiredScopes: [],
  resourceMetadataUrl,
});

// --- Session management -----------------------------------------------------

const transports: Record<string, StreamableHTTPServerTransport> = {};

// --- MCP endpoint handlers --------------------------------------------------

// POST /mcp  — handles JSON-RPC requests (including initialization)
app.post("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Reuse an existing session
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  // Reject non-initialization requests that reference an unknown session
  if (sessionId && !transports[sessionId]) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session not found" },
      id: null,
    });
    return;
  }

  // New session — only allowed for initialization requests
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: expected an initialization request",
      },
      id: null,
    });
    return;
  }

  // The Bearer token IS the Pictify API key
  const authInfo = req.auth as AuthInfo;
  const apiKey = authInfo.token;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports[id] = transport;
      console.log(`[pictify-mcp-http] Session initialized: ${id}`);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      delete transports[transport.sessionId];
      console.log(
        `[pictify-mcp-http] Session closed: ${transport.sessionId}`,
      );
    }
  };

  const server = createMcpServer(apiKey);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// GET /mcp  — SSE stream for server-initiated messages
app.get("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or missing session" },
      id: null,
    });
    return;
  }

  await transports[sessionId].handleRequest(req, res);
});

// DELETE /mcp  — terminates a session
app.delete("/mcp", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session not found" },
      id: null,
    });
    return;
  }

  await transports[sessionId].close();
  delete transports[sessionId];
  res.status(200).end();
});

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

const httpServer = app.listen(port, "0.0.0.0", () => {
  console.log(`[pictify-mcp-http] Pictify MCP HTTP server listening on http://0.0.0.0:${port}/mcp`);
  console.log(`[pictify-mcp-http] OAuth metadata at ${resourceMetadataUrl}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("[pictify-mcp-http] Shutting down...");

  // Close all active transports
  const closePromises = Object.values(transports).map(async (transport) => {
    try {
      await transport.close();
    } catch {
      // ignore errors during shutdown
    }
  });
  await Promise.all(closePromises);

  httpServer.close(() => {
    console.log("[pictify-mcp-http] Server stopped.");
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error("[pictify-mcp-http] Forced shutdown after timeout.");
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
