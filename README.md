# JamSpot

**JamSpot** is a local concert discovery application that recommends live music events based on a user's location, date range, music preferences, mood, and favorite artists.

> Find your next live show.

## About the Project

Finding concerts is easy when you already know exactly who you want to see. JamSpot is designed for the other situation: when you want to go to a show but need help discovering what is happening nearby.

Users provide preferences such as:

* Location
* Date range
* Music genre
* Mood
* Favorite artists

JamSpot uses those preferences to find and rank relevant local concerts.

The MVP will use Supabase for preference storage and the Ticketmaster Discovery API for concert data.

## Tech Stack

| Technology                 | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| Next.js                    | Web application framework                     |
| React                      | User interface                                |
| TypeScript                 | Application language                          |
| Tailwind CSS               | Styling                                       |
| Supabase                   | Backend platform                              |
| PostgreSQL                 | Database                                      |
| Ticketmaster Discovery API | Concert and event data                        |
| Vercel                     | Hosting and deployment (web)                  |
| Expo / React Native        | Mobile application (iOS/Android), in progress |
| npm workspaces             | Monorepo tooling                              |

Possible future integrations:

* Claude API for natural-language preference input
* Last.fm API for artist and music recommendations
* Google authentication

## Monorepo Layout

JamSpot is an npm-workspaces monorepo:

* `apps/web` — the Next.js web app described throughout this README.
* `apps/mobile` — the Expo/React Native app for iOS and Android (managed workflow, in progress).
* `packages/shared` — TypeScript types shared between `apps/web` and `apps/mobile` for the normalized API response shapes.

Run `npm install` once from the repo root to install every workspace's dependencies. Root-level
convenience scripts delegate to the relevant workspace, e.g. `npm run dev:web`, `npm run
dev:mobile`, `npm run build:web`, `npm run test:web`, `npm run test:e2e`, `npm run lint`. Each
app's own scripts still work unchanged when run with that app as the working directory (e.g. `cd
apps/web && npm run dev`).

## Current Project Status

Current foundation work:

* [x] GitHub repository created
* [x] Local project connected to GitHub
* [x] Next.js application initialized
* [x] Node.js 24 development environment configured
* [x] Supabase project created
* [x] Supabase JavaScript client installed
* [x] Local environment variables configured
* [x] Next.js-to-Supabase database connection tested
* [ ] Vercel deployment completed
* [ ] User preferences schema finalized
* [ ] Preferences page implemented
* [ ] Ticketmaster API integrated
* [ ] Recommendation logic implemented
* [ ] Concert recommendation UI implemented
* [x] UI unit tests and coverage reporting added
* [ ] MVP testing completed
* [x] Repo converted to an npm-workspaces monorepo (apps/web, apps/mobile, packages/shared)
* [x] Expo mobile app scaffolded (managed workflow)
* [ ] Mobile app UI implemented
* [ ] Mobile CI / EAS Build pipeline set up

---

## Planned Application Pages

JamSpot's MVP has two primary pages.

### Home Page

Route:

```text
/
```

The Home page will be the first page users see.

It will:

* Load saved preferences
* Fetch matching concerts
* Rank concert recommendations
* Display concert cards
* Show the currently active preferences
* Handle loading states
* Handle empty results
* Handle API and database errors

### Preferences Page

Route:

```text
/preferences
```

Users will enter:

* Location
* Genre
* Mood
* Favorite artist or artists
* Start date
* End date

Required MVP fields:

* Location
* Genre
* Start date
* End date

---

## Prerequisites

Before running JamSpot locally, install:

* Git
* NVM
* Node.js 24
* npm

Check whether NVM is installed:

```bash
nvm --version
```

Install Node.js 24:

```bash
nvm install 24
```

Use Node.js 24:

```bash
nvm use 24
```

Confirm the active version:

```bash
node --version
```

The output should begin with:

```text
v24.
```

### Recommended `.nvmrc`

Create a file named:

```text
.nvmrc
```

with:

```text
24
```

Team members can then switch to the correct Node.js version with:

```bash
nvm use
```

If Node.js 24 has not been installed yet:

```bash
nvm install
nvm use
```

---

## Local Development Setup

### 1. Clone the Repository

```bash
git clone <REPOSITORY_URL>
```

Enter the project directory:

```bash
cd jamspot
```

### 2. Use the Project Node Version

```bash
nvm use
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Create the Environment File

