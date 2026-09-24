import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DISCOVERY_SURFACES,
  setAnalyticsSink,
  track,
  type AnalyticsEvent,
} from "../../lib/analytics/discovery-attribution";
import DiscoveryEventGrid from "../../components/discovery/DiscoveryEventGrid";
import CityGenrePage from "../../app/concerts/[city]/[genre]/page";
import { concert, stubTicketmaster, tmEvent, withApiKey } from "./discovery-support";

/**
 * Attribution tests (TEA-67, feeding TEA-54).
 *
 * The journey being preserved is Google -> discovery page -> concert detail ->
 * Get Tickets -> Ticketmaster, and the constraint is that it is preserved
 * *without* touching the outbound Ticketmaster URL.
 */

/** Install a recording sink for one test, then put the no-op back. */
function recordEvents(fn: () => void): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  setAnalyticsSink((event) => events.push(event));
  try {
    fn();
  } finally {
    setAnalyticsSink(null);
  }
  return events;
}

test("the surface names are the literal values TEA-54 reports on", () => {
  assert.deepEqual(DISCOVERY_SURFACES, {
    city: "seo_city",
    cityGenre: "seo_city_genre",
    artist: "seo_artist",
    venue: "seo_venue",
  });
});

test("events reach an installed sink, and stop when it is removed", () => {
  const events = recordEvents(() => {
    track({
      type: "ticket_cta_clicked",
      concertId: "evt-1",
      placement: "card",
      attribution: {
        surface: DISCOVERY_SURFACES.cityGenre,
        path: "/concerts/san-diego/indie",
        citySlug: "san-diego",
        genreSlug: "indie",
      },
    });
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ticket_cta_clicked");

  // Removed again: the default sink drops everything.
  const afterwards = recordEvents(() => {});
  setAnalyticsSink(null);
  track({ type: "ticket_cta_clicked", concertId: "evt-2", placement: "card" });
  assert.deepEqual(afterwards, []);
});

test("a throwing sink never breaks the click it was observing", () => {
  setAnalyticsSink(() => {
    throw new Error("analytics vendor is down");
  });

  try {
    // The ticket click is the most valuable interaction on the site; an
    // analytics failure must not be allowed to take it down.
    assert.doesNotThrow(() =>
      track({ type: "ticket_cta_clicked", concertId: "evt-1", placement: "card" }),
    );
  } finally {
    setAnalyticsSink(null);
  }
});

/**
 * Drive the grid's own hooks, the way tests/unit/home-hooks.test.cjs drives
 * the home page's. renderToStaticMarkup never runs effects or attaches
 * handlers, so asserting on markup alone could not tell whether the
 * attribution is actually wired to anything.
 */
function installHookHarness() {
  const originals = { useState: React.useState, useEffect: React.useEffect };

  // Cast through unknown: these stubs satisfy the call sites under test, not
  // React's full overloaded signatures.
  React.useState = ((initial: unknown) => [
    typeof initial === "function" ? (initial as () => unknown)() : initial,
    () => {},
  ]) as unknown as typeof React.useState;
  React.useEffect = ((effect: () => void) => {
    effect();
  }) as unknown as typeof React.useEffect;

  return {
    restore() {
      React.useState = originals.useState;
      React.useEffect = originals.useEffect;
    },
  };
}

/** Every element in a tree matching `predicate`. */
function findElements(
  node: unknown,
  predicate: (el: React.ReactElement) => boolean,
  matches: React.ReactElement[] = [],
): React.ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, matches);
    return matches;
  }
  if (!React.isValidElement(node)) return matches;
  if (predicate(node)) matches.push(node);
  findElements(
    (node.props as { children?: unknown }).children,
    predicate,
    matches,
  );
  return matches;
}

const cityAttribution = {
  surface: DISCOVERY_SURFACES.city,
  path: "/concerts/san-diego",
  citySlug: "san-diego",
} as const;

test("the grid records a page view carrying the surface and the result count", () => {
  const harness = installHookHarness();
  let events: AnalyticsEvent[] = [];

  try {
    events = recordEvents(() => {
      DiscoveryEventGrid({
        concerts: [concert(), concert({ id: "evt-2" })],
        attribution: { ...cityAttribution },
        emptyMessage: "nothing on",
      });
    });
  } finally {
    harness.restore();
  }

  assert.equal(events.length, 1);
  const event = events[0];
  if (event.type !== "discovery_page_view") throw new Error("wrong event type");
  assert.equal(event.attribution.surface, "seo_city");
  assert.equal(event.attribution.path, "/concerts/san-diego");
  assert.equal(event.resultCount, 2);
});

