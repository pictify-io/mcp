import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatError,
  requireExactlyOne,
  expectField,
  ToolInputError,
  ToolResponseError,
} from "./utils.js";
import { PictifyApiError } from "./api-client.js";
import { dropExpectedExceptions, isProbeClient } from "./analytics.js";

const textOf = (result: { content: Array<{ text: string }> }) => result.content[0].text;

describe("requireExactlyOne", () => {
  test("passes when exactly one is given", () => {
    assert.doesNotThrow(() => requireExactlyOne({ html: "<p>hi</p>", url: undefined }, "hint"));
  });

  test("names all the options when none is given", () => {
    // The agent has only this sentence to correct the call with, so it has to
    // say what the choices are, not just that a choice was missing.
    assert.throws(
      () => requireExactlyOne({ html: undefined, url: undefined, template: undefined }, "Pick one."),
      (error: Error) => {
        assert.ok(error instanceof ToolInputError);
        assert.equal(error.message, "Provide exactly one of html, url or template. Pick one.");
        return true;
      },
    );
  });

  test("names the conflicting pair when two are given", () => {
    assert.throws(
      () => requireExactlyOne({ html: "<p>", url: "https://x.test", template: undefined }, "Pick one."),
      (error: Error) => {
        assert.match(error.message, /^html and url are mutually exclusive/);
        return true;
      },
    );
  });

  test("null counts as absent, not as a choice", () => {
    // Agents pass null for "not applicable" constantly; treating it as present
    // would reject a call that is actually correct.
    assert.doesNotThrow(() =>
      requireExactlyOne({ html: "<p>hi</p>", url: null, template: null }, "hint"),
    );
  });

  test("an empty string is a real value, not an omission", () => {
    // Empty html is a caller mistake worth surfacing as a conflict rather than
    // silently letting the other branch win.
    assert.throws(() => requireExactlyOne({ html: "", url: "https://x.test" }, "hint"));
  });

  test("reads correctly with just two options", () => {
    assert.throws(
      () => requireExactlyOne({ variableSets: undefined, csvUrl: undefined }, "hint"),
      /Provide exactly one of variableSets or csvUrl\./,
    );
  });
});

describe("expectField", () => {
  test("returns the value when it is there", () => {
    assert.deepEqual(expectField({ url: "x" }, "gif", "POST /gif"), { url: "x" });
  });

  test("names the field and the endpoint when it is missing", () => {
    // The whole point: the alert should say which contract broke, instead of
    // "Cannot read properties of undefined (reading 'url')".
    assert.throws(
      () => expectField(undefined, "gif", "POST /gif"),
      (error: Error) => {
        assert.ok(error instanceof ToolResponseError);
        assert.equal(error.message, "expected `gif` in the response from POST /gif");
        return true;
      },
    );
  });

  test("treats null the same as missing", () => {
    assert.throws(() => expectField(null, "template", "POST /templates"), ToolResponseError);
  });

  test("lets falsy-but-present values through", () => {
    assert.equal(expectField(0, "count", "GET /x"), 0);
    assert.equal(expectField("", "name", "GET /x"), "");
    assert.equal(expectField(false, "ok", "GET /x"), false);
  });
});

describe("formatError", () => {
  test("a caller mistake reads as Invalid input", () => {
    const text = textOf(formatError(new ToolInputError("Provide exactly one of a or b.")));
    assert.equal(text, "Invalid input: Provide exactly one of a or b.");
  });

  test("a broken response says so, and says it is ours", () => {
    const text = textOf(formatError(new ToolResponseError("expected `gif` in the response from POST /gif")));
    assert.match(text, /^Unexpected response from the Pictify API: expected `gif`/);
    assert.match(text, /This is a Pictify bug/);
  });

  test("a 401 still carries the key guidance the filter matches on", () => {
    // analytics.ts matches this rendered wording. If it changes here without
    // changing there, expected failures start paging as server defects.
    const text = textOf(formatError(new PictifyApiError(401, "unauthorized", "Unauthorized", "Invalid Request")));
    assert.match(text, /^Error \(401\):/m);
  });

  test("anything else is still an unexpected error", () => {
    const text = textOf(formatError(new TypeError("boom")));
    assert.equal(text, "Unexpected error: boom");
  });
});