Create:

```text
apps/web/.env.local
```

Add:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Add the values from the JamSpot Supabase project.

The project currently only requires these two environment variables.

Future integrations may add:

```env
TICKETMASTER_API_KEY=
ANTHROPIC_API_KEY=
LASTFM_API_KEY=
```

These variables are not required until the corresponding integrations are implemented.

One more is optional but matters in deployed environments:

```env
NEXT_PUBLIC_SITE_URL=https://jamspot-three.vercel.app
```

It is the public origin the discovery pages build canonical URLs, Open Graph
tags, the sitemap, and JSON-LD from. It must be the **public** domain — a
canonical pointing at a preview deployment tells crawlers the preview is the
real page. It defaults to the production deployment when unset, so local
development needs nothing.

`apps/web/.env.example` is the authoritative list.

### 5. Confirm `.env.local` Is Ignored

Run:

```bash
git check-ignore apps/web/.env.local
```

Expected output:

```text
apps/web/.env.local
```

Also check:

```bash
git status
```

`apps/web/.env.local` should not appear as an untracked or staged file.

Never commit real API credentials or environment files containing credentials.

### 6. Start the Development Server

From the repo root:

```bash
npm run dev:web
```

Or from `apps/web`:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Supabase Setup

JamSpot currently connects to Supabase using:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

The application uses the Supabase JavaScript client:

```bash
npm install @supabase/supabase-js
```

A simple client configuration can be created in:

```text
lib/supabase.ts
```

Example:

```ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabasePublishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
);
```

## Supabase Connection Test

During initial setup, JamSpot uses a temporary connection-test page:

```text
/test-db
```

Start the application:

```bash
npm run dev
```

Then visit:

```text
http://localhost:3000/test-db
```

The current connection flow is:

```text
Next.js
    ↓
Environment Variables
    ↓
Supabase JavaScript Client
    ↓
Supabase Data API
    ↓
PostgreSQL
```

The temporary connection-test route and database table should be removed after the real preferences database flow is implemented and verified.

---

## Authentication (passwordless email OTP)

Both apps sign in against the **same Supabase project**, so they share one Auth
user population: an account created by emailing a code on the phone signs in on
the web with the same address, and vice versa.

Authentication is **optional**. Concert search and reviews are fully usable
signed out — there are no route guards, no redirects, and no middleware. Signing
in only adds a header affordance ("Sign in" on web, a Sign in button on mobile).

### How the flow works

There are no passwords anywhere in the system. `signInWithPassword`, password
signup, and password reset are deliberately not implemented.

1. The user enters an email address.
2. The app calls `supabase.auth.signInWithOtp({ email })`.
3. The UI moves to a code-entry step.
4. The user types the 8-digit code from the email.
5. The app calls `supabase.auth.verifyOtp({ email, token, type: "email" })`.
6. A successful verification creates a Supabase session.
7. The session persists — across reload on web, across app restart on mobile.
8. Signing out clears the local session and returns the UI to signed out.

The same address is signed up on first use and signed in thereafter, so there is
no separate registration screen.

### Where the code lives

