# Changelog

All notable changes to JamSpot are documented in this file.

## [Unreleased]

## [0.3.0] - 2026-08-24

### Added

- Natural-language concert search backed by a new Supabase Edge Function, `concert-query`, which turns a request like "jazz in Oakland this weekend" into Ticketmaster Discovery API search parameters (`city`, `stateCode`, `postalCode`, `keyword`, `startDateTime`, `endDateTime`).
- OpenAI Responses API call to the `gpt-5.6-luna` model from the Edge Function, using strict JSON-schema structured output, `reasoning: { effort: "none" }` (parameter extraction, not a reasoning task), `store: false`, and a 300-token output cap. The model receives only the query, the current UTC timestamp, and the caller's IANA time zone.
- Prompt rules that keep the model from inventing data: it never guesses or geolocates a city, state, or ZIP code, never infers location from the supplied time zone, never claims an artist is touring or that a concert exists, and returns null for anything the user did not supply. The time zone is used solely to resolve relative dates such as "tonight" or "next weekend".
- Server-side normalization and validation of the model's output - trimmed strings, two-letter uppercase state codes, ISO-8601 UTC timestamps with milliseconds stripped, and a start-before-end date check. A query with no artist, genre, venue, event, city, state, or ZIP code is rejected with a 422, matching the existing validation in `apps/web/app/api/concerts/route.ts`.
- Request validation and error handling in the Edge Function: POST-only (405 with an `Allow` header), JSON body required (400), non-empty query of 500 characters or fewer (400), and a 502 for any OpenAI failure, with the OpenAI `x-request-id` logged server-side and never surfaced to the client.
- Supabase local development config (`supabase/config.toml`) and `supabase/functions/.env.example` documenting the `OPENAI_API_KEY` the function requires.
- `/test-concert-query` page in the web app for exercising the flow end to end: it invokes the Edge Function through `supabase.functions.invoke`, shows the extracted Ticketmaster parameters and response metadata, indicates whether a location was actually supplied, and can run the resulting search against JamSpot's `/api/concerts` route.

### Changed

- Raised the default Ticketmaster cache TTL from 5 minutes to 30 minutes (still configurable via `TICKETMASTER_CACHE_TTL_SECONDS`).

## [0.2.0] - 2026-08-09

### Added

- Caching for external API search results (Ticketmaster, Last.fm, Spotify, Apple Music) via Next.js's built-in fetch/Data Cache, with a configurable default TTL (24h for artist data, 5min for Ticketmaster listings). No external database - `next: { revalidate }` is set on every provider fetch, and search values are normalized (trimmed + lowercased) before building the request so equivalent searches share one cache entry. (TEA-30)
- Converted the repo into an npm-workspaces monorepo with `apps/web` (the existing Next.js app), `apps/mobile` (a new Expo/React Native app for iOS and Android), and `packages/shared` (TypeScript types shared between the two apps).
- Scaffolded the Expo mobile app (managed workflow) with tab navigation, themed components, and concert/review views backed by the shared API client.

### Changed

- Moved the Next.js app's source, tests, and config into `apps/web`; the local env file now lives at `apps/web/.env.local`.
- Replaced root-level `dev`/`build`/`test`/etc. scripts with workspace-delegating scripts (`dev:web`, `dev:mobile`, `dev:ios`, `dev:android`, `build:web`, `start:web`, `test:web`, `coverage:web`), plus workspace-wide `lint` and `test`.
- Scoped the subprod and production-preview GitHub Actions workflows to `apps/web` (path filters, working directory, and coverage artifact path).
- Updated README with the monorepo layout and revised setup/troubleshooting instructions.

## [0.1.0] - 2026-08-05

### Added

- UI unit tests for concert formatting, filtering, cards, modal states, streaming links, search handlers, pagination, and data-loading failures.
- Native V8 coverage reporting with enforced 70% line, branch, and function thresholds.
- Text and HTML coverage report generation through `npm run test:ui:coverage`.
- UI test and coverage gates for both subprod and production-preview GitHub Actions workflows.
- Coverage report artifacts retained for 14 days on every deployment workflow run.

### Changed

- Extracted the concert filtering logic into an exported function so it can be tested directly.
- Added an accessible label and explicit button type to the concert-details close control.
- Subprod and production-preview deployments now run only after the UI test job passes.
- Added stable concurrency groups so newer pull-request runs cancel superseded deployments.