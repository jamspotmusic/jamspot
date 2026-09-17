# Changelog

All notable changes to JamSpot are documented in this file.

## [Unreleased]

### Added

- Server-side rate limiting for Luna searches (TEA-52). The `concert-query` Edge Function now decides first whether a request needs Luna, rejecting invalid requests before the limiter, and only then checks the caller's capacity. It returns HTTP `429` (`rate_limit_error` / `luna_rate_limit_exceeded`) with `Retry-After` and never calls the LLM for a rejected request. Limits come from `LUNA_RATE_LIMIT_MAX_REQUESTS` / `LUNA_RATE_LIMIT_WINDOW_SECONDS` (default 20 per 60 s), plus an optional `LUNA_RATE_LIMIT_IP_MAX_REQUESTS`, and can be changed without a code change.
- `supabase/migrations/20260916120000_luna_rate_limits.sql`: the `luna_rate_limits` counter table (RLS on, no client access) and the `consume_luna_rate_limit` function. It counts a request against every bucket or none, in one transaction, and only `service_role` can execute it.
- Rate-limit identity: signed-in users are limited by the verified Supabase user ID from their JWT (the function now accepts `auth: ["user", "publishable"]`). Anonymous users are limited by a per-device `x-jamspot-session-id` combined with their IP address, and each IP address also has a shared ceiling, so a client that makes up new session IDs is still limited. Bucket keys are SHA-256 hashes.
- Structured logs for allowed, rejected and unavailable limiter checks, routing rejections, and direct Ticketmaster searches that bypass the limiter (`/api/concerts`, identified by the absence of `source=luna`).
- Deno tests for allowed, rejected, window-reset, pre-Luna bypass, failed-provider counting, fail-closed, identity and log-redaction behavior, plus web tests for the client side.

- Passwordless email-OTP authentication across both apps, against one shared Supabase project so the web and mobile clients have a single Auth user population. The user enters an email, `signInWithOtp` sends an 8-digit code, and `verifyOtp` with `type: "email"` exchanges it for a session — no passwords, no `signInWithPassword`, no reset flow. Sessions survive reload on web and app restart on mobile, and signing out clears the local session.
- Auth is optional and additive: concert search and reviews remain fully usable signed out, with no route guards, redirects, or middleware. The only new affordance is a header control — `AuthNav` on web, `AuthButton` opening a sheet on mobile.
- The framework-agnostic half of the flow — request, verify, sign out, email/code validation, and the user-facing wording for invalid email, failed send, invalid code, expired code, rate limiting, and network failure — in `@jamspot/shared`. It takes the client's `auth` object as a parameter rather than importing one, so no instantiated Supabase client is shared and the package stays free of browser-only and React-Native-only APIs.
- Separate Supabase clients per platform, because their session handling genuinely differs: `apps/web/lib/supabase-browser.ts` and `supabase-server.ts` use `@supabase/ssr` so cookies carry the session into Server Components, while `apps/mobile/src/lib/supabase.ts` persists to AsyncStorage with `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false`, and `AppState`-driven refresh start/stop. The deprecated `@supabase/auth-helpers-nextjs` packages are not used.
- `apps/web/.env.example` and `apps/mobile/.env.example`, and 21 unit tests covering the flow against a fake auth client so no test sends a real email.

### Fixed

- Luna on web now calls the Edge Function through the cookie-backed auth client, so a signed-in user's access token is actually sent. The plain client in `lib/supabase.ts` has no session, so it always sent the call anonymously.
- `concert-query` returned a 500 for a JSON body that wasn't an object (such as `null`). It now returns a 400.
- A stray `.env*` rule in `.gitignore` re-ignored `.env.example` after the earlier `!.env.example` whitelist, which would have made the new templates uncommittable. The negation is re-asserted after it rather than removing the rule.


## [0.5.0] - 2026-09-01

### Changed

- Swapped the mobile app's two tabs so its information architecture matches the web app's. Web's `/` is concert discovery and Reviews is the single secondary page its nav links to; mobile had the inverse, with reviews on the Home tab and concerts on Explore. `apps/mobile/src/app/index.tsx` is now the concert search and `apps/mobile/src/app/reviews.tsx` the reviews list, and the tab bar reads Home / Reviews.
- Pinned the mobile app to the dark theme instead of following the device's appearance setting, and set `userInterfaceStyle` to `dark` in `app.json`. The web app has no light/dark toggle - the dark violet palette in `apps/web/app/globals.css` is the only theme it ever renders - so following the system setting could only ever diverge from it.
- Rebuilt the mobile concert card and details modal against their web counterparts: the image gradient fade into the card body, the bordered genre badge, the dimmed cover image, the tinted "Get Tickets" button, and the modal's bordered `PRICE` / `ABOUT` / `LISTEN` sections with a pulsing bio placeholder in place of a "Loading bio…" line.
- Replaced the mobile streaming links' text pills with the branded artwork web uses: Apple's hosted, unmodified "Listen on Apple Music" badge and the black Spotify pill. The Spotify mark was extracted from the base64 PNG embedded in `apps/web/public/streaming/spotify-icon.svg` so React Native can render it without an SVG loader.
- Matched the mobile Reviews screen to apps/web/app/reviews-page/page.tsx's layout: the review body reserves seven lines the way web's `min-h-[7lh]` does, so a one-line review no longer collapses the card into a stub; card spacing, list padding, and the gap under the heading row follow web's `space-y-4` / `p-6` / `space-y-6`; the nav pill sits beside the wordmark rather than pushed to the far edge; the result count stays visible while loading; and the footer is gone, since web renders one on `/` only. Search also stops matching the review body, matching web, where a query only ever tests the event metadata.
- Rebuilt the mobile review card with the same four bands web's has - rating and date, a bordered event-info block, the clamped body with a Show more/less toggle, and a footer carrying the author and the two vote buttons. Votes are presentational on both clients, but where web seeds its counts from mock data, mobile's start at zero: the live `reviews` rows have no vote columns to read.
- Event metadata on mobile (dates, times, prices, genre chips, result counts) now renders in the platform monospace face, matching the `'DM Mono', monospace` web sets on the same text. Neither app loads DM Sans, DM Mono, or Unbounded as a webfont, so both fall back to platform defaults.
- Changed the mobile splash background from Expo blue to `#07070f`, the app background, so the splash hands off to the first screen without a colour flash.