| Concern | Location |
| --- | --- |
| Flow, validation, error wording | `packages/shared/src/index.ts` |
| Web browser client (cookies) | `apps/web/lib/supabase-browser.ts` |
| Web server client (Server Components) | `apps/web/lib/supabase-server.ts` |
| Web auth state | `apps/web/components/AuthProvider.tsx` |
| Web UI | `apps/web/components/SignInForm.tsx`, `SignInPanel.tsx`, `AuthNav.tsx`, `app/sign-in/page.tsx` |
| Mobile client (AsyncStorage) | `apps/mobile/src/lib/supabase.ts` |
| Mobile auth state | `apps/mobile/src/hooks/use-auth.tsx` |
| Mobile UI | `apps/mobile/src/components/auth-modal.tsx`, `auth-button.tsx` |

The two apps deliberately have **separate client implementations** because their
session handling differs: web writes the session to cookies via `@supabase/ssr`
so Server Components can read it, while React Native has no cookie jar and
persists to AsyncStorage instead. What *is* shared is the framework-agnostic
part — the OTP flow, input validation, and user-facing error messages — which
lives in `@jamspot/shared` and takes the client's `auth` object as a parameter
rather than importing one. No instantiated Supabase client is shared.

### Environment variables

Web (`apps/web/.env.local`, template at `apps/web/.env.example`):

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Mobile (`apps/mobile/.env`, template at `apps/mobile/.env.example`):

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Point both at the same project. Values come from the Supabase dashboard under
**Project Settings → Data API**.

Only the project URL and the publishable (anon) key belong in either app.
`NEXT_PUBLIC_*` is inlined into the browser bundle and `EXPO_PUBLIC_*` is
embedded in the app binary, so both are readable by anyone. A service-role key,
database password, or JWT secret must never appear in either. Client-side checks
are for UX only — **Row Level Security is what actually protects data**, and it
governs these clients exactly as it governs an anonymous one.

### Dependencies this added

| Package | Workspace | Why |
| --- | --- | --- |
| `@supabase/ssr` | `apps/web` | Cookie-based sessions readable by Next.js Server Components. Replaces the deprecated `@supabase/auth-helpers-nextjs`, which is not used. |
| `@supabase/supabase-js` | `apps/mobile` | The mobile app previously reached the API only over `fetch` and had no Supabase client. |
| `@react-native-async-storage/async-storage` | `apps/mobile` | Session persistence across app restarts. No storage dependency existed in the repo; this is Supabase's recommended React Native option, installed via `npx expo install` for an SDK-compatible version. |

### Running the auth tests

```bash
npm run test:web
```

The OTP flow is tested against a fake `auth` object, so no test sends a real
email or touches the network. See `apps/web/tests/unit/auth.test.ts`.

---

## Search (one field)

Both apps have exactly **one search input**. The keyword field and the separate
city/state field are gone — a single line of natural language covers everything
they did, and everything they could not.

```text
chill jazz under $60 this weekend
Radiohead
something loud tonight
Texas
```

### What happens to a query

`resolveConcertSearch` in `packages/shared/src/index.ts` decides which of three
things a query is, before anything is spent on it:

| Input | Path | Why |
| --- | --- | --- |
| A bare state — `TX`, `Texas`, `Washington DC` | **Straight to Ticketmaster** as `stateCode` | There is no natural language in it to interpret. Sending it to the model would add a round trip and a token spend to produce a parameter already sitting in the input. |
| Anything else | **Luna** (`concert-query` Edge Function), then Ticketmaster | Needs a model to turn words into a keyword, genres, a date range, a price ceiling, and a place. |
| Blank, over 500 characters, or punctuation with no word in it | **Refused in the field** | Cannot be a search whatever it means, so no request is sent. |

The state match is against the **whole** query, not a substring: `Texas` is a
search for shows in Texas, but `Texas Hippie Coalition` is a band and
`shows in Texas next month` carries a date, so both go to Luna. A query of
exactly `OR`, `IN`, or `OK` is read as Oregon, Indiana, and Oklahoma —
on a field whose entire content is those two letters, that is the reading that
returns results.

Whichever path runs, the output is a query string for `/api/concerts` — the
same route, the same response shape, and the same card grid for all three.

### Validating what comes back

