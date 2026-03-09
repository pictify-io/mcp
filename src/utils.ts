import { PictifyApiError } from "./api-client.js";

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
