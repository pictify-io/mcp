#!/usr/bin/env node

import { randomUUID, createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Request, Response } from "express";
import express from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { instrument } from "@posthog/mcp";
import { PictifyClient } from "./api-client.js";
import { bearerOf, isPublicRequest } from "./auth-policy.js";
import {
  createAnalyticsClient,
  dropExpectedExceptions,
  identityResolver,
  shutdownAnalytics,
} from "./analytics.js";
import { registerImageTools } from "./tools/images.js";
import { registerRenderTools } from "./tools/renders.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerVideoTools } from "./tools/videos.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

const baseUrl = process.env.PICTIFY_BASE_URL || "https://api.pictify.io";
const port = parseInt(process.env.MCP_PORT || "3000", 10);
// Per-deployment default source slug. Directory listings carry the real slug
// as ?source=<slug> on the connector URL; this fallback covers requests that
// arrive without one. PIC-6.
const defaultSource = process.env.PICTIFY_MCP_SOURCE || "unknown";

// Allowlist-style sanitizer for source slugs so junk query params don't
// pollute PostHog properties.
function sanitizeSource(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9._-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Install attribution
// ---------------------------------------------------------------------------

/*
 * Attribution used to be captured on our own /authorize (?source=<slug>) and
 * parked in a token -> slug side table until a session started. We are not the
 * authorization server any more, so there is no authorize step here to capture
 * it on, and that table is gone with it.
 *
 * Two routes survive and cover the same ground. Directory links carry the slug
 * on the connector URL itself (https://mcp.pictify.io?source=mcp.so), which
 * arrives on every POST; and PictifyClient stamps X-Pictify-MCP-Source on every
 * call it makes, which is what util/mcp-attribution.js on the backend records
 * against the account. PIC-6.
 */

// ---------------------------------------------------------------------------
// Token verification — validates Bearer tokens against the Pictify backend
// ---------------------------------------------------------------------------

/*
 * Verification is a round-trip to the backend, and the token now arrives on
 * every single request (the old code trusted an mcp-session-id instead, which
 * meant a session outlived the credential that opened it). A short cache keeps
 * that from turning one tool call into two API calls.
 *
 * Keyed on a digest, not the token, so a heap dump or a stray log of this map
 * isn't a pile of live credentials. 60 seconds is the window in which a token
 * revoked in the dashboard still works here — short enough to be honest about,
 * long enough that a burst of calls costs one round trip.
 */
const TOKEN_CACHE_TTL_MS = 60 * 1000;
const TOKEN_CACHE_MAX = 1000;
const tokenCache = new Map<string, { ok: boolean; checkedAt: number }>();

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

const verifyAccessToken = async (token: string): Promise<AuthInfo> => {
  const key = digest(token);
  const cached = tokenCache.get(key);

  if (cached && Date.now() - cached.checkedAt < TOKEN_CACHE_TTL_MS) {
    if (!cached.ok) throw new Error("Invalid or expired token");
  } else {
    const res = await fetch(`${baseUrl}/api/users/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // A backend blip is not a verdict on the credential: cache only answers
    // the backend actually gave, so a 502 doesn't lock someone out for a
    // minute. 401/403 are answers; 5xx is not.
    if (res.status === 401 || res.status === 403 || res.ok) {
      if (tokenCache.size >= TOKEN_CACHE_MAX) {
        tokenCache.delete(tokenCache.keys().next().value as string);
      }
      tokenCache.set(key, { ok: res.ok, checkedAt: Date.now() });
    }

    if (!res.ok) throw new Error("Invalid or expired token");
  }

  return {
    token,
    clientId: "pictify-mcp",
    scopes: ["mcp:tools"],
    expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  };
};

// ---------------------------------------------------------------------------
// MCP server factory — one server per session, each with its own API key
// ---------------------------------------------------------------------------

// Shared posthog-node client for all sessions; each per-session McpServer is
// instrumented separately so events attribute to that session's user.
const posthog = createAnalyticsClient();
if (posthog) {
  console.log("[pictify-mcp-http] PostHog MCP analytics enabled");
}

function createMcpServer(apiKey: string, source: string | null = null): McpServer {
  const resolvedSource = source ?? defaultSource;
  const client = new PictifyClient(apiKey, baseUrl, pkg.version, resolvedSource);
  const server = new McpServer({ name: "pictify", version: pkg.version });

  if (posthog) {
    instrument(server, posthog, {
      identify: identityResolver(apiKey, baseUrl),
      logger: (message) => console.log(`[pictify-mcp-http] [analytics] ${message}`),
      eventProperties: () => ({ mcp_source: resolvedSource, transport: "http" }),
      // Injects a `context` parameter on every tool so agents state their intent
      // — captured as $mcp_intent and clustered in PostHog MCP Analytics.
      context: true,
      // Keep expected failures (auth mistakes, scanner probes) out of error
      // tracking; the failed tool_call events still go through.
      beforeSend: dropExpectedExceptions,
    });
  }

  registerImageTools(server, client);
  registerRenderTools(server, client);
  registerTemplateTools(server, client);
  registerBatchTools(server, client);
  registerVideoTools(server, client);

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
// OAuth 2.1 — we are a resource server, nothing more
// ---------------------------------------------------------------------------
//
// This file used to run its own authorization server: /register took the
// user's raw Pictify API key as a "client secret", /authorize auto-approved
// with no login and no human in the loop, /token handed that same key back as
// an access_token, PKCE was checked only when the client happened to send both
// halves, and /revoke was a 200 that did nothing. It existed because there was
// nothing else to point at.
//
// There is now: api.pictify.io is a real OAuth 2.1 authorization server, with
// dynamic client registration, mandatory S256 PKCE, a consent screen, expiring
// tokens and working revocation. So the whole stub is deleted and we do the one
// job a resource server has — say who our authorization server is, and answer
// 401 with a pointer to this document when someone arrives without a token.
//
// That 401 is the entire point of the change. An unauthenticated tool call used
// to be forwarded to the API to fail there, which reaches the agent as "Error
// (401): check that your PICTIFY_API_KEY is valid" — advice you cannot act on
// in a client where you never typed a key. A 401 carrying WWW-Authenticate is
// what makes Claude.ai and Codex go and get one.

const mcpServerUrl = new URL(
  process.env.MCP_PUBLIC_URL || `http://localhost:${port}`,
);
const publicUrl = mcpServerUrl.origin;
const authorizationServer = process.env.PICTIFY_AUTH_SERVER || "https://api.pictify.io";

const resourceMetadata = {
  resource: publicUrl,
  authorization_servers: [authorizationServer],
  scopes_supported: ["mcp:tools"],
  bearer_methods_supported: ["header"],
  resource_name: "Pictify MCP Server",
  resource_documentation: "https://docs.pictify.io",
};

const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource`;

const sendResourceMetadata = (_req: Request, res: Response) => {
  res.json(resourceMetadata);
};

app.get("/.well-known/oauth-protected-resource", sendResourceMetadata);
// Clients derive the path-suffixed form (RFC 9728 §3.1) from the resource URL
// they were pointed at and try it first. Named wildcard, not a bare `*` —
// express 5's path-to-regexp rejects the unnamed form at route-registration
// time, which means at boot.
app.get("/.well-known/oauth-protected-resource/*splat", sendResourceMetadata);

/**
 * The 401 every unauthenticated attempt to *do* something gets. The header is
 * the useful part: it names the document that names the authorization server,
 * which is how a client bootstraps the whole flow knowing only our URL.
 */
function unauthorized(res: Response, description: string) {
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="pictify", error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl}"`,
  );
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: description },
    id: null,
  });
}