The Edge Function does not trust the model's output. OpenAI's strict JSON
schema constrains it upstream, but a schema change, a model swap, a truncated
response, or a proxy in between all arrive as ordinary JSON that `JSON.parse`
accepts. So `handler.ts` validates in two layers:

1. **Shape** — a **Zod** schema (`modelOutputSchema`) checks every field is
   present and of the right type. Unknown keys are stripped rather than
   rejected, so a field the model adds does not fail an otherwise good search.
2. **Values** — the normalizers coerce each value into something Ticketmaster
   accepts (`"ca"` → `"CA"`, `24.6` miles → `25`) or throw. A state name where
   a state code belongs is plausible output that would return zero events, so
   it is rejected rather than passed on.

A third Zod schema, `ticketmasterParamsSchema`, is the last gate before the
parameters leave. It rejects values Ticketmaster would not honour, and makes
two things true by construction rather than by the good behaviour of the code
above it:

* **`classificationName` is required and must be music** — `"music"` itself or
  a subset of Ticketmaster's music genres. Ticketmaster's catalogue is much
  wider than music, and this is what keeps a JamSpot search inside the part of
  it the app is about. A request for a sports fixture or a play cannot leave
  the function even if the model builds one.
* **A bare `"music"` classification is not a search on its own.** Without a
  genre, a keyword, or a place beside it, that asks Ticketmaster for every
  event it has.

Anything that fails is a `502` with `"Unable to interpret concert query"`. The
detail goes to the log, never to the client.

### Scope

A request is checked to be a live-music search **before** any of it reaches
Ticketmaster. There are two gates:

* **In the client**, structurally: blank, over-long, or wordless input is
  refused without a network call.
* **In the model**, semantically: the output schema carries `inScope` and
  `rejection`. Out of scope covers more than off-topic chatter — it includes
  **the non-music events Ticketmaster does sell**. `Lakers game tickets`,
  `Hamilton on Broadway`, and `comedy show tonight` are all refused, as are
  questions, requests for advice, anything about an existing order, and text
  written at the model rather than at the search. The function answers `422`
  with `code: "out_of_scope"` — no location resolved, no parameters built,
  nothing the model extracted echoed back. Both apps show that sentence under
  the field, and the hero stays where it is rather than switching to an empty
  results view.
* **When the model cannot tell**, `inScope` is false. Refusing a search
  somebody meant costs them one retry; running one they did not mean returns
  concerts to a person who asked about something else.

The second gate has to be the model's: no pattern can tell
`something loud tonight` from `what's the weather tonight`.

A refusal is not the only thing standing between a non-music request and
Ticketmaster. `classificationName` is *always* music (see above), so even a
request the model wrongly lets through is searched against music events only —
the model deciding is what makes it a clear refusal rather than an empty grid.

A bare state skips the second gate, correctly — a state is a search parameter,
not a question.

### Where the code lives

| Concern | Location |
| --- | --- |
| State list, bypass rule, scope refusals, search resolution | `packages/shared/src/index.ts` |
| Model prompt, Zod validation, scope gate, location resolution | `supabase/functions/concert-query/handler.ts` |
| Web field | `apps/web/components/LunaSearch.tsx` |
| Mobile field | `apps/mobile/src/components/luna-search.tsx` |
| Ticketmaster request | `apps/web/app/api/concerts/route.ts`, `apps/web/lib/ticketmaster.ts` |

On web the field sits in the middle of the hero until the first search and in
the header afterwards, so it stays reachable above the results. Only one is
mounted at a time and the query is held by the page, so the text survives the
move.

### Running the search tests

```bash
npm run test:web        # the shared resolver, the field, and the page
npm run test:functions  # the Edge Function, including Zod and scope
npm run test:e2e        # the whole flow in a browser, with both paths mocked
```

No test reaches OpenAI, Supabase, or Ticketmaster.

---

## Discovery pages (SEO)

The search field is a fine way in **if you already have JamSpot open**. Someone
arriving from a search engine does not, so JamSpot also publishes pages that
answer a question by existing at a URL:

