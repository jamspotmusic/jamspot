import { withSupabase } from "npm:@supabase/server@^1";

import { handleConcertQuery } from "./handler.ts";
import {
  LUNA_CORS_HEADERS,
  LunaRateLimiter,
  type RpcClient,
  SupabaseRpcRateLimitStore,
} from "./rate-limit.ts";

export default {
  fetch: withSupabase(
    {
      /*
       * "user" first: a signed-in caller's JWT is verified and becomes the
       * trusted rate-limit identity. A signed-out supabase-js client sends
       * the publishable key instead, which "user" skips and "publishable"
       * accepts. A JWT that is present but invalid is rejected; it does not
       * fall back to anonymous.
       */
      auth: ["user", "publishable"],
      // Adds x-jamspot-session-id to the allowed headers (TEA-52).
      cors: LUNA_CORS_HEADERS,
    },
    (req, ctx) =>
      handleConcertQuery(req, {
        userId: ctx.authMode === "user" ? ctx.userClaims?.id ?? null : null,
        // Service-role client: only service_role may execute
        // consume_luna_rate_limit. The cast is needed because the project
        // has no generated Database types, so supabase-js types every RPC's
        // arguments as `never`.
        rateLimiter: new LunaRateLimiter(
          new SupabaseRpcRateLimitStore(
            ctx.supabaseAdmin as unknown as RpcClient,
          ),
        ),
      }),
  ),
};
