/*
 * Unit tests for rate-limit.ts (TEA-52). The end-to-end behaviour through
 * handleConcertQuery is covered at the bottom of handler.test.ts.
 */

import { assert, assertEquals, assertMatch } from "jsr:@std/assert@^1";

import {
  clientIpFromHeaders,
  DEFAULT_LUNA_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_LUNA_RATE_LIMIT_WINDOW_SECONDS,
  InMemoryRateLimitStore,
  LUNA_CORS_HEADERS,
  type LunaRateLimitConfig,
  lunaRateLimitExceededResponse,
  readLunaRateLimitConfig,
  readSessionId,
  resolveRateLimitIdentity,
  type RpcClient,
  SESSION_ID_HEADER,
  SupabaseRpcRateLimitStore,
} from "./rate-limit.ts";

const config: LunaRateLimitConfig = {
  maxRequests: 20,
  windowSeconds: 60,
  ipMaxRequests: 100,
};

function silenceWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

/* --- configuration ----------------------------------------------------- */

Deno.test("readLunaRateLimitConfig defaults to 20 requests per 60 seconds", () => {
  const cfg = readLunaRateLimitConfig(() => undefined);
  assertEquals(cfg.maxRequests, DEFAULT_LUNA_RATE_LIMIT_MAX_REQUESTS);
  assertEquals(cfg.windowSeconds, DEFAULT_LUNA_RATE_LIMIT_WINDOW_SECONDS);
  assertEquals(cfg.maxRequests, 20);
  assertEquals(cfg.windowSeconds, 60);
  assertEquals(cfg.ipMaxRequests, 100);
});

Deno.test("readLunaRateLimitConfig reads the configured values", () => {
  const env: Record<string, string> = {
    LUNA_RATE_LIMIT_MAX_REQUESTS: " 5 ",
    LUNA_RATE_LIMIT_WINDOW_SECONDS: "300",
    LUNA_RATE_LIMIT_IP_MAX_REQUESTS: "40",
  };
  assertEquals(readLunaRateLimitConfig((n) => env[n]), {
    maxRequests: 5,
    windowSeconds: 300,
    ipMaxRequests: 40,
  });
});

Deno.test("readLunaRateLimitConfig reads Deno.env by default", () => {
  Deno.env.set("LUNA_RATE_LIMIT_MAX_REQUESTS", "7");
  try {
    assertEquals(readLunaRateLimitConfig().maxRequests, 7);
  } finally {
    Deno.env.delete("LUNA_RATE_LIMIT_MAX_REQUESTS");
  }
});

Deno.test("readLunaRateLimitConfig falls back to defaults for invalid values without logging them", () => {
  for (const bad of ["000", "-3", "1.5", "abc", "1e9", "Infinity"]) {
    const { result, warnings } = silenceWarnings(() =>
      readLunaRateLimitConfig((name) =>
        name === "LUNA_RATE_LIMIT_MAX_REQUESTS" ? bad : undefined
      )
    );
    assertEquals(result.maxRequests, 20, bad);
    assertEquals(warnings.length, 1);
    assertEquals(warnings[0].includes(bad), false);
  }
});

Deno.test("readLunaRateLimitConfig never lets the IP ceiling undercut the per-caller limit", () => {
  const env: Record<string, string> = {
    LUNA_RATE_LIMIT_MAX_REQUESTS: "10",
    LUNA_RATE_LIMIT_IP_MAX_REQUESTS: "2",
  };
  assertEquals(readLunaRateLimitConfig((n) => env[n]).ipMaxRequests, 10);
});

/* --- identity ---------------------------------------------------------- */

Deno.test("readSessionId accepts UUID-like values and rejects junk", () => {
  const h = (v: string) => new Headers({ [SESSION_ID_HEADER]: v });
  assertEquals(
    readSessionId(h("3f1c2b8e-9d4a-4c1e-8f7a-2b6d5e4c3a21")),
    "3f1c2b8e-9d4a-4c1e-8f7a-2b6d5e4c3a21",
  );
  assertEquals(readSessionId(new Headers()), null);
  assertEquals(readSessionId(h("short")), null);
  assertEquals(readSessionId(h("x".repeat(129))), null);
  assertEquals(readSessionId(h("has spaces in it here ok")), null);
  assertEquals(readSessionId(h("'; drop table x; --------")), null);
});