```text
/concerts/san-diego           Concerts in San Diego
/concerts/san-diego/indie     Indie concerts in San Diego
/artists/the-national         One act's upcoming dates
/venues/belly-up-tavern       One room's schedule
```

Every one of them is server-rendered with the events already in the HTML, using
the same `EventCard` grid and the same concert modal as a search. A crawler that
executes no JavaScript sees the whole listing, and the ticket CTA still opens
the same Ticketmaster URL it always did.

### What decides that a URL exists

Cities and genres come from curated registries in
`apps/web/lib/discovery/taxonomy.ts` — 43 US markets, 17 genres. This is the
load-bearing decision in the whole feature. Without a registry,
`/concerts/<anything>` would be an open proxy onto the Ticketmaster Discovery
API: unbounded requests against our rate limit, and an unbounded set of thin,
near-identical pages for crawlers to find. An unresolvable slug is a **404**,
and it costs no Ticketmaster request to say so.

Artists and venues cannot work that way — there are hundreds of thousands of
them and the set changes daily — so they are resolved against Ticketmaster on
strict terms: the slug is searched as a keyword, a candidate counts only if its
own name slugifies back to the requested slug, and identity from then on is the
**Ticketmaster attraction/venue id**. That is what stops `/artists/the-national`
from becoming a page about the Tom Petty tribute act a keyword search also
returns, and what keeps "Belly Up Aspen" and "Belly Up Tavern" two rooms.

### One URL per page

`apps/web/proxy.ts` normalizes casing and formatting before the request reaches
a route:

```text
/concerts/San-Diego     ─┐
/concerts/SAN-DIEGO      ├─ 308 ─→  /concerts/san-diego
/concerts/san--diego     │
/concerts/san%20diego   ─┘
```

It has to happen in the proxy rather than in the page. These routes are
incrementally regenerated, and a `redirect()` thrown during regeneration is
cached as that path's own prerender — which produced a 307 that had lost its
`Location` header. Normalizing first means only canonical paths are ever
rendered or stored.

Where Ticketmaster spells one entity two ways — it embeds a Milwaukee room in
events as "The Rave/Eagles Club" while its venues endpoint calls the same room
"Eagles Club/The Rave/Eagles Ballroom" — the alternate renders at 200 and points
`<link rel="canonical">` at the entity's own URL, rather than redirecting.

### What gets indexed

A page earns indexing by answering the question its URL asks. It gets
`noindex, follow` when it has no upcoming events, and when Ticketmaster could
not be reached — an outage must not be published as a durable "nothing on here".
`follow` stays on either way, so a quiet page is still a route through to the
ones with shows.

`Event` structured data carries only what Ticketmaster supplied. There is no
`eventStatus`, no `eventAttendanceMode`, no `offers.availability` — a published
price range says what tickets cost, not whether any are left — no street address
for a venue we only have a city for, and no start time dressed up with a
timezone Ticketmaster never gave.

### The sitemap

`/sitemap.xml` is derived from one pass of real data, not from arithmetic:

```text
1 request per registered city          →  43 requests
city listed only if it returned events
its genre pages read out of that same response  →  0 extra requests
top artists/venues resolved through their own route helpers
```

That yields the ~460 city/genre combinations that actually have shows rather
than all 731, and every artist and venue URL in the file has been confirmed to
resolve. Roughly one slug in twenty guessed from an event's embedded name does
*not* resolve against the attractions/venues search endpoints, and those are
dropped rather than listed broken.

### Analytics attribution

`apps/web/lib/analytics/discovery-attribution.ts` carries a surface
(`seo_city`, `seo_city_genre`, `seo_artist`, `seo_venue`) from the server-rendered
route through the card and the detail modal onto the ticket click, so the
journey from Google to Ticketmaster stays identifiable once TEA-54 lands.