// ---------------------------------------------------------------------------
// MCP Server Card (SEP-2127, still Draft — schema.ts in
// modelcontextprotocol/experimental-ext-server-card is the source of truth).
// Recommended location per spec is `<streamable-http-url>/server-card`.
// Server Cards intentionally don't enumerate tools/capabilities — that stays
// runtime-discoverable via the protocol's own list operations.
// ---------------------------------------------------------------------------

app.get("/server-card", (_req: Request, res: Response) => {
  res.json({
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "io.github.pictify-io/mcp",
    version: pkg.version,
    description: "Generate images, GIFs, videos, and PDFs from HTML, URLs, or templates — from your AI agent.",
    title: "Pictify MCP Server",
    websiteUrl: "https://pictify.io",
    repository: {
      url: "https://github.com/pictify-io/mcp",
      source: "github",
    },
    remotes: [
      {
        type: "streamable-http",
        url: publicUrl,
        supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// Bearer auth
// ---------------------------------------------------------------------------

/*
 * Three outcomes, in order:
 *
 *  1. A token that verifies -> authenticated session.
 *  2. No token (or a bad one) on a discovery request -> through, anonymous.
 *  3. Anything else -> 401 with WWW-Authenticate.
 *
 * What is deliberately gone: an `mcp-session-id` header used to be accepted on
 * its own, on the reasoning that auth "was checked at init time". It meant a
 * session outlived the credential that opened it — revoke a token and the open
 * session kept working — and it let anyone who learned a session id skip auth
 * entirely. The token is re-checked on every request now; the cache above is
 * what makes that cheap.
 */
const authMiddleware = async (req: Request, res: Response, next: () => void) => {
  const token = bearerOf(req.headers);

  if (token) {
    try {
      (req as any).auth = await verifyAccessToken(token);
      next();
      return;
    } catch {
      // Fall through: a bad token is treated as no token, so a client holding
      // an expired one gets the same 401-with-a-pointer that starts a refresh.
    }
  }

  // GET and DELETE are stream resumption and teardown for a session that was
  // authenticated when it opened. Without a valid token there is no session of
  // ours to resume, and the handlers below reject the id as unknown.
  if (req.method !== "POST") {
    unauthorized(res, "Authentication required");
    return;
  }

  if (isPublicRequest(req.body)) {
    next();
    return;
  }

  unauthorized(
    res,
    "Connect your Pictify account to use this tool",
  );
};

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/*
 * Authenticated sessions are pooled, because a render can stream progress back
 * over the session's SSE channel and that needs the transport to still be here.
 *
 * Two caps, because nothing ever removed an entry except an explicit close, and
 * a crawler that connects and walks away leaves one behind forever: an idle
 * sweep, and a ceiling that evicts the least recently used. Anonymous discovery
 * is not pooled at all — see the POST handler.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_MAX = 500;
const SESSION_SWEEP_MS = 5 * 60 * 1000;

interface Session {
  transport: StreamableHTTPServerTransport;
  touchedAt: number;
}

const sessions = new Map<string, Session>();

function touchSession(id: string): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.touchedAt = Date.now();
  // Re-insert so Map iteration order is least-recently-used first.
  sessions.delete(id);
  sessions.set(id, session);
  return session;
}

async function closeSession(id: string) {
  const session = sessions.get(id);
  sessions.delete(id);
  if (session) await session.transport.close().catch(() => {});
}

async function evictOldest() {
  while (sessions.size >= SESSION_MAX) {
    const oldest = sessions.keys().next().value as string | undefined;
    if (!oldest) return;
    console.log(`[pictify-mcp-http] Session evicted (at capacity): ${oldest}`);
    await closeSession(oldest);
  }
}

const sessionSweep = setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, session] of sessions) {
    // LRU order: the first entry that is recent enough ends the sweep.
    if (session.touchedAt >= cutoff) break;
    console.log(`[pictify-mcp-http] Session swept (idle): ${id}`);
    void closeSession(id);
  }
}, SESSION_SWEEP_MS);
sessionSweep.unref();

// ---------------------------------------------------------------------------
// MCP endpoint handlers
// ---------------------------------------------------------------------------

/** Where this connection came from, for install attribution. PIC-6. */
function sourceOf(req: Request): string | null {
  return (
    sanitizeSource(req.headers["x-pictify-mcp-source"] as string | undefined) ??
    sanitizeSource((req.query as Record<string, unknown>)?.source as string | undefined)
  );
}

app.post("/", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const authInfo = (req as any).auth as AuthInfo | undefined;

  if (sessionId) {
    const session = touchSession(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
      return;
    }
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  /*
   * Unauthenticated discovery runs stateless: a throwaway server and transport
   * per request, closed as soon as it has answered. No session id goes out and
   * nothing is retained.
   *
   * This is what stops a thousand crawler connects a day from each parking a
   * live session — and it is honest about what that connection is. There is no
   * account behind it, so there is nothing for a session to hold.
   */
  if (!authInfo) {
    const server = createMcpServer("anonymous", sourceOf(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (!isInitializeRequest(req.body)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Expected initialization request" },
      id: null,
    });
    return;
  }

  await evictOldest();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, touchedAt: Date.now() });
      console.log(`[pictify-mcp-http] Session initialized: ${id}`);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId && sessions.delete(transport.sessionId)) {
      console.log(`[pictify-mcp-http] Session closed: ${transport.sessionId}`);
    }
  };

  const sessionSource = sourceOf(req);
  if (sessionSource) {
    console.log(`[pictify-mcp-http] Session source: ${sessionSource}`);
  }

  const server = createMcpServer(authInfo.token, sessionSource);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? touchSession(sessionId) : undefined;
  if (!session) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or missing session" },
      id: null,
    });
    return;
  }
  await session.transport.handleRequest(req, res);
});

app.delete("/", authMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session not found" },
      id: null,
    });
    return;
  }
  await closeSession(sessionId);
  res.status(200).end();
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const httpServer = app.listen(port, "0.0.0.0", () => {
  console.log(`[pictify-mcp-http] Listening on http://0.0.0.0:${port}`);
  console.log(`[pictify-mcp-http] Resource metadata at ${resourceMetadataUrl}`);
  console.log(`[pictify-mcp-http] Authorization server: ${authorizationServer}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("[pictify-mcp-http] Shutting down...");
  clearInterval(sessionSweep);
  await Promise.all([...sessions.keys()].map((id) => closeSession(id)));
  await shutdownAnalytics(posthog);
  httpServer.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
