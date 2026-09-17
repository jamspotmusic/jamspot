/*
 * Rate limiting for Luna (AI-powered) searches. TEA-52.
 *
 * Like handler.ts, this file has no npm/jsr imports, so `deno test` can load
 * it directly. index.ts supplies the real Supabase client.
 *
 * Where it sits in a request:
 *
 *   request -> routing decision -> Luna required? -> rate-limit check -> Luna call
 *
 * The handler only reaches the limiter after it has decided the request
 * needs Luna. Requests it rejects earlier never use up capacity. Direct
 * Ticketmaster searches go to /api/concerts and never reach this function.
 *
 * Counting happens at check time, just before the provider request. A
 * request that passes the check is therefore counted even if the provider
 * call then fails. That is intended: the provider request was attempted.
 */

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

export const DEFAULT_LUNA_RATE_LIMIT_MAX_REQUESTS = 20;
export const DEFAULT_LUNA_RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * Anonymous callers are counted per session ID + IP address. A client can
 * make up a new session ID on every request, so each IP address also gets a
 * shared ceiling. It is looser than the per-caller limit so that people who
 * share a network (campus Wi-Fi, for example) don't block each other.
 */
export const DEFAULT_LUNA_RATE_LIMIT_IP_MULTIPLIER = 5;

/** Upper bounds that stop a mistyped secret from disabling the limiter. */
const MAX_CONFIGURED_REQUESTS = 100_000;
const MAX_CONFIGURED_WINDOW_SECONDS = 86_400;

export type LunaRateLimitConfig = {
  /** Luna requests one caller may make per window. */
  maxRequests: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Shared ceiling for all anonymous callers behind one IP address. */
  ipMaxRequests: number;
};

export type EnvReader = (name: string) => string | undefined;

function readPositiveInteger(
  read: EnvReader,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = read(name)?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 1 || value > max) {
    // Logs the variable name only, never the value.
    console.warn(
      JSON.stringify({
        event: "luna_rate_limit_config_invalid",
        variable: name,
        usingDefault: fallback,
      }),
    );
    return fallback;
  }

  return value;
}

/**
 * Reads the limits from the environment on every request. Changing the
 * Supabase secrets therefore takes effect without a code change:
 *
 *   supabase secrets set LUNA_RATE_LIMIT_MAX_REQUESTS=20 LUNA_RATE_LIMIT_WINDOW_SECONDS=60
 *
 * A missing or invalid value falls back to the default instead of turning
 * the limiter off.
 */
export function readLunaRateLimitConfig(
  read: EnvReader = (name) => Deno.env.get(name),
): LunaRateLimitConfig {
  const maxRequests = readPositiveInteger(
    read,
    "LUNA_RATE_LIMIT_MAX_REQUESTS",
    DEFAULT_LUNA_RATE_LIMIT_MAX_REQUESTS,
    MAX_CONFIGURED_REQUESTS,
  );

  const windowSeconds = readPositiveInteger(
    read,
    "LUNA_RATE_LIMIT_WINDOW_SECONDS",
    DEFAULT_LUNA_RATE_LIMIT_WINDOW_SECONDS,
    MAX_CONFIGURED_WINDOW_SECONDS,
  );

  const ipMaxRequests = readPositiveInteger(
    read,
    "LUNA_RATE_LIMIT_IP_MAX_REQUESTS",
    maxRequests * DEFAULT_LUNA_RATE_LIMIT_IP_MULTIPLIER,
    MAX_CONFIGURED_REQUESTS,
  );

  return {
    maxRequests,
    windowSeconds,
    // The IP ceiling is never lower than the per-caller limit. If it were,
    // one anonymous caller would hit it first and the per-caller limit
    // would never apply.
    ipMaxRequests: Math.max(ipMaxRequests, maxRequests),
  };
}

/* -------------------------------------------------------------------------
 * Identity
 * ---------------------------------------------------------------------- */

/** Anonymous session ID header sent by the web and mobile clients. */
export const SESSION_ID_HEADER = "x-jamspot-session-id";

/**
 * CORS headers for the function. These are supabase-js's defaults plus the
 * session ID header, which the browser would otherwise block at preflight.
 * `Retry-After` is exposed so the web client can read it on a 429.
 */
export const LUNA_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    "x-retry-count",
    "traceparent",
    "tracestate",
    "baggage",
    SESSION_ID_HEADER,
  ].join(", "),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "retry-after",
};