No analytics provider is wired up — TEA-54 owns that choice — so the default
sink drops everything and integration is one `setAnalyticsSink` call. Nothing is
appended to the Ticketmaster URL: affiliate and tracking parameters are out of
scope until an affiliate agreement exists, so attribution is recorded on our
side only.

### Running the discovery tests

```bash
npm run test:web        # 97 tests across routing, slugs, canonicals,
                        # metadata, indexability, entity identity,
                        # structured data, and the sitemap
```

No test reaches Ticketmaster.

---

## Environment Variable Strategy

JamSpot currently uses three separate environments.

### Local Development

Environment variables are stored in:

```text
.env.local
```

Current variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

### GitHub

GitHub Actions runs UI tests with coverage before either deployment workflow can continue. The repository requires these Actions secrets for Vercel deployment:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
VERCEL_PROJECT_ID_K7PZ
```

`VERCEL_PROJECT_ID` targets the subprod project. `VERCEL_PROJECT_ID_K7PZ` targets the production-preview project. Application runtime variables remain in Vercel rather than GitHub.

### Vercel

The following variables must be configured in the Vercel project:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Recommended environments:

```text
Production
Preview
Development
```

The current configuration should be:

```text
Local
└── .env.local

GitHub
└── Source code only

Vercel
├── NEXT_PUBLIC_SUPABASE_URL
└── NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

---

## Vercel Deployment

### 1. Open a Pull Request

Before opening a pull request, run the same UI quality gate used by GitHub Actions:

```bash
nvm use
npm ci
npm run coverage
```

Open pull requests against:

```text
main → subprod deployment
prod → production-preview deployment
```

Each deployment job depends on the `UI unit tests` job. A failed test or coverage threshold prevents the Vercel build, deployment, and alias steps from running. Do not commit `.env.local`.

### 2. Import JamSpot into Vercel

In the Vercel dashboard:

```text
Add New
→ Project
→ Import jamspot
```

For a standard project with `package.json` at the repository root:

```text
Framework Preset: Next.js
Root Directory: ./
```

Leave the detected Next.js build settings at their defaults unless the project structure changes.

### 3. Add Environment Variables

In the Vercel JamSpot project:

```text
Settings
→ Environment Variables
```

Add:

```text
NEXT_PUBLIC_SUPABASE_URL
```

and:

```text
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Use the values from the JamSpot Supabase project.

Assign them to:

```text
Production
Preview
Development
```

### 4. Deploy

Deploy the project.

After deployment, test:

```text
/
```

and, while the connection-test route still exists:

```text
/test-db
```

Verify that:

* The application loads
* Supabase queries work
* No environment variable errors occur
* No private credentials are displayed

---

## Git and Collaboration Workflow

Do not develop features directly on `main`.

Start from an updated `main` branch:

```bash
git checkout main
git pull origin main
```

Create a feature branch:

```bash
git checkout -b feature/preferences-form
```

Make changes, then review them:

```bash
git status
```

Commit:

```bash
git add .
git commit -m "Add preferences form"
```

Push:

```bash
git push -u origin feature/preferences-form
```

Then open a pull request into:

```text
main
```

Recommended branch prefixes:

```text
feature/
fix/
refactor/
test/
docs/
```

Examples:

```text
feature/preferences-form
feature/ticketmaster-search
feature/concert-cards
fix/date-range-validation
fix/supabase-query-error
refactor/recommendation-ranking
docs/update-readme
```

With Vercel connected to GitHub, the intended workflow is:

```text
Feature Branch
      ↓
Push to GitHub
      ↓
Vercel Preview Deployment
      ↓
Pull Request Review
      ↓
Merge to main
      ↓
