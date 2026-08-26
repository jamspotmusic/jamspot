import { withSupabase } from "npm:@supabase/server@^1";

import { handleConcertQuery } from "./handler.ts";

export default {
  fetch: withSupabase(
    { auth: "publishable" },
    handleConcertQuery,
  ),
};