Deno.test("clientIpFromHeaders prefers the platform headers and validates the value", () => {
  assertEquals(
    clientIpFromHeaders(
      new Headers({
        "cf-connecting-ip": "198.51.100.9",
        "x-forwarded-for": "203.0.113.7",
      }),
    ),
    "198.51.100.9",
  );
  assertEquals(
    clientIpFromHeaders(
      new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    ),
    "203.0.113.7",
  );
  assertEquals(
    clientIpFromHeaders(new Headers({ "x-real-ip": "2001:DB8::1" })),
    "2001:db8::1",
  );
  assertEquals(
    clientIpFromHeaders(new Headers({ "x-forwarded-for": "evil<script>" })),
    null,
  );
  assertEquals(clientIpFromHeaders(new Headers()), null);
});

Deno.test("resolveRateLimitIdentity prefers the verified user ID", async () => {
  const identity = await resolveRateLimitIdentity({
    userId: "user-1",
    headers: new Headers({
      [SESSION_ID_HEADER]: "a".repeat(32),
      "x-forwarded-for": "203.0.113.7",
    }),
  }, config);

  assertEquals(identity.type, "user");
  assertEquals(identity.buckets.length, 1);
  assertEquals(identity.buckets[0].limit, 20);
});

Deno.test("resolveRateLimitIdentity pairs a session ID with the IP and adds an IP ceiling", async () => {
  const identity = await resolveRateLimitIdentity({
    userId: null,
    headers: new Headers({
      [SESSION_ID_HEADER]: "a".repeat(32),
      "x-forwarded-for": "203.0.113.7",
    }),
  }, config);

  assertEquals(identity.type, "session");
  assertEquals(identity.buckets.map((b) => b.limit), [20, 100]);
});

Deno.test("resolveRateLimitIdentity falls back to IP, then session alone, then a shared bucket", async () => {
  const ipOnly = await resolveRateLimitIdentity({
    userId: null,
    headers: new Headers({ "x-forwarded-for": "203.0.113.7" }),
  }, config);
  assertEquals(ipOnly.type, "ip");

  const sessionOnly = await resolveRateLimitIdentity({
    userId: null,
    headers: new Headers({ [SESSION_ID_HEADER]: "a".repeat(32) }),
  }, config);
  assertEquals(sessionOnly.type, "session");
  assertEquals(sessionOnly.buckets.length, 1);

  const nothing = await resolveRateLimitIdentity(
    { userId: null, headers: new Headers() },
    config,
  );
  assertEquals(nothing.type, "unidentified");
});

Deno.test("bucket keys are stable hashes that never contain the raw identifier", async () => {
  const headers = new Headers({
    [SESSION_ID_HEADER]: "a".repeat(32),
    "x-forwarded-for": "203.0.113.7",
  });

  const a = await resolveRateLimitIdentity(
    { userId: "user-1", headers },
    config,
  );
  const b = await resolveRateLimitIdentity(
    { userId: "user-1", headers },
    config,
  );
  const c = await resolveRateLimitIdentity(
    { userId: "user-2", headers },
    config,
  );
  const anon = await resolveRateLimitIdentity(
    { userId: null, headers },
    config,
  );

  assertEquals(a.buckets[0].key, b.buckets[0].key);
  assert(a.buckets[0].key !== c.buckets[0].key);

  for (const bucket of [...a.buckets, ...anon.buckets]) {
    assertMatch(bucket.key, /^luna:v1:[a-z-]+:[0-9a-f]{64}$/);
    for (const raw of ["user-1", "a".repeat(32), "203.0.113.7"]) {
      assertEquals(bucket.key.includes(raw), false);
    }
  }
});