Production Deployment
```

---

## MVP Data Model

The MVP is expected to use a `user_preferences` table.

Proposed fields:

| Field              | Purpose                           |
| ------------------ | --------------------------------- |
| `id`               | Unique preference record          |
| `location`         | User-specified concert location   |
| `genre`            | Preferred music genre             |
| `mood`             | Optional mood preference          |
| `favorite_artists` | One or more favorite artists      |
| `start_date`       | Beginning of concert search range |
| `end_date`         | End of concert search range       |
| `created_at`       | Preference creation timestamp     |

The exact schema and access strategy should be finalized before preference data is exposed through the application.

Because location and music preferences are user-related data, the preferences table should not use an unrestricted public-read policy.

---

## Planned Recommendation Logic

The MVP will begin with deterministic recommendation logic rather than AI.

Possible ranking priorities:

1. Favorite artist match
2. Genre match
3. Mood-to-genre match
4. Location match
5. Event date

Example mood mapping:

```text
Chill
→ Indie, R&B, Acoustic

Energetic
→ EDM, Pop, Hip-Hop

Sad
→ Alternative, Indie

Party
→ EDM, Rap, Pop
```

The ranking logic should be implemented as a separate testable function rather than directly inside a page component.

Example future location:

```text
lib/recommendations/rank-concerts.ts
```

---

## Planned Ticketmaster Integration

JamSpot will use the Ticketmaster Discovery API to find concert events.

The application will eventually search using data such as:

* Location
* Start date
* End date
* Genre
* Artist keyword
* Music classification

The Ticketmaster API response should be normalized before being passed to UI components.

A possible internal concert type:

```ts
type Concert = {
  id: string;
  name: string;
  venue: string;
  city: string;
  date: string;
  time?: string;
  imageUrl?: string;
  ticketUrl: string;
  genre?: string;
};
```

The UI should depend on JamSpot's normalized concert model rather than directly depending on the full Ticketmaster response structure.

---

## Suggested Project Structure

JamSpot can gradually move toward a structure similar to:

```text
jamspot/
├── app/
│   ├── api/
│   │   └── concerts/
│   │       └── route.ts
│   │
│   ├── preferences/
│   │   └── page.tsx
│   │
│   ├── test-db/
│   │   └── page.tsx
│   │
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
│
├── components/
│   ├── concert-card.tsx
│   ├── concert-grid.tsx
│   └── preference-form.tsx
│
├── lib/
│   ├── supabase.ts
│   │
│   ├── ticketmaster/
│   │   ├── normalize-event.ts
│   │   └── search-events.ts
│   │
│   └── recommendations/
│       ├── mood-map.ts
│       └── rank-concerts.ts
│
├── types/
│   ├── concert.ts
│   └── preferences.ts
│
├── public/
├── .env.local
├── .gitignore
├── .nvmrc
├── package.json
└── README.md
```

Add folders when the corresponding functionality is implemented rather than creating unused abstractions in advance.

---

## Development Roadmap

### Milestone 1 — Project Foundation

* [x] Create GitHub repository
* [x] Initialize Next.js application
* [x] Configure Node.js development environment
* [x] Create Supabase project
* [x] Install Supabase client
* [x] Configure local environment variables
* [x] Verify Supabase connectivity
* [ ] Deploy to Vercel
* [ ] Finalize database schema

### Milestone 2 — User Preferences

* [ ] Create Preferences page
* [ ] Add location input
* [ ] Add genre input
* [ ] Add mood input
* [ ] Add favorite artist input
* [ ] Add date-range inputs
* [ ] Add validation
* [ ] Save preferences to Supabase
* [ ] Fetch saved preferences
* [ ] Add database error handling

### Milestone 3 — Concert API

* [ ] Obtain Ticketmaster API credentials
* [ ] Research API search parameters
* [ ] Build server-side concert search function
* [ ] Search by location
* [ ] Search by date range
* [ ] Apply genre or music classification filters
* [ ] Normalize API data
* [ ] Add API error handling

### Milestone 4 — Recommendations

* [ ] Create Home page layout
* [ ] Fetch saved preferences
* [ ] Fetch matching concerts
* [ ] Implement genre matching
* [ ] Implement favorite artist matching
* [ ] Add mood-to-genre mapping
* [ ] Rank recommendations
* [ ] Create concert card component
* [ ] Add loading state
* [ ] Add empty state
* [ ] Add error state

### Milestone 5 — Polish and Testing

* [ ] Add navigation
* [ ] Improve styling
* [ ] Test responsive layouts
* [ ] Test preference form submission
* [ ] Test multiple cities and genres
* [ ] Test invalid date ranges
* [ ] Test no-results scenarios
* [ ] Test Supabase failures
* [ ] Test Ticketmaster failures
* [ ] Remove temporary database test route
* [ ] Remove debug logging
* [ ] Perform final MVP cleanup

---

## Testing

JamSpot includes UI unit tests built on Node.js's test runner and React server rendering. The tests cover concert formatting and filtering, the home page's UI state handlers, concert cards, modal states, streaming-service links, and artist-data error handling.

Run the UI unit tests:

```bash
npm test
```

The explicit UI-only command is also available as `npm run test:ui`.

Run the tests with enforced coverage thresholds and generate readable reports:

```bash
npm run coverage
```

The explicit command is also available as `npm run test:ui:coverage`.

Coverage must remain at or above 70% for lines, branches, and functions. Reports are written to:

```text
coverage/ui-unit.txt
coverage/ui-unit.html
```

Pull requests to `main` and `prod` run this coverage command before deployment. GitHub Actions uploads the generated `coverage/` directory as an artifact retained for 14 days. The deployment job has `needs: test`, so it cannot run unless the test job succeeds.

To prevent merging around the workflow, configure a GitHub ruleset or branch protection rule for both `main` and `prod` and require the `UI unit tests` status check. The workflow gate blocks deployment; the repository rule blocks the merge itself.

Run the browser end-to-end suite separately:

```bash
npm run test:e2e
```

## Test Scenarios

Planned concert search tests:

```text
Dallas, TX + Rap
New York, NY + Pop
Austin, TX + Country
Chicago, IL + EDM
```

Input and failure cases should include:

* Empty location
* Missing genre
* Missing start date
* Missing end date
* End date before start date
* Narrow date range
* Location with no events
* Supabase query failure
* Ticketmaster API failure

---

## Troubleshooting

### Wrong Node.js Version

Check:

```bash
node --version
```

Switch to the project version:

```bash
nvm use
```

If necessary:

```bash
nvm install 24
nvm use 24
```

Then reinstall dependencies if required:

```bash
rm -rf node_modules
npm install
```

### Environment Variables Are Not Loading

Confirm `.env.local` exists in the web app directory:

```text
jamspot/apps/web/.env.local
```

Then restart the development server:

```bash
npm run dev:web
```

### Supabase Query Fails

Check:

* `NEXT_PUBLIC_SUPABASE_URL` is correct
* `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is correct
* Both values belong to the same Supabase project
* The requested table exists
* The table is in the expected schema
* Required database permissions exist
* The required RLS policy exists
* The correct Node.js version is active

### Clear the Next.js Build Cache

macOS or Linux (from `apps/web`):

```bash
rm -rf .next
npm run dev
```

PowerShell (from `apps/web`):

```powershell
Remove-Item -Recurse -Force .next
npm run dev
```

---

## Security

* Never commit `.env.local`.
* Never commit database passwords or private API keys.
* Keep future Ticketmaster and AI API credentials server-side.
* Do not prefix server-only credentials with `NEXT_PUBLIC_`.
* Use Row Level Security for user-associated data.
* Do not create unrestricted public access to private preference records.
* Check `git status` before committing configuration changes.
* Remove temporary test routes once they are no longer needed.

---

## Future Ideas

After the MVP is stable, possible additions include:

* User accounts
* Google authentication
* User profiles
* Natural-language concert searches
* Claude-powered preference parsing
* Last.fm artist similarity recommendations
* Pagination
* Saved concerts
* Concert reviews
* Personalized recommendation history
* Native mobile application

## License

A project license has not yet been selected.
