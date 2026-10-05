import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiscoveryMetadata,
  describeDateRange,
  discoveryTitle,
  formatLongDate,
  isIndexable,
  leadImage,
  robotsFor,
} from "../../lib/discovery/metadata";
import {
  buildEventJsonLd,
  buildEventListJsonLd,
  toIsoStart,
} from "../../lib/discovery/structured-data";
import { absoluteUrl, cityGenrePath, cityPath, SITE_URL } from "../../lib/discovery/site";
import { findCityBySlug, findGenreBySlug } from "../../lib/discovery/taxonomy";
import { concert } from "./discovery-support";

const sanDiego = findCityBySlug("san-diego")!;
const indie = findGenreBySlug("indie")!;

// --- indexability -----------------------------------------------------------

test("a page with events is indexable; an empty one is not", () => {
  assert.equal(isIndexable({ concerts: [concert()], unavailable: false }), true);
  assert.equal(isIndexable({ concerts: [], unavailable: false }), false);
});

test("an upstream failure is never indexable, however it renders", () => {
  // "We couldn't reach Ticketmaster" must not be published as a durable
  // "nothing on here" - and an outage that somehow carried events is still
  // not a page we vouch for.
  assert.equal(isIndexable({ concerts: [], unavailable: true }), false);
  assert.equal(isIndexable({ concerts: [concert()], unavailable: true }), false);
});

test("noindex still allows follow, so a quiet page isn't a dead end", () => {
  assert.deepEqual(robotsFor(true), { index: true, follow: true });
  assert.deepEqual(robotsFor(false), { index: false, follow: true });
});

// --- canonical URLs ---------------------------------------------------------

test("canonical paths are built from the registry entry, not from a request", () => {
  assert.equal(cityPath(sanDiego), "/concerts/san-diego");
  assert.equal(cityGenrePath(sanDiego, indie), "/concerts/san-diego/indie");
});

test("the canonical URL is deterministic across repeated builds", () => {
  const build = () =>
    buildDiscoveryMetadata({
      title: "t",
      description: "d",
      path: cityGenrePath(sanDiego, indie),
      indexable: true,
    }).alternates?.canonical;

  assert.equal(build(), `${SITE_URL}/concerts/san-diego/indie`);
  assert.equal(build(), build());
});

test("metadata carries one canonical, matching Open Graph's url", () => {
  const metadata = buildDiscoveryMetadata({
    title: discoveryTitle("Indie Concerts in San Diego"),
    description: "Discover upcoming indie concerts in San Diego.",
    path: "/concerts/san-diego/indie",
    indexable: true,
    imageUrl: "https://img.example.com/nova.jpg",
  });

  const expected = "https://jamspot-three.vercel.app/concerts/san-diego/indie";

  // `absolute` so the root layout's "%s | JamSpot" template does not apply
  // on top of a title that already carries the suffix.
  assert.deepEqual(metadata.title, {
    absolute: "Indie Concerts in San Diego | JamSpot",
  });
  assert.equal(metadata.alternates?.canonical, expected);
  assert.equal(metadata.openGraph?.url, expected);
  assert.deepEqual(metadata.robots, { index: true, follow: true });
  assert.equal(metadata.openGraph?.siteName, "JamSpot");
  assert.deepEqual(metadata.openGraph?.images, [
    { url: "https://img.example.com/nova.jpg" },
  ]);
});

test("metadata omits the image block entirely when there is no image", () => {
  const metadata = buildDiscoveryMetadata({
    title: "t",
    description: "d",
    path: "/concerts/san-diego",
    indexable: false,
    imageUrl: null,
  });

  assert.equal("images" in (metadata.openGraph ?? {}), false);
  assert.deepEqual(metadata.robots, { index: false, follow: true });
});

test("absoluteUrl builds one origin-qualified URL however the path is spelled", () => {
  assert.equal(absoluteUrl("/concerts/san-diego"), `${SITE_URL}/concerts/san-diego`);
  assert.equal(absoluteUrl("concerts/san-diego"), `${SITE_URL}/concerts/san-diego`);
  assert.ok(!SITE_URL.endsWith("/"), "SITE_URL must not carry a trailing slash");
});

// --- date context -----------------------------------------------------------

test("date context is written from the events on the page", () => {
  assert.equal(
    describeDateRange([concert({ date: "2026-09-15" }), concert({ date: "2026-11-02" })]),
    "Dates from September 15, 2026 through November 2, 2026.",
  );
  assert.equal(
    describeDateRange([concert({ date: "2026-09-15" })]),
    "All on September 15, 2026.",
  );
});

test("no dated events means no date sentence, rather than a hedge", () => {
  assert.equal(describeDateRange([]), null);
  assert.equal(describeDateRange([concert({ date: null })]), null);
});

