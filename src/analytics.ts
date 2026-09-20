import { PostHog } from "posthog-node";
import type { BeforeSendFn, UserIdentity } from "@posthog/mcp";

// Public project API key (phc_ keys are write-only and safe to embed).
// Same PostHog project the Pictify backend reports to, so MCP sessions land
// on the same person profiles as billing and web events.
const DEFAULT_POSTHOG_KEY = "phc_3ecva80rtrdIJiDyYVwsqjy2YI7CbhbAydPApERhNtU";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const IDENTITY_CACHE_TTL_MS = 10 * 60 * 1000;

function analyticsDisabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PICTIFY_ANALYTICS_DISABLED ?? "");
}

/**
 * Shared posthog-node client, or null when the user opted out via
 * PICTIFY_ANALYTICS_DISABLED. Callers own the lifecycle — call
 * shutdownAnalytics() before the process exits so queued events flush.
 */
export function createAnalyticsClient(): PostHog | null {
  if (analyticsDisabled()) return null;
  return new PostHog(process.env.PICTIFY_POSTHOG_KEY || DEFAULT_POSTHOG_KEY, {
    host: process.env.PICTIFY_POSTHOG_HOST || DEFAULT_POSTHOG_HOST,
    // stdio sessions can be a single tool call — flush eagerly so short-lived
    // processes don't rely solely on the shutdown hook.
    flushAt: 3,
    flushInterval: 5000,
  });
}

/**
 * Expected, caller-actionable failures that must not reach error tracking as
 * exceptions. @posthog/mcp fans every errored tool call into a `$exception`
 * sibling event, which put scanner probes and users' auth mistakes in error
 * tracking as if they were server defects. Dropping only the `$exception`
 * sibling keeps the failed `$mcp_tool_call` event (with `$mcp_is_error`), so
 * failure rates stay fully measurable in MCP analytics.
 */
const EXPECTED_ERROR_PATTERNS: RegExp[] = [
  // Protocol-level unknown method/tool (-32601/-32602): directory scanners
  // probing auth with synthetic tool names (e.g. verifymcp's
  // __verifymcp_auth_probe_*__) and confused clients. Responding with this
  // error IS the correct server behavior.
  /MCP error -3260[12]/,
  // Pictify API rejections the caller must fix themselves, as formatted by
  // formatError in utils.ts: invalid or expired key (401), quota exhausted
  // (402), unverified email or plan-gated feature (403), rate limit (429).
  /^Error \((401|402|403|429)\):/m,
  // Argument mistakes the schema cannot express (ToolInputError in utils.ts),
  // e.g. pictify_batch_render called with neither variableSets nor csvUrl.
  // The agent reads the message and corrects the call.
  /^Invalid input:/m,
];

/**
 * Directory crawlers and reputation scanners, by the `clientInfo.name` they
 * introduce themselves with.
 *
 * These accounted for roughly 37,700 of the ~38,000 analytics events this
 * server produced in its first six weeks: about a thousand connects a day, each
 * one an initialize and a tools/list, and between them zero real usage. They
 * are not a problem — being indexed is how people find the server — but they
 * drowned the funnel they were measured in.
 *
 * Every name here was observed connecting and never calling a tool. Extendable
 * at runtime via PICTIFY_PROBE_CLIENTS (comma-separated) so a new crawler
 * doesn't need a release.
 */
const KNOWN_PROBE_CLIENTS = new Set([
  "agent-tools.cloud",
  "agentstatus-probe",
  "glama",
  "glimind-probe",
  "labsco-verify",
  "mcp-reputation-scanner",
  "mcp-rugpull-research",
  "mcpbeat",
  "mcpdd",
  "mcphub",
  "mcpindex-trust",
  "mcpscan",
  "mcpwatch",
  "orank-scanner",
  "policylayer-crawler",
  "proofbench-probe",
  "reliability-bureau-spike",
  "rokmcp-probe",
  "smithery-probe",
  "verifymcp-probe",
]);

/*
 * Deliberately narrow. A loose pattern here silently deletes real users'
 * analytics, which is a failure nobody notices — so it matches only the naming
 * conventions crawlers actually announce themselves with, and never a bare word
 * that a real client might also use ("mcp", "glama-chat", "cursor").
 */
const PROBE_NAME_PATTERN = /[-_](probe|scanner|crawler)$/i;

function envProbeClients(): Set<string> {
  const extra = (process.env.PICTIFY_PROBE_CLIENTS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...KNOWN_PROBE_CLIENTS, ...extra]);
}

/** True when this client is a directory crawler rather than somebody using the product. */
export function isProbeClient(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return envProbeClients().has(normalized) || PROBE_NAME_PATTERN.test(normalized);
}

/**
 * `beforeSend` hook for @posthog/mcp. Two jobs:
 *
 * 1. Drop the `$exception` sibling of expected, caller-actionable failures.
 * 2. Drop crawler traffic — except its tool calls, which are tagged instead.
 *
 * Tool calls are never dropped, whoever made them. They are the scarce event
 * (140 in six weeks, against 19,000 connects), and a crawler that starts
 * calling tools is worth seeing rather than silently discarding. Tagging them
 * `mcp_probe` lets a query exclude them without the data being gone.
 */
export const dropExpectedExceptions: BeforeSendFn = (event) => {
  if (isProbeClient(event.properties?.["$mcp_client_name"])) {
    if (event.event !== "$mcp_tool_call") return null;
    event.properties = { ...event.properties, mcp_probe: true };
    return event;
  }

  if (event.event !== "$exception") return event;
  const list = event.properties?.["$exception_list"];
  const first = Array.isArray(list) ? (list[0] as { value?: unknown } | undefined) : undefined;
  const value = String(first?.value ?? "");
  if (EXPECTED_ERROR_PATTERNS.some((pattern) => pattern.test(value))) return null;
  return event;
};

export async function shutdownAnalytics(posthog: PostHog | null): Promise<void> {
  if (!posthog) return;
  try {
    await posthog.shutdown();
  } catch {
    // Analytics must never turn a clean exit into a crash.
  }
}

interface PictifyUserResponse {
  user?: {
    id?: string;
    uid?: string;
    email?: string;
    currentPlan?: string;
    signupMethod?: string;
  };
}

const identityCache = new Map<string, { identity: UserIdentity | null; at: number }>();

/**
 * Builds an identify callback for @posthog/mcp that resolves the Pictify user
 * behind an API key via GET /api/users/. distinct_id is the user's email to
 * match how the backend reports to PostHog (`user.email || user._id`), so MCP
 * activity merges with the rest of the product's analytics. Failures resolve
 * to null (session-scoped events) and never break tool calls.
 */
export function identityResolver(
  apiKey: string,
  baseUrl: string,
): () => Promise<UserIdentity | null> {
  return async () => {
    const cached = identityCache.get(apiKey);
    if (cached && Date.now() - cached.at < IDENTITY_CACHE_TTL_MS) {
      return cached.identity;
    }

    let identity: UserIdentity | null = null;
    try {
      const res = await fetch(`${baseUrl}/api/users/`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const data = (await res.json()) as PictifyUserResponse;
        const user = data.user;
        const distinctId = user?.email || (user?.id ? String(user.id) : null);
        if (distinctId) {
          identity = {
            distinctId,
            properties: {
              email: user?.email ?? null,
              plan: user?.currentPlan ?? null,
              pictify_uid: user?.uid ?? null,
              signup_method: user?.signupMethod ?? null,
            },
          };
        }
      }
    } catch {
      identity = null;
    }

    identityCache.set(apiKey, { identity, at: Date.now() });
    return identity;
  };
}
