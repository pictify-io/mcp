import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

export class PictifyApiError extends Error {
  constructor(
    public status: number,
    public type: string,
    public title: string,
    public detail: string,
    public errors?: Array<{ field: string; message: string; code: string }>,
    public retryAfter?: number,
  ) {
    super(detail);
    this.name = "PictifyApiError";
  }
}

export class PictifyClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private timeout: number;

  constructor(apiKey: string, baseUrl = "https://api.pictify.io") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.maxRetries = 3;
    this.timeout = 60_000;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": `@pictify/mcp-server/${pkg.version}`,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({})) as Record<string, unknown>;

          if (res.status < 500) {
            throw new PictifyApiError(
              res.status,
              (errorBody.type as string) ?? "unknown",
              (errorBody.title as string) ?? res.statusText,
              (errorBody.detail as string) ?? "Request failed",
              errorBody.errors as Array<{ field: string; message: string; code: string }> | undefined,
              res.headers.get("Retry-After")
                ? parseInt(res.headers.get("Retry-After")!, 10)
                : undefined,
            );
          }

          lastError = new PictifyApiError(
            res.status,
            (errorBody.type as string) ?? "server_error",
            (errorBody.title as string) ?? "Server Error",
            (errorBody.detail as string) ?? `Server returned ${res.status}`,
          );
          continue;
        }

        return (await res.json()) as T;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof PictifyApiError) throw err;
        lastError = err as Error;
        if ((err as Error).name === "AbortError") {
          throw new PictifyApiError(
            408,
            "timeout",
            "Request Timeout",
            "The request timed out after 60 seconds",
          );
        }
        if (attempt === this.maxRetries) throw err;
      }
    }

    throw lastError;
  }

  get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    return this.request("GET", `${path}${qs}`);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request("POST", path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request("PUT", path, body);
  }

  del<T>(path: string): Promise<T> {
    return this.request("DELETE", path);
  }
}
