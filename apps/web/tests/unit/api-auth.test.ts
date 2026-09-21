import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import { resolveDisplayName, resolveRequestIdentity } from "../../lib/api-auth";

/**
 * How a request's caller is identified. Two transports have to work against
 * the same routes: the web app's session cookie and the mobile app's
 * `Authorization: Bearer` header.
 */

const OWNER = "0d6638c2-1340-4b79-8722-e378bade9f82";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Capture = { url: string; headers: Record<string, string> };

async function withFetch<T>(
  handler: (capture: Capture) => Response,
  fn: () => Promise<T>,
): Promise<{ captures: Capture[]; result: T }> {
  const originalFetch = globalThis.fetch;
  const captures: Capture[] = [];

  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const capture = { url: String(url), headers };
    captures.push(capture);
    return handler(capture);
  };

  try {
    return { captures, result: await fn() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/reviews", { method: "POST", headers });
}

const authUser = { id: OWNER, email: "jam@example.com", aud: "authenticated", role: "authenticated" };

// ---------------------------------------------------------------------------
// Bearer token - the mobile transport
// ---------------------------------------------------------------------------

test("resolveRequestIdentity accepts a bearer token and revalidates it", async () => {
  const { captures, result: identity } = await withFetch(
    () => jsonResponse(authUser),
    () => resolveRequestIdentity(request({ authorization: "Bearer jwt-abc" })),
  );

  assert.ok(identity, "a valid token should produce an identity");
  assert.equal(identity.user.id, OWNER);
  // getUser(), not getSession(): the token is checked against the Auth server
  // rather than being taken at face value.
  assert.match(captures[0].url, /\/auth\/v1\/user/);
  assert.equal(captures[0].headers.authorization, "Bearer jwt-abc");
});

test("the client returned for a bearer caller carries their token", async () => {
  // Everything the route does with this client must be seen by RLS as the
  // caller, or ownership would be decided by the app alone.
  const { result: identity } = await withFetch(
    () => jsonResponse(authUser),
    () => resolveRequestIdentity(request({ authorization: "Bearer jwt-abc" })),
  );
  assert.ok(identity);

  const { captures } = await withFetch(
    () => jsonResponse([]),
    async () => {
      await identity.supabase.from("reviews").select("id");
    },
  );

  assert.equal(captures[0].headers.authorization, "Bearer jwt-abc");
});

test("resolveRequestIdentity rejects a token the Auth server refuses", async () => {
  const { result: identity } = await withFetch(
    () => jsonResponse({ message: "invalid claim: missing sub claim" }, 401),
    () => resolveRequestIdentity(request({ authorization: "Bearer forged" })),
  );
  assert.equal(identity, null);
});

test("resolveRequestIdentity parses the Bearer scheme case-insensitively", async () => {
  const { captures } = await withFetch(
    () => jsonResponse(authUser),
    () => resolveRequestIdentity(request({ authorization: "bearer jwt-abc" })),
  );
  assert.equal(captures[0].headers.authorization, "Bearer jwt-abc");
});

// ---------------------------------------------------------------------------
// Cookie session - the web transport
// ---------------------------------------------------------------------------

test("resolveRequestIdentity returns null when there is no session at all", async () => {
  // No Authorization header and no session cookie: an anonymous visitor.
  const identity = await resolveRequestIdentity(request());
  assert.equal(identity, null);
});

test("a malformed Authorization header falls through rather than authenticating", async () => {
  for (const header of ["Bearer", "Basic abc123", "jwt-abc", "Bearer   "]) {
    const identity = await resolveRequestIdentity(request({ authorization: header }));
    assert.equal(identity, null, `"${header}" must not authenticate anyone`);
  }
});

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

function identityFor(email: string | null) {
  return {
    user: { id: OWNER, email } as never,
    supabase: createClient("https://example.supabase.co", "sb_publishable_test"),
  };
}

test("resolveDisplayName prefers the profile username", async () => {
  const { result: name } = await withFetch(
    () => jsonResponse({ username: "jamfan" }),
    () => resolveDisplayName(identityFor("jam@example.com")),
  );
  assert.equal(name, "jamfan");
});

test("resolveDisplayName falls back to the email local part", async () => {
  const { result: name } = await withFetch(
    () => jsonResponse([]),
    () => resolveDisplayName(identityFor("jam@example.com")),
  );
  assert.equal(name, "jam");
});

test("resolveDisplayName ignores a blank profile username", async () => {
  const { result: name } = await withFetch(
    () => jsonResponse({ username: "   " }),
    () => resolveDisplayName(identityFor("jam@example.com")),
  );
  assert.equal(name, "jam");
});

test("resolveDisplayName always yields a non-blank name", async () => {
  // user_name is NOT NULL and non-blank in the database, so a user with no
  // profile and no email must still be able to post.
  const { result: name } = await withFetch(
    () => jsonResponse([]),
    () => resolveDisplayName(identityFor(null)),
  );
  assert.equal(name, "JamSpot listener");
  assert.ok(name.trim().length > 0);
});