### Added

- The hero state on the mobile Home tab: the same photograph, both gradient overlays, and the "Find your next Jam" headline web shows until the first search has been submitted.
- Skeleton cards on both mobile tabs while a search or the reviews list is loading, reproducing Tailwind's `animate-pulse`, in place of the spinner they showed before.
- The "Upcoming Shows" / genre-name results heading and the event count beside it on the mobile Home tab, and the matching "Reviews" heading and review count on the Reviews tab.
- "Show more" pagination on mobile - six cards, then six more per press - matching web's `initialLimit`/`itemsPerLoad`.
- Web's `completeCardEvents` filter on mobile, as `isCompleteCardEvent` in `apps/mobile/src/lib/concerts.ts`, so a partially populated Ticketmaster record is dropped rather than drawn as a card with holes in it.
- The footer from the bottom of web's landing page - dimmed brand mark and copyright line above a top border - on the mobile Home tab. Reviews doesn't get one, matching web, where `/reviews-page` renders header and main only.
- Genre pre-selection on mobile search, matching web: a query that names one of the genres already on screen lands on that genre's chip rather than on "All".

### Fixed

- The prod-preview deploy workflow built against a second, separate Vercel project (`VERCEL_PROJECT_ID_K7PZ`) rather than the one subprod uses, so the two aliases had independent environment-variable stores. `jamspot-k7pz.vercel.app` was serving a build whose `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` Supabase rejected, returning `502 Failed to fetch reviews: Invalid API key`, while subprod and the production domain were fine. Both workflows now resolve `VERCEL_PROJECT_ID` to the same project and pull the same `preview` environment scope.
- The mobile app required `npm run dev:web` to show anything at all. A dev build committed to `http://<your-machine>:3000` purely because Metro was attached, so working on the app without also running the web app produced "Could not reach the JamSpot API" on every screen. The local dev server is now a preference rather than a prerequisite: the app probes it once per session and falls through to the deployed API when nothing answers. The probe requires a JamSpot-shaped response - a success, or the app's own `{ error }` body - so an unrelated service holding port 3000 is ignored instead of being mistaken for the API.
- Release builds of the mobile app had no reachable backend. `getApiBaseUrl` fell back to `http://localhost:3000` whenever Metro's hostUri was absent, which is exactly the case in a TestFlight, Play, or standalone build - so a shipped app resolved to the handset it was running on, where nothing is listening, over a cleartext scheme iOS App Transport Security blocks anyway. `getApiBaseUrl` now takes the local dev server only in a `__DEV__` build with Metro attached and a dev server answering; everything else falls through to production at `https://www.jamspotmusic.app`, configurable per build via `extra.apiUrl` in `app.json`. `EXPO_PUBLIC_API_URL` still overrides everything, so preprod remains testable from both dev and release builds; `apps/mobile/README.md` documents the full resolution order.
- `/api/reviews` and `/api/concerts` failed on mobile whenever anything else already held port 3000. `npm run dev:web` ran a bare `next dev`, which silently falls back to the next free port, while the mobile client hardcodes `:3000` - so it kept querying whatever else was listening there and surfaced that service's 404 as a JamSpot error. The dev server now binds `${PORT:-3000}`, so it fails loudly on a busy port instead of drifting, and honours `PORT` when you do want it somewhere else (pair it with `EXPO_PUBLIC_API_URL` on the mobile side).
- Mobile API errors now name the full URL rather than just the path, so a response from something that isn't the JamSpot API is identifiable from the message alone, and the "Is `npm run dev:web` running?" hint is limited to the case where the app is actually pointed at a local dev server.
- The review card's invisible line-measuring copy of the body text was announced by screen readers on the Expo web build, so every review was read out twice. It carried `accessibilityElementsHidden` and `importantForAccessibility`, neither of which react-native-web maps to anything; it now also carries `aria-hidden`.
- The mobile Spotify pill and "Get Tickets" button rendered unstyled. `ExternalLink` wraps an expo-router `Link`, and cloning the child with `asChild` drops that child's own `style` prop; both now carry their styling on an inner `View` the clone can't reach.
- The mobile concert search showed "No shows found. Try a different search." whenever matches existed but none of them passed the completeness filter. Web keys that message off the filtered count and renders an empty grid in that case, which mobile now does too.
- Replaced the leftover Expo starter branding in the Expo web build's nav bar ("Expo Starter" and a link to the Expo docs) with the JamSpot mark and the app's own two destinations, and moved the bar into the layout flow so screen content no longer renders underneath it.

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