-- Ownership, server-controlled timestamps, and Row Level Security for
-- public.reviews.
--
-- Everything in this file exists so that the rules hold for a raw request to
-- the PostgREST endpoint, not just for a request that went through the
-- Next.js API routes. The clients hide the edit and delete buttons on someone
-- else's review; this is what makes hiding them a UX nicety rather than the
-- actual access control.

begin;

-- ---------------------------------------------------------------------------
-- Write-time rules that a CHECK constraint cannot express
-- ---------------------------------------------------------------------------
-- Three rules live here rather than in constraints:
--
--   * `updated_at` / `created_at` must be decided by the server, so a client
--     cannot backdate a review or leave `updated_at` stale after an edit.
--   * the concert date must not be in the future, which depends on `now()` and
--     so is not immutable.
--   * `user_id` must never change. The UPDATE policy below already refuses to
--     hand a row to a *different* user, but a trigger states the rule
--     outright and fails with a message that says what happened.

create or replace function public.reviews_enforce_write_rules()
returns trigger
language plpgsql
-- Not SECURITY DEFINER: this needs no privilege the writer lacks. The empty
-- search_path is Supabase's linting guidance; only pg_catalog builtins are
-- referenced below, and pg_catalog is always on the path.
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A review''s owner cannot be changed'
        using errcode = 'check_violation';
    end if;
    new.created_at = old.created_at;
  else
    new.created_at = now();
  end if;

  new.updated_at = now();

  -- Calendar-date comparison, not a timestamp one, so a concert that happens
  -- today is reviewable the same day rather than only after it ends. Pinned to
  -- UTC rather than `current_date` so the rule cannot shift with whatever
  -- TimeZone a connection happens to be running under; the API layer compares
  -- against the same UTC day.
  if new.concert_date > (now() at time zone 'utc')::date then
    raise exception
      'concert_date % is in the future; only concerts that have already happened can be reviewed',
      new.concert_date
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists reviews_enforce_write_rules on public.reviews;
create trigger reviews_enforce_write_rules
  before insert or update on public.reviews
  for each row execute function public.reviews_enforce_write_rules();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.reviews enable row level security;
-- Table owners bypass RLS by default, which would quietly exempt any future
-- server-side job running as the owning role.
alter table public.reviews force row level security;

drop policy if exists "Reviews are viewable by everyone"   on public.reviews;
drop policy if exists "Users can insert their own reviews" on public.reviews;
drop policy if exists "Users can update their own reviews" on public.reviews;
drop policy if exists "Users can delete their own reviews" on public.reviews;

-- Reading stays open to anonymous visitors: browsing reviews without an
-- account is an existing product behaviour, and only writes are gated.
create policy "Reviews are viewable by everyone"
  on public.reviews
  for select
  using (true);

-- `with check` is evaluated against the row being written, so a client that
-- puts somebody else's id in `user_id` is refused here - which is what makes
-- "you cannot post as another user" true at the database rather than being a
-- promise the API route makes. For an anonymous request auth.uid() is NULL,
-- `NULL = user_id` is NULL, and the policy does not pass.
create policy "Users can insert their own reviews"
  on public.reviews
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- `using` decides which rows are visible to the UPDATE (you can only target
-- your own), `with check` decides what the result may look like (it must still
-- be yours afterwards). Both are required: `using` alone would let an owner
-- reassign their review to someone else.
create policy "Users can update their own reviews"
  on public.reviews
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own reviews"
  on public.reviews
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- RLS narrows what a role may touch; it does not grant access in the first
-- place. Spelled out because supabase/config.toml turns off auto-exposing new
-- entities to the Data API roles.
grant select                 on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;

commit;
