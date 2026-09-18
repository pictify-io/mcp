import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPublicRequest, bearerOf, PUBLIC_METHODS } from "./auth-policy.ts";

/**
 * The transport answers an unauthenticated caller in one of two ways: serve it,
 * or 401 with a pointer to the authorization server. This function is that
 * fork. Getting it wrong in one direction drops us out of every MCP directory;
 * in the other, it hands anonymous callers someone else's renders.
 */

describe("what a caller with no token may do", () => {
  for (const method of PUBLIC_METHODS) {
    test(`${method} is served`, () => {
      assert.equal(isPublicRequest({ jsonrpc: "2.0", id: 1, method }), true);
    });
  }

  // These are the ones that spend quota, read data, or run someone's HTML.
  for (const method of [
    "tools/call",
    "resources/read",
    "prompts/get",
    "completion/complete",
    "logging/setLevel",
    "sampling/createMessage",
  ]) {
    test(`${method} needs a token`, () => {
      assert.equal(isPublicRequest({ jsonrpc: "2.0", id: 1, method }), false);
    });
  }
});

describe("failing closed", () => {
  test("a method we have never heard of is not public", () => {
    // A future protocol revision adding a method must not be open by default.
    assert.equal(isPublicRequest({ jsonrpc: "2.0", id: 1, method: "tools/invoke" }), false);
  });

  test("a message with no method at all is not public", () => {
    assert.equal(isPublicRequest({ jsonrpc: "2.0", id: 1 }), false);
  });

  test("a non-string method is not public", () => {
    assert.equal(isPublicRequest({ method: { toString: () => "ping" } }), false);
    assert.equal(isPublicRequest({ method: ["ping"] }), false);
  });

  test("garbage is not public", () => {
    for (const body of [undefined, null, "ping", 42, true]) {
      assert.equal(isPublicRequest(body), false);
    }
  });

  test("a method that only looks like a public one is not public", () => {
    assert.equal(isPublicRequest({ method: "tools/list_all" }), false);
    assert.equal(isPublicRequest({ method: "Tools/List" }), false);
    assert.equal(isPublicRequest({ method: " ping" }), false);
  });
});

describe("batches", () => {
  test("all-public batch is served", () => {
    assert.equal(
      isPublicRequest([{ method: "ping" }, { method: "tools/list" }]),
      true,
    );
  });

  test("one tools/call closes the whole batch", () => {
    // The interesting attack: hide the call behind messages that are fine.
    assert.equal(
      isPublicRequest([{ method: "ping" }, { method: "tools/call" }, { method: "ping" }]),
      false,
    );
  });

  test("an empty batch is not a free pass", () => {
    assert.equal(isPublicRequest([]), false);
  });

  test("nested arrays do not smuggle anything through", () => {
    assert.equal(isPublicRequest([[{ method: "tools/call" }]]), false);
  });
});

describe("reading the credential", () => {
  test("takes a Bearer token", () => {
    assert.equal(bearerOf({ authorization: "Bearer pic_live_abc" }), "pic_live_abc");
  });

  test("takes X-API-Key, which is how Smithery sends one", () => {
    assert.equal(bearerOf({ "x-api-key": "pic_live_abc" }), "pic_live_abc");
  });

  test("prefers Authorization when both are present", () => {
    assert.equal(
      bearerOf({ authorization: "Bearer from-header", "x-api-key": "from-key" }),
      "from-header",
    );
  });

  test("an empty or whitespace-only credential is no credential", () => {
    // Otherwise it reaches verification as "", which is a pointless round trip
    // and an ambiguous one to read in the logs.
    assert.equal(bearerOf({ authorization: "Bearer " }), null);
    assert.equal(bearerOf({ authorization: "Bearer    " }), null);
    assert.equal(bearerOf({ "x-api-key": "  " }), null);
  });

  test("ignores other auth schemes", () => {
    assert.equal(bearerOf({ authorization: "Basic dXNlcjpwYXNz" }), null);
    assert.equal(bearerOf({ authorization: "bearer lowercase" }), null);
  });

  test("ignores a repeated X-API-Key header", () => {
    // express hands back an array when a header arrives twice; picking one
    // arbitrarily would make which credential is used depend on header order.
    assert.equal(bearerOf({ "x-api-key": ["a", "b"] }), null);
  });

  test("no headers, no credential", () => {
    assert.equal(bearerOf({}), null);
  });
});
