import { PostHog } from "posthog-node";
import type { UserIdentity } from "@posthog/mcp";

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
