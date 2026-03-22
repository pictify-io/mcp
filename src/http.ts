#!/usr/bin/env node

import { randomUUID, createHash } from "node:crypto";
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
import express from "express";
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
const port = parseInt(process.env.MCP_PORT || "3000", 10);

// ---------------------------------------------------------------------------
// In-memory stores for OAuth codes and clients
// ---------------------------------------------------------------------------

// Maps authorization code -> { apiToken, codeChallenge, redirectUri, state }
const authCodes = new Map<
  string,
  { apiToken: string; codeChallenge: string; redirectUri: string; state: string }
>();

// Maps client_id -> { client_secret (= Pictify API token), redirect_uris }
const clients = new Map<
  string,
  { client_secret: string; redirect_uris: string[]; client_name: string }
>();

// ---------------------------------------------------------------------------
// Token verification — validates Bearer tokens against the Pictify backend
// ---------------------------------------------------------------------------

const verifyAccessToken = async (token: string): Promise<AuthInfo> => {
  console.log(`[pictify-mcp-http] Verifying token: ${token.substring(0, 8)}...`);
  const res = await fetch(`${baseUrl}/api/users/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`[pictify-mcp-http] Token verification: ${res.status}`);
  if (!res.ok) {
    throw new Error("Invalid or expired token");
  }
  return {
    token,
    clientId: "pictify-mcp",
    scopes: ["mcp:tools"],
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year
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

app.use(express.urlencoded({ extended: false }));

// --- Request logging --------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[pictify-mcp-http] --> ${req.method} ${req.path}`);
  res.on("finish", () => {
    console.log(`[pictify-mcp-http] <-- ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// --- CORS -------------------------------------------------------------------
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id",
  );
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// OAuth endpoints
// ---------------------------------------------------------------------------
// Claude.ai flow:
//   1. User adds connector with URL https://mcp.pictify.io
//      and enters their Pictify API token as "OAuth Client Secret"
//   2. Claude.ai calls POST /register with client_secret
//   3. Claude.ai opens GET /authorize in browser — auto-approves, redirects
//      back with auth code
//   4. Claude.ai calls POST /token to exchange code for access_token
//   5. All MCP requests use Bearer {access_token} (= Pictify API token)
// ---------------------------------------------------------------------------

// POST /register — Dynamic Client Registration
// Claude sends client_secret = user's Pictify API token
app.post("/register", (req: Request, res: Response) => {
  const { redirect_uris, client_name, client_secret } = req.body || {};

  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris required" });
    return;
  }

  const clientId = randomUUID();

  clients.set(clientId, {
    client_secret: client_secret || "",
    redirect_uris,
    client_name: client_name || "unknown",
  });

  // Auto-clean after 1 hour
  setTimeout(() => clients.delete(clientId), 3600_000);

  res.status(201).json({
    client_id: clientId,
    client_secret: client_secret || "",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris,
    client_name: client_name || "unknown",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

// GET /authorize — auto-approve and redirect with code
// Two modes:
//   1. Pre-registered client (via /register with client_secret = API token)
//   2. Pre-configured client (user entered Client ID + Secret in Claude's Advanced Settings)
// In mode 2, we don't know the API token yet — it comes in POST /token as client_secret.
app.get("/authorize", (req: Request, res: Response) => {
  const clientId = req.query.client_id as string;
  const redirectUri = req.query.redirect_uri as string;
  const state = (req.query.state as string) || "";
  const codeChallenge = (req.query.code_challenge as string) || "";

  if (!clientId || !redirectUri) {
    res.status(400).json({ error: "invalid_request", error_description: "client_id and redirect_uri required" });
    return;
  }

  // Check if client was registered via DCR
  const client = clients.get(clientId);
  const apiToken = client?.client_secret || "";

  // Generate authorization code
  // If we have the API token from registration, embed it.
  // If not (pre-configured client), it will come via client_secret in /token.
  const code = randomUUID();
  authCodes.set(code, { apiToken, codeChallenge, redirectUri, state });

  // Auto-expire code after 10 minutes
  setTimeout(() => authCodes.delete(code), 600_000);

  // Redirect back to Claude's callback with the code
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);

  res.redirect(302, target.toString());
});

// POST /token — exchange code for access_token
// The API token comes from either:
//   - DCR registration (stored in authCodes via client_secret)
//   - Pre-configured credentials (sent as client_secret in this request)
app.post("/token", (req: Request, res: Response) => {
  const { grant_type, code, code_verifier, redirect_uri, client_secret } = req.body || {};

  if (grant_type !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }

  const codeData = authCodes.get(code);
  if (!codeData) {
    res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired code" });
    return;
  }

  // One-time use
  authCodes.delete(code);

  // Validate redirect_uri
  if (redirect_uri && redirect_uri !== codeData.redirectUri) {
    res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
    return;
  }

  // Validate PKCE if challenge was provided
  if (codeData.codeChallenge && code_verifier) {
    const hash = createHash("sha256").update(code_verifier).digest("base64url");
    if (hash !== codeData.codeChallenge) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }
  }

  // Resolve the API token:
  // 1. From DCR registration (stored in code data)
  // 2. From pre-configured client_secret sent in this request
  const apiToken = codeData.apiToken || client_secret;

  if (!apiToken) {
    res.status(400).json({ error: "invalid_grant", error_description: "No API token provided. Set your Pictify API token as the OAuth Client Secret." });
    return;
  }

  res.json({
    access_token: apiToken,
    token_type: "bearer",
    scope: "mcp:tools",
  });
});

// POST /revoke
app.post("/revoke", (_req: Request, res: Response) => {
  res.status(200).end();
});

// ---------------------------------------------------------------------------
// OAuth metadata
// ---------------------------------------------------------------------------

const mcpServerUrl = new URL(
  process.env.MCP_PUBLIC_URL || `http://localhost:${port}`,
);
const publicUrl = mcpServerUrl.origin;

const oauthMetadata = {
  issuer: publicUrl,
  authorization_endpoint: `${publicUrl}/authorize`,
  token_endpoint: `${publicUrl}/token`,
  registration_endpoint: `${publicUrl}/register`,
  revocation_endpoint: `${publicUrl}/revoke`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["mcp:tools"],
} satisfies OAuthMetadata;

app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
  res.json(oauthMetadata);
});

app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpServerUrl,
    resourceName: "Pictify MCP Server",
  }),
);