describe("the expected-error filter and formatError agree", () => {
  const exceptionFor = (message: string) => ({
    event: "$exception",
    properties: { $exception_list: [{ value: message }] },
  });

  for (const [label, error] of [
    ["401 unauthorized", new PictifyApiError(401, "x", "Unauthorized", "Invalid Request")],
    ["402 quota", new PictifyApiError(402, "x", "Payment Required", "Out of renders")],
    ["403 unverified", new PictifyApiError(403, "x", "Forbidden", "Email verification required")],
    ["429 rate limit", new PictifyApiError(429, "x", "Too Many Requests", "Slow down")],
    ["a caller mistake", new ToolInputError("Provide exactly one of a or b.")],
  ] as const) {
    test(`${label} does not reach error tracking`, () => {
      const rendered = textOf(formatError(error));
      assert.equal(dropExpectedExceptions(exceptionFor(rendered) as never), null);
    });
  }

  test("a broken response DOES reach error tracking", () => {
    // This one is a real defect. Filtering it would hide the thing worth waking
    // up for.
    const rendered = textOf(formatError(new ToolResponseError("expected `gif` in the response from POST /gif")));
    assert.notEqual(dropExpectedExceptions(exceptionFor(rendered) as never), null);
  });

  test("a 500 DOES reach error tracking", () => {
    const rendered = textOf(formatError(new PictifyApiError(500, "x", "Server Error", "boom")));
    assert.notEqual(dropExpectedExceptions(exceptionFor(rendered) as never), null);
  });
});

describe("probe clients", () => {
  for (const name of ["glimind-probe", "mcpbeat", "glama", "smithery-probe", "GLIMIND-PROBE", " mcpwatch "]) {
    test(`${name.trim()} is a crawler`, () => {
      assert.equal(isProbeClient(name), true);
    });
  }

  for (const name of ["claude-code", "claude-ai", "Anthropic/ClaudeAI", "codex-mcp-client", "cursor", "mcp"]) {
    test(`${name} is not`, () => {
      // Misclassifying a real client silently deletes its analytics, which is
      // a failure nobody notices.
      assert.equal(isProbeClient(name), false);
    });
  }

  test("matches the -probe/-scanner/-crawler conventions", () => {
    assert.equal(isProbeClient("somethingnew-probe"), true);
    assert.equal(isProbeClient("acme-scanner"), true);
    assert.equal(isProbeClient("acme-crawler"), true);
  });

  test("does not match a word merely containing one", () => {
    assert.equal(isProbeClient("probe-driven-ide"), false);
    assert.equal(isProbeClient("scanner-pro-app"), false);
  });

  test("handles junk without throwing", () => {
    for (const value of [undefined, null, "", "   ", 42, {}]) {
      assert.equal(isProbeClient(value), false);
    }
  });
});

describe("what crawler traffic does to analytics", () => {
  const probeEvent = (event: string) => ({
    event,
    properties: { $mcp_client_name: "glimind-probe" },
  });

  for (const event of ["$mcp_initialize", "$mcp_tools_list", "$identify"]) {
    test(`${event} from a crawler is dropped`, () => {
      assert.equal(dropExpectedExceptions(probeEvent(event) as never), null);
    });
  }

  test("a crawler's tool call is kept, and tagged", () => {
    // Tool calls are the scarce event — 140 in six weeks against 19,000
    // connects. A crawler that starts calling tools is worth seeing.
    const result = dropExpectedExceptions(probeEvent("$mcp_tool_call") as never) as {
      properties: Record<string, unknown>;
    };
    assert.notEqual(result, null);
    assert.equal(result.properties.mcp_probe, true);
  });

  test("a real client's events are untouched", () => {
    const event = { event: "$mcp_initialize", properties: { $mcp_client_name: "claude-code" } };
    assert.deepEqual(dropExpectedExceptions(event as never), event);
  });

  test("an event with no client name is kept", () => {
    const event = { event: "$mcp_initialize", properties: {} };
    assert.deepEqual(dropExpectedExceptions(event as never), event);
  });
});