/* --- in-memory store --------------------------------------------------- */

Deno.test("InMemoryRateLimitStore allows up to the limit, rejects after, and resets per window", async () => {
  let now = 120_000; // aligned to a 60 s window
  const store = new InMemoryRateLimitStore(() => now);
  const bucket = [{ key: "k", limit: 2 }];

  assertEquals((await store.consume(bucket, 60)).allowed, true);
  assertEquals((await store.consume(bucket, 60)).allowed, true);

  now += 45_000;
  const rejected = await store.consume(bucket, 60);
  assertEquals(rejected, { allowed: false, retryAfterSeconds: 15 });
  assertEquals(store.countFor("k"), 2, "a rejection does not add to the count");

  now += 15_000;
  assertEquals((await store.consume(bucket, 60)).allowed, true);
  assertEquals(store.countFor("k"), 1);
});

Deno.test("InMemoryRateLimitStore counts all buckets or none", async () => {
  const store = new InMemoryRateLimitStore(() => 0);

  await store.consume([{ key: "full", limit: 1 }], 60);
  const result = await store.consume(
    [{ key: "fresh", limit: 5 }, { key: "full", limit: 1 }],
    60,
  );

  assertEquals(result.allowed, false);
  assertEquals(store.countFor("fresh"), 0);
});

/* --- Supabase RPC store ------------------------------------------------ */

function fakeRpc(result: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

Deno.test("SupabaseRpcRateLimitStore calls consume_luna_rate_limit with the buckets and window", async () => {
  const { client, calls } = fakeRpc({
    data: [{ allowed: true, retry_after_seconds: 42 }],
    error: null,
  });
  const store = new SupabaseRpcRateLimitStore(client);
  const buckets = [{ key: "k", limit: 3 }];

  assertEquals(await store.consume(buckets, 60), {
    allowed: true,
    retryAfterSeconds: 42,
  });
  assertEquals(calls, [{
    fn: "consume_luna_rate_limit",
    args: { p_buckets: buckets, p_window_seconds: 60 },
  }]);
});

Deno.test("SupabaseRpcRateLimitStore maps a rejection and a missing retry value", async () => {
  const { client } = fakeRpc({
    data: { allowed: false, retry_after_seconds: null },
    error: null,
  });
  assertEquals(
    await new SupabaseRpcRateLimitStore(client).consume([{
      key: "k",
      limit: 1,
    }], 60),
    { allowed: false, retryAfterSeconds: 60 },
  );
});

Deno.test("SupabaseRpcRateLimitStore throws on an RPC error or an unexpected shape, without echoing details", async () => {
  for (
    const result of [
      { data: null, error: { message: "permission denied for secret-thing" } },
      { data: [], error: null },
      { data: [{ allowed: "yes" }], error: null },
    ]
  ) {
    const { client } = fakeRpc(result);
    let message = "";
    try {
      await new SupabaseRpcRateLimitStore(client).consume([{
        key: "k",
        limit: 1,
      }], 60);
    } catch (error) {
      message = (error as Error).message;
    }
    assert(message.length > 0, "expected a throw");
    assertEquals(message.includes("secret-thing"), false);
  }
});

/* --- responses and CORS ------------------------------------------------ */

Deno.test("lunaRateLimitExceededResponse matches the documented contract", async () => {
  const response = lunaRateLimitExceededResponse(0);
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "1");
  assertEquals(await response.json(), {
    type: "rate_limit_error",
    code: "luna_rate_limit_exceeded",
    message: "Too many AI-powered searches. Please try again shortly.",
  });
});

Deno.test("CORS allows the session header and exposes Retry-After", () => {
  assert(
    LUNA_CORS_HEADERS["Access-Control-Allow-Headers"].includes(
      SESSION_ID_HEADER,
    ),
  );
  assert(
    LUNA_CORS_HEADERS["Access-Control-Allow-Headers"].includes("authorization"),
  );
  assertEquals(
    LUNA_CORS_HEADERS["Access-Control-Expose-Headers"],
    "retry-after",
  );
});