test("a calendar date does not slip a day when formatted", () => {
  // Parsed as UTC; TZ=UTC in the runner, but the formatter pins it regardless.
  assert.equal(formatLongDate("2026-01-01"), "January 1, 2026");
  assert.equal(formatLongDate("not-a-date"), null);
  assert.equal(formatLongDate(null), null);
});

test("leadImage picks the first event that actually has one", () => {
  assert.equal(leadImage([concert({ imageUrl: null }), concert({ imageUrl: "b.jpg" })]), "b.jpg");
  assert.equal(leadImage([concert({ imageUrl: null })]), null);
  assert.equal(leadImage([]), null);
});

// --- structured data --------------------------------------------------------

test("an event node carries only fields Ticketmaster supplied", () => {
  const node = buildEventJsonLd(concert(), "/concerts/san-diego")!;

  assert.deepEqual(node, {
    "@type": "Event",
    name: "Nova Bloom Live",
    startDate: "2026-09-15T19:30:00",
    url: `${SITE_URL}/concerts/san-diego#event-evt-1`,
    location: {
      "@type": "Place",
      name: "The Granada",
      address: {
        "@type": "PostalAddress",
        addressLocality: "San Diego",
        addressRegion: "CA",
      },
    },
    image: "https://img.example.com/nova.jpg",
    performer: { "@type": "MusicGroup", name: "Nova Bloom" },
    offers: {
      "@type": "AggregateOffer",
      url: "https://tickets.example.com/nova",
      lowPrice: 40,
      highPrice: 120,
      priceCurrency: "USD",
    },
  });
});

test("structured data invents nothing when Ticketmaster is silent", () => {
  const node = buildEventJsonLd(
    concert({
      artist: null,
      venue: null,
      city: null,
      state: null,
      imageUrl: null,
      ticketUrl: null,
      priceRange: null,
      time: null,
    }),
    "/concerts/san-diego",
  )!;

  assert.deepEqual(Object.keys(node).sort(), ["@type", "name", "startDate", "url"]);
  // Specifically: no invented performer, venue, address, price, or image.
  for (const absent of ["performer", "location", "offers", "image"]) {
    assert.equal(absent in node, false, `${absent} should have been omitted`);
  }
});

test("availability is never asserted, even when a price range exists", () => {
  const node = buildEventJsonLd(concert(), "/concerts/san-diego")!;
  const offers = node.offers as Record<string, unknown>;

  // A published price is not a statement about whether tickets remain.
  assert.equal("availability" in offers, false);
  assert.equal("eventStatus" in node, false);
  assert.equal("eventAttendanceMode" in node, false);
});

test("a venue with no city contributes a name but no address", () => {
  const node = buildEventJsonLd(
    concert({ city: null, state: null }),
    "/concerts/san-diego",
  )!;

  assert.deepEqual(node.location, { "@type": "Place", name: "The Granada" });
});

test("an event with no date is left out rather than published half-described", () => {
  assert.equal(buildEventJsonLd(concert({ date: null }), "/x"), null);
  assert.equal(buildEventJsonLd(concert({ name: "" }), "/x"), null);
});

test("a local start time keeps its wall clock - no timezone is invented", () => {
  assert.equal(toIsoStart("2026-09-15", "19:30:00"), "2026-09-15T19:30:00");
  assert.equal(toIsoStart("2026-09-15", "19:30"), "2026-09-15T19:30:00");
  // Date but no time: the date alone, not midnight.
  assert.equal(toIsoStart("2026-09-15", null), "2026-09-15");
  assert.equal(toIsoStart(null, "19:30:00"), null);
  assert.equal(toIsoStart("15/09/2026", "19:30:00"), null);
  assert.equal(toIsoStart("2026-09-15", "half seven"), "2026-09-15");
});

test("the page graph is an ordered ItemList of the qualifying events", () => {
  const list = buildEventListJsonLd(
    [concert({ id: "a" }), concert({ id: "b", date: null }), concert({ id: "c" })],
    "/concerts/san-diego",
  ) as Record<string, unknown>;

  assert.equal(list["@context"], "https://schema.org");
  assert.equal(list["@type"], "ItemList");

  const items = list.itemListElement as { position: number; item: { url: string } }[];
  assert.equal(items.length, 2, "the undated event should have been dropped");
  assert.deepEqual(
    items.map((entry) => entry.position),
    [1, 2],
  );
  assert.match(items[0].item.url, /#event-a$/);
  assert.match(items[1].item.url, /#event-c$/);
});

test("a page with nothing to describe emits no structured data at all", () => {
  assert.equal(buildEventListJsonLd([], "/concerts/san-diego"), null);
  assert.equal(buildEventListJsonLd([concert({ date: null })], "/concerts/san-diego"), null);
});