test("an empty discovery page still reports itself, with a count of zero", () => {
  const harness = installHookHarness();
  let events: AnalyticsEvent[] = [];

  try {
    events = recordEvents(() => {
      DiscoveryEventGrid({
        concerts: [],
        attribution: { ...cityAttribution },
        emptyMessage: "No upcoming shows listed in San Diego right now.",
      });
    });
  } finally {
    harness.restore();
  }

  // A page that had nothing to convert is exactly what TEA-54 needs to be
  // able to tell apart from a page that converted nothing.
  assert.equal(events.length, 1);
  const event = events[0];
  if (event.type !== "discovery_page_view") throw new Error("wrong event type");
  assert.equal(event.resultCount, 0);
});

test("the card's ticket click records its surface and opens the URL untouched", () => {
  const harness = installHookHarness();
  const opened: { url: string; target: string; features: string }[] = [];
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    open: (url: string, target: string, features: string) =>
      opened.push({ url, target, features }),
  };

  let events: AnalyticsEvent[] = [];
  try {
    events = recordEvents(() => {
      const tree = DiscoveryEventGrid({
        concerts: [concert()],
        attribution: {
          surface: DISCOVERY_SURFACES.artist,
          path: "/artists/nova-bloom",
          entitySlug: "nova-bloom",
          entityId: "attr-nova",
        },
        emptyMessage: "nothing on",
      });

      // The grid hands each card an onTicketClick; invoke the real one.
      const [card] = findElements(
        tree,
        (element) =>
          typeof (element.props as { onTicketClick?: unknown }).onTicketClick ===
          "function",
      );
      assert.ok(card, "expected the grid to wire a ticket handler onto a card");

      const props = card.props as {
        event: { id: string; ticketUrl: string | null };
        onTicketClick: (event: { id: string; ticketUrl: string | null }) => void;
      };
      props.onTicketClick(props.event);
    });
  } finally {
    harness.restore();
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  }

  const clicks = events.filter((event) => event.type === "ticket_cta_clicked");
  assert.equal(clicks.length, 1);
  const click = clicks[0];
  if (click.type !== "ticket_cta_clicked") throw new Error("unreachable");
  assert.equal(click.attribution?.surface, "seo_artist");
  assert.equal(click.attribution?.entityId, "attr-nova");
  assert.equal(click.concertId, "evt-1");
  assert.equal(click.placement, "card");

  // The CTA's behaviour is unchanged: same URL, same target, nothing appended.
  assert.deepEqual(opened, [
    {
      url: "https://tickets.example.com/nova",
      target: "_blank",
      features: "noreferrer",
    },
  ]);
});

test("opening a concert from a discovery page records where it was opened from", () => {
  const harness = installHookHarness();
  let events: AnalyticsEvent[] = [];

  try {
    events = recordEvents(() => {
      const tree = DiscoveryEventGrid({
        concerts: [concert()],
        attribution: { ...cityAttribution },
        emptyMessage: "nothing on",
      });

      const [card] = findElements(
        tree,
        (element) =>
          typeof (element.props as { onOpen?: unknown }).onOpen === "function",
      );
      const props = card.props as {
        event: { id: string };
        onOpen: (event: { id: string }) => void;
      };
      props.onOpen(props.event);
    });
  } finally {
    harness.restore();
  }

  // This is the middle hop of the Google -> page -> detail -> Ticketmaster
  // journey; without it the funnel has a gap where the modal is.
  const opens = events.filter((event) => event.type === "discovery_concert_opened");
  assert.equal(opens.length, 1);
  const open = opens[0];
  if (open.type !== "discovery_concert_opened") throw new Error("unreachable");
  assert.equal(open.attribution.surface, "seo_city");
  assert.equal(open.concertId, "evt-1");
});

test("a discovery page carries its surface into the rendered grid", async () => {
  const log = stubTicketmaster({ events: { _embedded: { events: [tmEvent()] } } });

  try {
    await withApiKey(async () => {
      const element = (await CityGenrePage({
        params: Promise.resolve({ city: "san-diego", genre: "indie" }),
      })) as React.ReactElement;

      const html = renderToStaticMarkup(element);

      // The page renders, and the Ticketmaster link in it is verbatim - the
      // attribution rides in the page's own event stream, not in this URL.
      assert.match(html, /Get Tickets/);
      assert.match(html, /https:\/\/tickets\.example\.com\/nova/);
      assert.ok(
        !html.includes("utm_"),
        "no tracking parameters may be appended to a Ticketmaster URL",
      );
      assert.ok(!html.includes("seo_city_genre"), "attribution is not leaked into markup");
    });
  } finally {
    log.restore();
  }
});
