/**
 * Who gets in without a token.
 *
 * This lives in its own file because it is the one decision in the HTTP
 * transport where being wrong is a security bug rather than a bad experience,
 * and http.ts starts listening on import — which makes it untestable in place.
 */

/*
 * Discovery is open. Directories index this server by connecting to it and
 * listing tools, and being listed is how people find it at all.
 *
 * Everything absent from this set requires a token, including methods that do
 * not exist yet: a new JSON-RPC method added by a future protocol revision is
 * closed until someone decides otherwise, rather than open until someone
 * notices.
 */
export const PUBLIC_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
]);

/**
 * True when a JSON-RPC message (or batch) can be served to a caller holding no
 * credential at all. Fails closed: anything unrecognised is not public.
 */
export function isPublicRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    // A batch is only as public as its least public member — otherwise a
    // tools/call rides in alongside a ping.
    return body.length > 0 && body.every((entry) => isPublicRequest(entry));
  }

  if (typeof body !== "object" || body === null) return false;

  const method = (body as { method?: unknown }).method;
  if (typeof method !== "string") return false;

  return PUBLIC_METHODS.has(method);
}

/**
 * The bearer credential on a request, from either header we accept.
 * X-API-Key is how Smithery and several directory clients pass one.
 */
export function bearerOf(headers: {
  authorization?: string;
  "x-api-key"?: string | string[];
}): string | null {
  const authHeader = headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const apiKey = headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();

  return null;
}
