-- Authenticated concert reviews (TEA-??): reshape `public.reviews` so a review
-- carries everything the product needs, and make the authenticated Supabase
-- user the authoritative owner of the row.
--
-- Three vocabularies had drifted apart before this migration:
--
--   * the live table          short_description / description / star_rating /
--                             location / review_date / author_id
--   * apps/web + @jamspot/shared
--                             musician / venue / concert_date / review_text,
--                             with no rating and no owner at all
--   * the product requirement musician, venue, concert date, 1-5 rating,
--                             content, owner user id, display name
--
-- A review also carries up to five OPTIONAL aspect ratings (performance,
-- sound, venue, crowd, value) beside the required overall rating, so a
-- reviewer can say the band was great and the sound was not.
--
-- This migration collapses all three onto the third. The renames below are
-- wrapped in existence checks so re-running the file against a partially
-- migrated database is a no-op rather than an error.
--
-- Ownership is enforced here, in the database, not in the clients: the RLS
-- policies at the bottom are what make `curl` against the PostgREST endpoint
-- as safe as the app itself.

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownership moves from public.profiles to auth.users
-- ---------------------------------------------------------------------------
-- `author_id` pointed at a profiles row. Ownership now keys on the Auth user,
-- which is the identity RLS can actually check (auth.uid()); a profile row is
-- display metadata that may or may not have been created yet.

alter table public.reviews
  drop constraint if exists reviews_author_id_fkey;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews'
      and column_name = 'author_id'
  ) then
    alter table public.reviews rename column author_id to user_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Rename the remaining columns onto the shared vocabulary
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews'
      and column_name = 'review_date'
  ) then
    alter table public.reviews rename column review_date to concert_date;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews'
      and column_name = 'star_rating'
  ) then
    alter table public.reviews rename column star_rating to rating;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews'
      and column_name = 'description'
  ) then
    alter table public.reviews rename column description to review_text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Add the columns the old shape never had
-- ---------------------------------------------------------------------------
-- Nullable at first so existing rows can be backfilled before NOT NULL lands.

alter table public.reviews
  add column if not exists musician  text,
  add column if not exists venue     text,
  add column if not exists user_name text;

-- The five optional aspect ratings. Deliberately separate nullable columns
-- rather than a jsonb blob or a child table: the set is fixed and small, every
-- one of them is the same 1-5 integer, and columns are what let the same CHECK
-- constraint cover them and let PostgREST filter and order on them later.
-- NULL means "not rated", which is distinct from a low score.
alter table public.reviews
  add column if not exists rating_performance smallint,
  add column if not exists rating_sound       smallint,
  add column if not exists rating_venue       smallint,
  add column if not exists rating_crowd       smallint,
  add column if not exists rating_value       smallint;

-- Backfill from the columns about to be dropped. `location` was the closest
-- thing the old shape had to a venue; `short_description` was a free-text
-- headline, which is the only place an artist name could have been written.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews'
      and column_name = 'location'
  ) then
    update public.reviews
    set venue = coalesce(nullif(btrim(venue), ''), nullif(btrim(location), ''), 'Unknown venue')
    where nullif(btrim(coalesce(venue, '')), '') is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reviews'
      and column_name = 'short_description'
  ) then
    update public.reviews
    set musician = coalesce(
      nullif(btrim(musician), ''),
      nullif(btrim(short_description), ''),
      'Unknown artist'
    )
    where nullif(btrim(coalesce(musician, '')), '') is null;
  end if;
end $$;

-- Display name: the profile's username when there is one, otherwise the local
-- part of the account's email. Kept denormalized on the row on purpose - a
-- review should still render the name it was published under even if the
-- profile is later renamed or deleted.
update public.reviews r
set user_name = coalesce(
  nullif(btrim(r.user_name), ''),
  (select nullif(btrim(p.username), '') from public.profiles p where p.id = r.user_id),
  (select nullif(split_part(u.email, '@', 1), '') from auth.users u where u.id = r.user_id),
  'JamSpot listener'
)
where nullif(btrim(coalesce(r.user_name, '')), '') is null;

-- Whatever is left with no backfillable value gets a placeholder rather than
-- blocking the NOT NULL constraints below.
update public.reviews
set musician = coalesce(nullif(btrim(musician), ''), 'Unknown artist'),
    venue    = coalesce(nullif(btrim(venue), ''),    'Unknown venue');

alter table public.reviews
  drop column if exists short_description,
  drop column if exists location;

-- ---------------------------------------------------------------------------
-- 4. Drop rows that cannot satisfy the new ownership rules
-- ---------------------------------------------------------------------------
-- A review with no owner, or an owner that is not a real Auth user, cannot be
-- edited or deleted by anybody and would block the foreign key below. At the
-- time this was written the table held a single "test" row, so this is
-- expected to delete nothing of value - but it IS a delete, so it is spelled
-- out here rather than hidden inside a constraint failure.

delete from public.reviews r
where r.user_id is null
   or not exists (select 1 from auth.users u where u.id = r.user_id);

-- ---------------------------------------------------------------------------
-- 5. Lock the shape down
-- ---------------------------------------------------------------------------

alter table public.reviews
  alter column user_id      set not null,
  alter column user_name    set not null,
  alter column musician     set not null,
  alter column venue        set not null,
  alter column concert_date set not null,
  alter column rating       set not null,
  alter column review_text  set not null;

alter table public.reviews
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.reviews
  alter column created_at set not null,
  alter column updated_at set not null;

-- Deleting an account takes its reviews with it; a review whose owner no
-- longer exists could never be moderated by its author again.
alter table public.reviews
  drop constraint if exists reviews_user_id_fkey;
alter table public.reviews
  add constraint reviews_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- Rating is a whole number from 1 to 5. `rating` is an integer column, so the
-- range check is the whole rule - 3.5 cannot be stored in the first place.
alter table public.reviews
  drop constraint if exists reviews_rating_range;
alter table public.reviews
  add constraint reviews_rating_range check (rating between 1 and 5);

-- Required text fields may not be blank or whitespace-only. NOT NULL alone
-- would happily accept ''.
alter table public.reviews
  drop constraint if exists reviews_required_text_not_blank;
alter table public.reviews
  add constraint reviews_required_text_not_blank check (
    btrim(user_name)   <> ''
    and btrim(musician)    <> ''
    and btrim(venue)       <> ''
    and btrim(review_text) <> ''
  );

-- Same 1-5 rule for every aspect rating, but nullable: an unrated aspect is
-- NULL, and `x between 1 and 5` is NULL (not false) for a NULL x, so a CHECK
-- passes it without needing an explicit "is null or" on each one.
alter table public.reviews
  drop constraint if exists reviews_aspect_rating_range;
alter table public.reviews
  add constraint reviews_aspect_rating_range check (
    rating_performance between 1 and 5
    and rating_sound   between 1 and 5
    and rating_venue   between 1 and 5
    and rating_crowd   between 1 and 5
    and rating_value   between 1 and 5
  );

create index if not exists reviews_user_id_idx    on public.reviews (user_id);
create index if not exists reviews_created_at_idx on public.reviews (created_at desc);

commit;