// ---------------------------------------------------------------------------
// Bearer auth middleware
// ---------------------------------------------------------------------------

const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpServerUrl);

const oauthMiddleware = requireBearerAuth({
  verifier: { verifyAccessToken },
  requiredScopes: [],
  resourceMetadataUrl,
});

// Flexible auth middleware:
// 1. If X-API-Key or Bearer token is present, verify directly (Smithery, Claude Code, etc.)
// 2. If this is an initialize request with no auth, allow through for tool discovery (scanners)
// 3. Otherwise, fall through to OAuth middleware (Claude.ai)
const authMiddleware = async (req: Request, res: Response, next: () => void) => {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

  // Extract token from Authorization header (Bearer prefix) or X-API-Key
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : apiKeyHeader || null;

  if (token) {
    try {
      const authInfo = await verifyAccessToken(token);
      (req as any).auth = authInfo;
      next();
      return;
    } catch {
      // Token invalid — fall through to OAuth which will return a proper 401
      // with WWW-Authenticate header pointing to the OAuth metadata
    }
  }

  // Allow unauthenticated initialize requests for tool discovery (Smithery scanner, etc.)
  // Tool calls will fail at the API level without a valid key, but schema discovery works.
  if (req.method === "POST" && isInitializeRequest(req.body)) {
    next();
    return;
  }

  // For existing sessions without auth, let them through — auth was checked at init time
  if (req.headers["mcp-session-id"]) {
    next();
    return;
  }

  oauthMiddleware(req, res, next);
};

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const transports: Record<string, StreamableHTTPServerTransport> = {};

// ---------------------------------------------------------------------------
// MCP endpoint handlers
// ---------------------------------------------------------------------------

app.post("/", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  if (sessionId && !transports[sessionId]) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found" }, id: null });
    return;
  }

  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Expected initialization request" }, id: null });
    return;
  }

  const authInfo = (req as any).auth as AuthInfo | undefined;
  const apiKey = authInfo?.token || "anonymous";

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
      console.log(`[pictify-mcp-http] Session closed: ${transport.sessionId}`);
    }
  };

  const server = createMcpServer(apiKey);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session" }, id: null });
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.delete("/", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found" }, id: null });
    return;
  }
  await transports[sessionId].close();
  delete transports[sessionId];
  res.status(200).end();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const httpServer = app.listen(port, "0.0.0.0", () => {
  console.log(`[pictify-mcp-http] Listening on http://0.0.0.0:${port}`);
  console.log(`[pictify-mcp-http] OAuth metadata at ${resourceMetadataUrl}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("[pictify-mcp-http] Shutting down...");
  await Promise.all(Object.values(transports).map((t) => t.close().catch(() => {})));
  httpServer.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
