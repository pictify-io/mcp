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

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function parseErrorField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
}

function parseErrorArray(body: Record<string, unknown>): Array<{ field: string; message: string; code: string }> | undefined {
  if (!Array.isArray(body.errors)) return undefined;
  return body.errors as Array<{ field: string; message: string; code: string }>;
}

export class PictifyClient {
  private baseUrl: string;
  private apiKey: string;
  private userAgent: string;
  private maxRetries: number;
  private timeout: number;

  constructor(apiKey: string, baseUrl = "https://api.pictify.io", version = "0.1.0") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.userAgent = `@pictify/mcp-server/${version}`;
    this.maxRetries = 3;
    this.timeout = 60_000;
  }

  private buildHeaders(method: HttpMethod): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": this.userAgent,
    };
    if (method === "POST" || method === "PUT") {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let lastError: Error = new Error("Request failed after retries");

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
          headers: this.buildHeaders(method),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({})) as Record<string, unknown>;

          if (res.status < 500) {
            throw new PictifyApiError(
              res.status,
              parseErrorField(errorBody, "type") ?? "unknown",
              parseErrorField(errorBody, "title") ?? res.statusText,
              parseErrorField(errorBody, "detail") ?? "Request failed",
              parseErrorArray(errorBody),
              res.headers.get("Retry-After")
                ? parseInt(res.headers.get("Retry-After")!, 10)
                : undefined,
            );
          }

          lastError = new PictifyApiError(
            res.status,
            parseErrorField(errorBody, "type") ?? "server_error",
            parseErrorField(errorBody, "title") ?? "Server Error",
            parseErrorField(errorBody, "detail") ?? `Server returned ${res.status}`,
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
            `The request timed out after ${this.timeout / 1000} seconds`,
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
