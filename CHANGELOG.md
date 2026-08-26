# Changelog

All notable changes to JamSpot are documented in this file.

## [Unreleased]

## [0.4.0] - 2026-08-25

### Added

- Unconditional geolocation in the `concert-query` Edge Function whenever a query names no place. The model now reports only the location the user actually said out loud; leaving those fields null is how it asks for the caller to be located. "Radiohead tickets" searches near the caller just as "chill concert under $60" does - naming an artist is not naming a place.
- Resolution of the caller's location in the Edge Function rather than the model, in descending order of trust: device coordinates the caller sends in `location`, then a city/state/ZIP the caller already had, then the edge network's approximate geo headers (Vercel- and Cloudflare-style). When none of those can locate the caller the function returns a 422 with `code: "location_required"` so the client can ask for permission and retry, instead of picking a city on the user's behalf.
- A `geolocationDenied` request flag for clients that asked the device for a location and didn't get one - permission refused, geolocation unsupported, or timed out. The Edge Function then widens to a nationwide search (`locationSource: "nationwide"`) rather than asking again, so declining location is never a dead end. Only the client knows whether it has asked yet, which is why the flag comes from there rather than being inferred. A nationwide search still needs an artist or a genre to match on; "concerts tonight" with no location and no anchor is refused with `code: "anchor_required"`.
- Mood-to-genre mapping for vague queries. The model returns up to three genres constrained to Ticketmaster's Music segment ("chill" -> Jazz, Folk, Alternative), which become a comma-separated `classificationName`; Ticketmaster ORs them, so a mood searches the union of its genres. Free-text `keyword` is now reserved for something the user actually named, since Ticketmaster matches it literally and "chill" would match nothing.
- Price, radius, and sort extraction. "under $60" sets `maxPrice`; Ticketmaster's events endpoint has no price parameter, so the ceiling comes back as a separate `filters` object and `searchConcerts` applies it to the events it gets, keeping any event whose published range overlaps the request and any event with no published range at all.
- A one-sentence `interpretation` of the search in the response, and `locationSource` in `meta`, so the UI can say what it searched and which of the five sources located it.
- Geolocated searches are sent to Ticketmaster as `geoPoint` - a geohash of the caller's coordinates - rather than the older `latlong` parameter, which the Discovery API documents as "deprecated and maybe removed in a future release, please use geoPoint instead". The Edge Function encodes the coordinates itself at nine characters of precision (a cell of roughly five metres); `radius` is what actually sets the search area.
- `geoPoint`, `radius`, `unit`, `countryCode`, `sort`, `minPrice`, and `maxPrice` support in `lib/ticketmaster.ts` and `/api/concerts`, so the Edge Function's output can be handed straight to the route. `geoPoint`, `countryCode`, and `classificationName` now count as search anchors there, the last so a nationwide genre search isn't rejected.
- `npm run test:functions` for the Edge Function's Deno test suite.

### Changed

- A `concert-query` search is located unless the caller has explicitly declined to share a location. The model no longer decides between a local and a national search - naming an artist is not naming a place, so "Radiohead tickets" geolocates like anything else, and only a refusal widens it.
- `/test-concert-query` now asks the browser for coordinates only when the Edge Function says it needs them, then retries - with the coordinates if it got them, or with `geolocationDenied` if it didn't - so a query naming a city never triggers a permission prompt and a refused prompt still returns results. It displays the interpretation, the price filter, and which of the five sources located the search.
- Raised the Edge Function's reasoning effort from `none` to `low` and its output cap from 300 to 700 tokens, since mapping a mood onto genres and a price ceiling is inference rather than pure extraction.
- Updated the Expo mobile app's `@expo/ui`, `expo-dev-client`, `expo-image`, `expo-linking`, and `expo-router` dependencies to their latest SDK 57 patch releases, and registered the `expo-image` config plugin in `app.json`.

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