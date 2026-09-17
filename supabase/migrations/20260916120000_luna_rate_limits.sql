-- TEA-52: server-side rate limiting for Luna (AI-powered) concert searches.
--
-- The `concert-query` Edge Function calls `consume_luna_rate_limit` after it
-- has decided a request really needs Luna and before it calls the LLM. Edge
-- Function instances share no memory, so the counters live here and one
-- function call does the check and the increment in a single transaction.
--
-- Fixed-window counting: each bucket holds one row with the start of its
-- current window and the number of requests counted in it. A request in a
-- newer window resets the row. The table stays bounded by the number of
-- distinct callers, and stale rows are pruned opportunistically.
--
-- Bucket keys are SHA-256 hashes built by the Edge Function, so this table
-- never stores raw user IDs, session IDs, or IP addresses.

create table if not exists public.luna_rate_limits (
  bucket_key    text        primary key,
  window_start  timestamptz not null,
  request_count integer     not null default 0 check (request_count >= 0),
  updated_at    timestamptz not null default now()
);

create index if not exists luna_rate_limits_window_start_idx
  on public.luna_rate_limits (window_start);

-- Internal bookkeeping only. With RLS enabled and no policies, the anon and
-- authenticated roles can neither read nor write it, even if grants change.
alter table public.luna_rate_limits enable row level security;
revoke all on table public.luna_rate_limits from anon, authenticated;

/*
 * Checks every bucket and counts the request against all of them, or against
 * none of them.
 *
 * p_buckets:        [{"key": "<hash>", "limit": 20}, ...] (1 to 8 entries)
 * p_window_seconds: window length. Windows are aligned to the epoch, so all
 *                   buckets that share a length also share boundaries.
 *
 * Returns allowed = false without incrementing anything when any bucket is
 * already at its limit, so a rejected request does not use up capacity.
 * retry_after_seconds is the time until the current window ends.
 */
create or replace function public.consume_luna_rate_limit(
  p_buckets        jsonb,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now          timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_bucket       record;
  v_count        integer;
  v_keys         text[] := '{}';
  v_allowed      boolean := true;
begin
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'p_window_seconds must be between 1 and 86400';
  end if;

  if p_buckets is null
     or jsonb_typeof(p_buckets) <> 'array'
     or jsonb_array_length(p_buckets) not between 1 and 8 then
    raise exception 'p_buckets must be an array of 1 to 8 buckets';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  -- Keys are processed in sorted order so concurrent callers that share
  -- buckets always lock rows in the same order and cannot deadlock.
  -- A key that appears twice is checked once, against its lowest limit.
  for v_bucket in
    select b ->> 'key' as bucket_key, min((b ->> 'limit')::integer) as max_requests
    from jsonb_array_elements(p_buckets) as b
    group by b ->> 'key'
    order by b ->> 'key'
  loop
    if v_bucket.bucket_key is null or length(v_bucket.bucket_key) = 0 then
      raise exception 'bucket key is required';
    end if;

    if v_bucket.max_requests is null or v_bucket.max_requests < 1 then
      raise exception 'bucket limit must be at least 1';
    end if;

    -- Creates the row, or resets it when its window has ended (or when the
    -- configured window length changed). ON CONFLICT locks the row either way.
    insert into public.luna_rate_limits as r (bucket_key, window_start, request_count, updated_at)
    values (v_bucket.bucket_key, v_window_start, 0, v_now)
    on conflict (bucket_key) do update
      set window_start  = excluded.window_start,
          request_count = 0,
          updated_at    = v_now
      where r.window_start <> excluded.window_start;

    select r.request_count
      into v_count
      from public.luna_rate_limits as r
     where r.bucket_key = v_bucket.bucket_key
       for update;

    if v_count >= v_bucket.max_requests then
      v_allowed := false;
    end if;

    v_keys := v_keys || v_bucket.bucket_key;
  end loop;

  if v_allowed then
    update public.luna_rate_limits as r
       set request_count = r.request_count + 1,
           updated_at    = v_now
     where r.bucket_key = any (v_keys);
  end if;

  -- Opportunistic pruning keeps the table small without a scheduled job.
  if random() < 0.01 then
    delete from public.luna_rate_limits as r
     where r.window_start < v_now - interval '1 day';
  end if;

  return query
    select
      v_allowed,
      greatest(
        1,
        ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::integer
      );
end;
$$;

-- Only the Edge Function (service role) may consume capacity. Clients must
-- not be able to call this directly and spend or probe another caller's quota.
revoke all on function public.consume_luna_rate_limit(jsonb, integer) from public;
revoke all on function public.consume_luna_rate_limit(jsonb, integer) from anon, authenticated;
grant execute on function public.consume_luna_rate_limit(jsonb, integer) to service_role;