/** Session IDs are UUIDs from the client. This check is looser but still bounded. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export type RateLimitIdentityType =
  /** Verified Supabase user ID from the JWT. Trusted. */
  | "user"
  /** Anonymous session ID from the client, combined with the IP address. */
  | "session"
  /** No usable session ID. Only the IP address identifies the caller. */
  | "ip"
  /** Nothing identifies the caller, so all such callers share one bucket. */
  | "unidentified";

export type RateLimitBucket = {
  /** Opaque key built from a hash. Never contains a raw identifier. */
  key: string;
  limit: number;
};

export type RateLimitIdentity = {
  type: RateLimitIdentityType;
  buckets: RateLimitBucket[];
};

export function readSessionId(headers: Headers): string | null {
  const value = headers.get(SESSION_ID_HEADER)?.trim();
  return value && SESSION_ID_PATTERN.test(value) ? value : null;
}

/**
 * Best-effort client IP from the headers added by the platform in front of
 * the function. Checked in order of trust. For `x-forwarded-for`, the
 * left-most entry is the original client.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const direct = headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim();

  const forwarded = headers.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();

  const ip = direct || forwarded || "";

  // IPv4, IPv6 and IPv4-mapped IPv6 only use these characters. Anything
  // else is not a real address and is ignored.
  return /^[0-9A-Fa-f:.]{2,45}$/.test(ip) ? ip.toLowerCase() : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function bucketKey(scope: string, ...parts: string[]): Promise<string> {
  return `luna:v1:${scope}:${await sha256Hex(parts.join("\u0000"))}`;
}

/**
 * Chooses the rate-limit identity in the order the ticket asks for:
 *
 * 1. Authenticated Supabase user ID, taken only from a verified JWT
 *    (`ctx.userClaims` in index.ts). Nothing in the request body counts.
 * 2. Anonymous JamSpot session ID, combined with the IP address. A session ID
 *    that changes on every request is still limited by the per-IP ceiling.
 * 3. The IP address alone.
 * 4. One shared bucket, as a last resort.
 */
export async function resolveRateLimitIdentity(
  { userId, headers }: { userId: string | null; headers: Headers },
  config: LunaRateLimitConfig,
): Promise<RateLimitIdentity> {
  if (userId) {
    return {
      type: "user",
      buckets: [{
        key: await bucketKey("user", userId),
        limit: config.maxRequests,
      }],
    };
  }

  const sessionId = readSessionId(headers);
  const ip = clientIpFromHeaders(headers);

  if (sessionId && ip) {
    return {
      type: "session",
      buckets: [
        {
          key: await bucketKey("session", sessionId, ip),
          limit: config.maxRequests,
        },
        {
          key: await bucketKey("ip", ip),
          limit: config.ipMaxRequests,
        },
      ],
    };
  }

  if (ip) {
    return {
      type: "ip",
      buckets: [{
        key: await bucketKey("ip-only", ip),
        limit: config.maxRequests,
      }],
    };
  }

  if (sessionId) {
    // No IP to pair the session ID with. The session ID is used alone
    // because it is still better than one shared bucket.
    return {
      type: "session",
      buckets: [{
        key: await bucketKey("session-only", sessionId),
        limit: config.maxRequests,
      }],
    };
  }

  return {
    type: "unidentified",
    buckets: [{
      key: await bucketKey("unidentified", "all"),
      limit: config.maxRequests,
    }],
  };
}

/* -------------------------------------------------------------------------
 * Stores
 * ---------------------------------------------------------------------- */

export type ConsumeResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Checks every bucket and counts the request in all of them, or in none.
 * A rejected request must not use up capacity.
 */
export interface RateLimitStore {
  consume(
    buckets: RateLimitBucket[],
    windowSeconds: number,
  ): Promise<ConsumeResult>;
}

/**
 * The subset of supabase-js that the RPC store uses, described by shape so
 * this file needs no Supabase import. `ctx.supabaseAdmin` matches it.
 */
export type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Production store. Calls `public.consume_luna_rate_limit`
 * (supabase/migrations/20260916120000_luna_rate_limits.sql), which runs the
 * check and the increment in one transaction. It must use the service-role
 * client, because only service_role can execute the function.
 */
export class SupabaseRpcRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RpcClient) {}

  async consume(
    buckets: RateLimitBucket[],
    windowSeconds: number,
  ): Promise<ConsumeResult> {
    const { data, error } = await this.client.rpc("consume_luna_rate_limit", {
      p_buckets: buckets,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      throw new Error("consume_luna_rate_limit failed");
    }

    // A set-returning function comes back as an array of rows.
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: unknown; retry_after_seconds?: unknown }
      | null
      | undefined;

    if (!row || typeof row.allowed !== "boolean") {
      throw new Error("consume_luna_rate_limit returned an unexpected shape");
    }

    const retryAfter = Number(row.retry_after_seconds);

    return {
      allowed: row.allowed,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.ceil(retryAfter)
        : windowSeconds,
    };
  }
}

