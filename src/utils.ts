import { PictifyApiError } from "./api-client.js";

/**
 * A tool was called with arguments the schema cannot express as invalid
 * (e.g. "exactly one of A or B"). It is the caller's mistake, not a server
 * defect: formatError renders it as "Invalid input:" so the agent can correct
 * the call, and analytics.ts keeps it out of error tracking.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * The API answered 2xx with a body that isn't the shape we render from.
 *
 * Unlike ToolInputError this IS a defect worth paging on, so it is deliberately
 * not in the expected-error list — the point is only that the alert should name
 * the field and the endpoint instead of arriving as "Cannot read properties of
 * undefined (reading 'url')" from whichever line happened to dereference first.
 */
export class ToolResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolResponseError";
  }
}

/**
 * Read a field the API is contracted to return, failing loudly and by name
 * when it isn't there.
 */
export function expectField<T>(
  value: T | null | undefined,
  field: string,
  endpoint: string,
): T {
  if (value === undefined || value === null) {
    throw new ToolResponseError(`expected \`${field}\` in the response from ${endpoint}`);
  }
  return value;
}

/**
 * Enforce "exactly one of these arguments", which a zod raw shape cannot say.
 *
 * Most tools here document the rule in prose and then forward whatever arrives:
 * a call with none of them goes to the API to be rejected there, and a call
 * with two silently sends both and lets the backend pick. Neither reaches the
 * agent as something it can act on. This turns both into one sentence naming
 * the arguments and what each is for.
 *
 * `hint` should say what to pass and why — it is the only thing the agent has
 * to correct the call with.
 */
export function requireExactlyOne(
  candidates: Record<string, unknown>,
  hint: string,
): void {
  const provided = Object.entries(candidates)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name]) => name);

  const names = Object.keys(candidates);
  const list = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

  if (provided.length === 0) {
    throw new ToolInputError(`Provide exactly one of ${list}. ${hint}`);
  }

  if (provided.length > 1) {
    throw new ToolInputError(
      `${provided.join(" and ")} are mutually exclusive — pass exactly one of ${list}. ${hint}`,
    );
  }
}

export function formatError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof PictifyApiError) {
    let message = `Error (${error.status}): ${error.title}\n${error.detail}`;

    if (error.errors && error.errors.length > 0) {
      message +=
        "\n\nValidation errors:\n" +
        error.errors.map((e) => `- ${e.field}: ${e.message}`).join("\n");
    }

    if (error.retryAfter) {
      message += `\n\nRate limited. Retry after ${error.retryAfter} seconds.`;
    }

    // Add guidance for common status codes
    switch (error.status) {
      case 401:
        message += "\n\nCheck that your PICTIFY_API_KEY is valid and not expired.";
        break;
      case 402:
        message += "\n\nUpgrade your plan at https://pictify.io/dashboard to increase your quota.";
        break;
      case 409:
        message += "\n\nThis is a state conflict. Check the resource's current status before retrying.";
        break;
    }

    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }

  if (error instanceof ToolInputError) {
    return {
      content: [{ type: "text", text: `Invalid input: ${error.message}` }],
      isError: true,
    };
  }

  if (error instanceof ToolResponseError) {
    return {
      content: [
        {
          type: "text",
          text: `Unexpected response from the Pictify API: ${error.message}. This is a Pictify bug, not something the call can be corrected for.`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Unexpected error: ${(error as Error).message}`,
      },
    ],
    isError: true,
  };
}