/**
 * Same fixed-window rules as the SQL function, kept in memory. Used by the
 * tests, which pass in a clock to control time. Not for production: Edge
 * Function instances don't share memory.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly rows = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(private readonly now: () => number = () => Date.now()) {}

  consume(
    buckets: RateLimitBucket[],
    windowSeconds: number,
  ): Promise<ConsumeResult> {
    const windowMs = windowSeconds * 1000;
    const now = this.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;

    let allowed = true;

    for (const bucket of buckets) {
      const row = this.rows.get(bucket.key);

      if (!row || row.windowStart !== windowStart) {
        this.rows.set(bucket.key, { windowStart, count: 0 });
      }

      if (this.rows.get(bucket.key)!.count >= bucket.limit) {
        allowed = false;
      }
    }

    if (allowed) {
      for (const bucket of new Set(buckets.map((b) => b.key))) {
        this.rows.get(bucket)!.count += 1;
      }
    }

    return Promise.resolve({
      allowed,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowStart + windowMs - now) / 1000),
      ),
    });
  }

  /** Test helper: current count for a bucket key. */
  countFor(key: string): number {
    return this.rows.get(key)?.count ?? 0;
  }
}

/* -------------------------------------------------------------------------
 * Limiter
 * ---------------------------------------------------------------------- */

export type RateLimitDecision =
  | { outcome: "allowed"; identityType: RateLimitIdentityType }
  | {
    outcome: "rejected";
    identityType: RateLimitIdentityType;
    retryAfterSeconds: number;
  }
  | { outcome: "unavailable"; identityType: RateLimitIdentityType };

/**
 * One JSON line per event, so Supabase's log explorer can filter on
 * `event`. Only the event fields below are logged: never tokens, session
 * IDs, IP addresses, bucket keys or counters.
 */
export function logLunaEvent(fields: Record<string, unknown>): void {
  console.info(JSON.stringify(fields));
}

export class LunaRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly readEnv: EnvReader = (name) => Deno.env.get(name),
  ) {}

  /**
   * Checks the caller's capacity and counts the request if it is allowed.
   * Call this only after deciding the request needs Luna, and immediately
   * before the provider request.
   *
   * If the store fails, the result is "unavailable" and the handler returns
   * an error without calling Luna. The limiter fails closed so that an
   * outage in the counters cannot turn into unlimited LLM spend.
   */
  async check(
    { userId, headers }: { userId: string | null; headers: Headers },
  ): Promise<RateLimitDecision> {
    const config = readLunaRateLimitConfig(this.readEnv);
    const identity = await resolveRateLimitIdentity(
      { userId, headers },
      config,
    );

    const base = {
      event: "luna_rate_limit",
      identityType: identity.type,
      limit: config.maxRequests,
      windowSeconds: config.windowSeconds,
    };

    let result: ConsumeResult;

    try {
      result = await this.store.consume(
        identity.buckets,
        config.windowSeconds,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          ...base,
          outcome: "unavailable",
          error: error instanceof Error ? error.message : "unknown error",
        }),
      );
      return { outcome: "unavailable", identityType: identity.type };
    }

    if (result.allowed) {
      logLunaEvent({ ...base, outcome: "allowed" });
      return { outcome: "allowed", identityType: identity.type };
    }

    logLunaEvent({ ...base, outcome: "rejected" });
    return {
      outcome: "rejected",
      identityType: identity.type,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }
}

/* -------------------------------------------------------------------------
 * Responses
 * ---------------------------------------------------------------------- */

export const LUNA_RATE_LIMIT_MESSAGE =
  "Too many AI-powered searches. Please try again shortly.";

export function lunaRateLimitExceededResponse(
  retryAfterSeconds: number,
): Response {
  return Response.json(
    {
      type: "rate_limit_error",
      code: "luna_rate_limit_exceeded",
      message: LUNA_RATE_LIMIT_MESSAGE,
    },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    },
  );
}

export function lunaRateLimitUnavailableResponse(): Response {
  return Response.json(
    {
      type: "rate_limit_error",
      code: "luna_rate_limit_unavailable",
      message:
        "AI-powered search is temporarily unavailable. Please try again shortly.",
    },
    { status: 503 },
  );
}
