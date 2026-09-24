import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CityPage, { generateMetadata as cityMetadata } from "../../app/concerts/[city]/page";
import CityGenrePage, {
  generateMetadata as cityGenreMetadata,
} from "../../app/concerts/[city]/[genre]/page";
import ArtistPage, {
  generateMetadata as artistMetadata,
} from "../../app/artists/[artistSlug]/page";
import VenuePage, {
  generateMetadata as venueMetadata,
} from "../../app/venues/[venueSlug]/page";
import { SITE_URL } from "../../lib/discovery/site";
import {
  assertNotFound,
  assertRedirect,
  extractJsonLd,
  stubTicketmaster,
  tmEvent,
  withApiKey,
} from "./discovery-support";

/**
 * Route-level tests for the discovery pages (TEA-67).
 *
 * The page components are async Server Components, so they are awaited to a
 * React element and then rendered to static markup - which is exactly the HTML
 * a crawler receives, and therefore the right thing to assert "the page has
 * real content without any client-side search" against.
 */

const eventsPayload = (events: unknown[]) => ({ _embedded: { events } });

/** Render an awaited Server Component to the HTML it would ship. */
async function renderPage(element: Promise<React.ReactElement>): Promise<string> {
  return renderToStaticMarkup(await element);
}

// --- city routes ------------------------------------------------------------

test("a valid city route renders its events in the initial HTML", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );

      // The heading the acceptance criteria name, and the event itself -
      // present without any client-side search having run.
      assert.match(html, /<h1[^>]*>Concerts in San Diego<\/h1>/);
      assert.match(html, /Nova Bloom/);
      assert.match(html, /The Granada/);
      assert.match(html, /1 upcoming show in San Diego, California/);
      assert.match(html, /All on September 15, 2026\./);
    });
  } finally {
    log.restore();
  }

  const url = log.urls.find((u) => u.includes("events.json"))!;
  assert.match(url, /city=San\+Diego/);
  assert.match(url, /stateCode=CA/);
  assert.match(url, /countryCode=US/);
});

test("the city page links only to genre pages its own results contain", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );

      // The fixture is Alternative / Indie Rock, so those two pages are
      // advertised and the other fifteen are not.
      assert.match(html, /\/concerts\/san-diego\/alternative/);
      assert.match(html, /\/concerts\/san-diego\/indie/);
      assert.ok(!html.includes("/concerts/san-diego/jazz"));
      assert.ok(!html.includes("/concerts/san-diego/classical"));
    });
  } finally {
    log.restore();
  }
});

test("a city/genre route applies both URL constraints, and only those", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        CityGenrePage({
          params: Promise.resolve({ city: "san-diego", genre: "indie" }),
        }),
      );

      assert.match(html, /<h1[^>]*>Indie Concerts in San Diego<\/h1>/);
    });
  } finally {
    log.restore();
  }

  const url = log.urls.find((u) => u.includes("events.json"))!;
  assert.match(url, /city=San\+Diego/);
  assert.match(url, /stateCode=CA/);
  assert.match(url, /classificationName=Indie/);
  // Nothing from a stored preference or a Luna interpretation may narrow an
  // indexed result set - only what the URL said.
  assert.ok(!url.includes("keyword="), "an indexed page must not add a keyword");
  assert.ok(!url.includes("geoPoint="), "an indexed page must not be geolocated");
  assert.ok(!url.includes("radius="));
  assert.ok(!url.includes("minPrice="));
  assert.ok(!url.includes("maxPrice="));
});

test("an invalid city 404s without spending a Ticketmaster request", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      await assertNotFound(() =>
        renderPage(CityPage({ params: Promise.resolve({ city: "atlantis" }) })),
      );
      await assertNotFound(() =>
        cityMetadata({ params: Promise.resolve({ city: "atlantis" }) }),
      );
    });
  } finally {
    log.restore();
  }

  // The whole point of the registry: an unknown slug is not a search.
  assert.deepEqual(log.urls, []);
});

test("an invalid genre 404s even when the city is real", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      await assertNotFound(() =>
        renderPage(
          CityGenrePage({
            params: Promise.resolve({ city: "san-diego", genre: "polka" }),
          }),
        ),
      );
    });
  } finally {
    log.restore();
  }

  assert.deepEqual(log.urls, []);
});

test("a param with nothing usable in it 404s", async () => {
  const log = stubTicketmaster({ events: eventsPayload([]) });

  try {
    await withApiKey(async () => {
      for (const city of ["", "---", "!!!"]) {
        await assertNotFound(() =>
          renderPage(CityPage({ params: Promise.resolve({ city }) })),
        );
      }
    });
  } finally {
    log.restore();
  }

  assert.deepEqual(log.urls, []);
});

// --- canonicalization -------------------------------------------------------

test("capitalization and formatting variants redirect to the canonical route", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      for (const variant of ["San-Diego", "SAN-DIEGO", "san--diego", "san%20diego"]) {
        await assertRedirect(
          () => renderPage(CityPage({ params: Promise.resolve({ city: variant }) })),
          "/concerts/san-diego",
        );
      }

      await assertRedirect(
        () =>
          renderPage(
            CityGenrePage({
              params: Promise.resolve({ city: "San-Diego", genre: "Indie" }),
            }),
          ),
        "/concerts/san-diego/indie",
      );
    });
  } finally {
    log.restore();
  }

  // A variant is answered from the registry alone - no request is spent
  // resolving a URL we are about to redirect away from.
  assert.deepEqual(log.urls, []);
});

test("metadata redirects on a variant too, so the two never disagree", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      await assertRedirect(
        () => cityMetadata({ params: Promise.resolve({ city: "San-Diego" }) }),
        "/concerts/san-diego",
      );
    });
  } finally {
    log.restore();
  }
});

test("the canonical is the registry path, whatever the request spelled", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      const metadata = await cityGenreMetadata({
        params: Promise.resolve({ city: "san-diego", genre: "indie" }),
      });

      assert.equal(
        metadata.alternates?.canonical,
        `${SITE_URL}/concerts/san-diego/indie`,
      );
      assert.deepEqual(metadata.title, {
        absolute: "Indie Concerts in San Diego | JamSpot",
      });
      assert.equal(
        metadata.description,
        "Discover upcoming indie concerts in San Diego, California, and find tickets through JamSpot.",
      );
    });
  } finally {
    log.restore();
  }
});

// --- indexing ---------------------------------------------------------------

test("a city page with no upcoming events is not indexed", async () => {
  const log = stubTicketmaster({ events: eventsPayload([]) });

  try {
    await withApiKey(async () => {
      const metadata = await cityMetadata({
        params: Promise.resolve({ city: "san-diego" }),
      });
      assert.deepEqual(metadata.robots, { index: false, follow: true });

      // ...and it still renders something honest.
      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );
      assert.match(html, /No upcoming shows listed in San Diego right now/);
      assert.match(html, /<h1[^>]*>Concerts in San Diego<\/h1>/);
    });
  } finally {
    log.restore();
  }
});

test("an empty city/genre page is not indexed either", async () => {
  const log = stubTicketmaster({ events: eventsPayload([]) });

  try {
    await withApiKey(async () => {
      const metadata = await cityGenreMetadata({
        params: Promise.resolve({ city: "san-diego", genre: "jazz" }),
      });
      assert.deepEqual(metadata.robots, { index: false, follow: true });
    });
  } finally {
    log.restore();
  }
});

test("a Ticketmaster outage renders an honest page and never indexes it", async () => {
  const log = stubTicketmaster({ failWith: 429, events: null });

  try {
    await withApiKey(async () => {
      const metadata = await cityMetadata({
        params: Promise.resolve({ city: "san-diego" }),
      });
      assert.deepEqual(metadata.robots, { index: false, follow: true });

      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );
      // Distinguished from "nothing on" - we do not publish an outage as a fact.
      // Rendered markup escapes the apostrophe, hence the loose middle.
      assert.match(html, /can.{0,6}t load San Diego shows right now/);
    });
  } finally {
    log.restore();
  }
});

test("a page with events is indexed and carries its structured data", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      const metadata = await cityMetadata({
        params: Promise.resolve({ city: "san-diego" }),
      });
      assert.deepEqual(metadata.robots, { index: true, follow: true });

      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );
      const [graph] = extractJsonLd(html) as Record<string, unknown>[];

      assert.equal(graph["@type"], "ItemList");
      const item = (graph.itemListElement as { item: Record<string, unknown> }[])[0].item;
      assert.equal(item["@type"], "Event");
      assert.equal(item.name, "Nova Bloom Live");
      assert.equal(item.startDate, "2026-09-15T19:30:00");
    });
  } finally {
    log.restore();
  }
});

test("an empty page emits no structured data", async () => {
  const log = stubTicketmaster({ events: eventsPayload([]) });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );
      assert.deepEqual(extractJsonLd(html), []);
    });
  } finally {
    log.restore();
  }
});

// --- artist identity --------------------------------------------------------

const attractionsPayload = (attractions: unknown[]) => ({
  _embedded: { attractions },
});

test("an artist page resolves by exact name and then fetches by attraction id", async () => {
  const log = stubTicketmaster({
    attractions: attractionsPayload([
      // The near-misses a keyword search really returns for "the national".
      { id: "K-hockey", name: "The Women's National Hockey League" },
      { id: "K-tribute", name: "The Petty Hearts - The National Tom Petty Tribute Show" },
      { id: "K-band", name: "The National", images: [{ url: "https://img/tn.jpg" }] },
    ]),
    events: eventsPayload([tmEvent({ id: "evt-tn" })]),
  });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        ArtistPage({ params: Promise.resolve({ artistSlug: "the-national" }) }),
      );
      assert.match(html, /<h1[^>]*>The National<\/h1>/);
    });
  } finally {
    log.restore();
  }

  // Identity is the id, not the name: events are fetched by attractionId, and
  // the id is the band's, not either near-miss's.
  const eventsUrl = log.urls.find((u) => u.includes("events.json"))!;
  assert.match(eventsUrl, /attractionId=K-band/);
  assert.ok(!eventsUrl.includes("keyword="), "events must not be fetched by name");
});

test("an artist slug that matches nothing 404s rather than guessing", async () => {
  const log = stubTicketmaster({
    attractions: attractionsPayload([
      { id: "K-other", name: "Someone Else Entirely" },
    ]),
    events: eventsPayload([tmEvent()]),
  });

  try {
    await withApiKey(async () => {
      await assertNotFound(() =>
        renderPage(
          ArtistPage({ params: Promise.resolve({ artistSlug: "the-national" }) }),
        ),
      );
    });
  } finally {
    log.restore();
  }

  // It looked, found nothing that matched, and stopped - no events fetched.
  assert.ok(log.urls.every((u) => !u.includes("events.json")));
});

test("an alternate Ticketmaster spelling resolves, and canonicalizes to the entity's own name", async () => {
  // Ticketmaster embeds this room in events as "The Rave/Eagles Club" while
  // its venues endpoint calls it "Eagles Club/The Rave/Eagles Ballroom".
  const log = stubTicketmaster({
    venues: venuesPayload([
      {
        id: "KovZ-rave",
        name: "Eagles Club/The Rave/Eagles Ballroom",
        city: { name: "Milwaukee" },
        state: { stateCode: "WI" },
      },
    ]),
    events: eventsPayload([tmEvent()]),
  });

  try {
    await withApiKey(async () => {
      // It renders rather than 404ing - the room plainly exists.
      const html = await renderPage(
        VenuePage({
          params: Promise.resolve({ venueSlug: "the-rave-eagles-club" }),
        }),
      );
      assert.match(html, /Eagles Club\/The Rave\/Eagles Ballroom/);

      // ...and it points at the entity's own URL, so only one is indexed.
      // A redirect would be wrong here: these routes are incrementally
      // regenerated, and a redirect thrown during regeneration is cached as
      // the path's prerender.
      const metadata = await venueMetadata({
        params: Promise.resolve({ venueSlug: "the-rave-eagles-club" }),
      });
      assert.equal(
        metadata.alternates?.canonical,
        `${SITE_URL}/venues/eagles-club-the-rave-eagles-ballroom`,
      );
    });
  } finally {
    log.restore();
  }

  const eventsUrl = log.urls.find((u) => u.includes("events.json"))!;
  assert.match(eventsUrl, /venueId=KovZ-rave/);
});

test("the name-variant fallback will not resolve a slug onto a different act", async () => {
  // The exact hazard the acceptance criteria call out: a keyword search for
  // "the national" surfaces a tribute act whose name contains both words.
  const log = stubTicketmaster({
    attractions: attractionsPayload([
      {
        id: "K-tribute",
        name: "The Petty Hearts - The National Tom Petty Tribute Show",
      },
    ]),
    events: eventsPayload([tmEvent()]),
  });

  try {
    await withApiKey(async () => {
      await assertNotFound(() =>
        renderPage(
          ArtistPage({ params: Promise.resolve({ artistSlug: "the-national" }) }),
        ),
      );
    });
  } finally {
    log.restore();
  }
});

test("an ambiguous name resolves to nothing rather than to an arbitrary room", async () => {
  const log = stubTicketmaster({
    venues: venuesPayload([
      { id: "KovZ-sd", name: "House of Blues San Diego" },
      { id: "KovZ-chi", name: "House of Blues Chicago" },
    ]),
    events: eventsPayload([tmEvent()]),
  });

  try {
    await withApiKey(async () => {
      await assertNotFound(() =>
        renderPage(
          VenuePage({ params: Promise.resolve({ venueSlug: "house-of-blues" }) }),
        ),
      );
    });
  } finally {
    log.restore();
  }
});

test("several acts sharing a name resolve deterministically", async () => {
  const candidates = [
    { id: "K-zzz", name: "Nova Bloom" },
    { id: "K-aaa", name: "Nova Bloom" },
    { id: "K-mmm", name: "Nova Bloom" },
  ];

  // Same set, different order - the page must be about the same act either way.
  for (const order of [candidates, [...candidates].reverse()]) {
    const log = stubTicketmaster({
      attractions: attractionsPayload(order),
      events: eventsPayload([]),
    });

    try {
      await withApiKey(async () => {
        await renderPage(
          ArtistPage({ params: Promise.resolve({ artistSlug: "nova-bloom" }) }),
        );
      });
    } finally {
      log.restore();
    }

    const eventsUrl = log.urls.find((u) => u.includes("events.json"))!;
    assert.match(eventsUrl, /attractionId=K-aaa/);
  }
});

test("an artist page with no upcoming dates is not indexed", async () => {
  const log = stubTicketmaster({
    attractions: attractionsPayload([{ id: "K-band", name: "The National" }]),
    events: eventsPayload([]),
  });

  try {
    await withApiKey(async () => {
      const metadata = await artistMetadata({
        params: Promise.resolve({ artistSlug: "the-national" }),
      });

      assert.deepEqual(metadata.robots, { index: false, follow: true });
      assert.equal(
        metadata.alternates?.canonical,
        `${SITE_URL}/artists/the-national`,
      );
    });
  } finally {
    log.restore();
  }
});

// --- venue identity ---------------------------------------------------------

const venuesPayload = (venues: unknown[]) => ({ _embedded: { venues } });

test("similarly named venues stay separate entities", async () => {
  // Both are real Ticketmaster rooms, and they are unrelated.
  const venues = [
    { id: "KovZ-aspen", name: "Belly Up Aspen", city: { name: "Aspen" }, state: { stateCode: "CO" } },
    {
      id: "KovZ-tavern",
      name: "Belly Up Tavern",
      city: { name: "Solana Beach" },
      state: { stateCode: "CA" },
    },
  ];

  for (const [slug, expectedId, expectedCity] of [
    ["belly-up-aspen", "KovZ-aspen", "Aspen, CO"],
    ["belly-up-tavern", "KovZ-tavern", "Solana Beach, CA"],
  ] as const) {
    const log = stubTicketmaster({
      venues: venuesPayload(venues),
      events: eventsPayload([tmEvent()]),
    });

    try {
      await withApiKey(async () => {
        const html = await renderPage(
          VenuePage({ params: Promise.resolve({ venueSlug: slug }) }),
        );
        assert.match(html, new RegExp(expectedCity.replace(",", ",")));
      });
    } finally {
      log.restore();
    }

    const eventsUrl = log.urls.find((u) => u.includes("events.json"))!;
    assert.match(eventsUrl, new RegExp(`venueId=${expectedId}`));
  }
});

test("a venue slug that matches neither room 404s", async () => {
  const log = stubTicketmaster({
    venues: venuesPayload([
      { id: "KovZ-aspen", name: "Belly Up Aspen" },
      { id: "KovZ-tavern", name: "Belly Up Tavern" },
    ]),
    events: eventsPayload([tmEvent()]),
  });

  try {
    await withApiKey(async () => {
      // "the-belly-up" is neither venue's actual name.
      await assertNotFound(() =>
        renderPage(VenuePage({ params: Promise.resolve({ venueSlug: "the-belly-up" }) })),
      );
    });
  } finally {
    log.restore();
  }

  assert.ok(log.urls.every((u) => !u.includes("events.json")));
});

test("a venue page names the room, its city/state, and its events", async () => {
  const log = stubTicketmaster({
    venues: venuesPayload([
      {
        id: "KovZ-tavern",
        name: "Belly Up Tavern",
        city: { name: "Solana Beach" },
        state: { stateCode: "CA" },
      },
    ]),
    events: eventsPayload([tmEvent()]),
  });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        VenuePage({ params: Promise.resolve({ venueSlug: "belly-up-tavern" }) }),
      );

      assert.match(html, /<h1[^>]*>Concerts at Belly Up Tavern<\/h1>/);
      assert.match(html, /Solana Beach, CA/);
      assert.match(html, /Nova Bloom/);

      const metadata = await venueMetadata({
        params: Promise.resolve({ venueSlug: "belly-up-tavern" }),
      });
      assert.deepEqual(metadata.title, {
        absolute: "Belly Up Tavern Concerts & Tickets | JamSpot",
      });
      assert.equal(
        metadata.alternates?.canonical,
        `${SITE_URL}/venues/belly-up-tavern`,
      );
      assert.deepEqual(metadata.robots, { index: true, follow: true });
    });
  } finally {
    log.restore();
  }
});

// --- ticket CTA -------------------------------------------------------------

test("the ticket CTA still points at Ticketmaster, with nothing appended", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      const html = await renderPage(
        CityPage({ params: Promise.resolve({ city: "san-diego" }) }),
      );

      assert.match(html, /Get Tickets/);

      // Attribution is recorded on our side. Affiliate and tracking parameters
      // on Ticketmaster URLs are out of scope until an agreement exists, so
      // the outbound URL must appear verbatim wherever it appears at all.
      for (const match of html.matchAll(/https:\/\/tickets\.example\.com\/nova[^"'\s]*/g)) {
        assert.equal(match[0], "https://tickets.example.com/nova");
      }
    });
  } finally {
    log.restore();
  }
});

// --- request budget ---------------------------------------------------------

test("a city page render costs exactly one Ticketmaster request", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent(), tmEvent({ id: "b" })]) });

  try {
    await withApiKey(async () => {
      await renderPage(CityPage({ params: Promise.resolve({ city: "san-diego" }) }));
    });
  } finally {
    log.restore();
  }

  // Bounded by the page, not by how many events came back.
  assert.equal(log.urls.length, 1);
});

test("metadata and the page body request the same URL, so the cache serves one", async () => {
  const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });

  try {
    await withApiKey(async () => {
      await cityMetadata({ params: Promise.resolve({ city: "san-diego" }) });
      await renderPage(CityPage({ params: Promise.resolve({ city: "san-diego" }) }));
    });
  } finally {
    log.restore();
  }

  // React's cache() collapses these within a real render; this asserts the
  // property that makes that possible - and that makes Next's Data Cache
  // serve the second one when it doesn't: byte-identical request URLs.
  assert.equal(new Set(log.urls).size, 1, log.urls.join("\n"));

  // And every one of them is opted into the Data Cache.
  for (const options of log.options) {
    assert.equal(typeof options.next?.revalidate, "number");
  }
});

test("a city/genre page's request URL is stable across renders", async () => {
  const urls: string[] = [];

  for (let i = 0; i < 2; i++) {
    const log = stubTicketmaster({ events: eventsPayload([tmEvent()]) });
    try {
      await withApiKey(async () => {
        await renderPage(
          CityGenrePage({
            params: Promise.resolve({ city: "san-diego", genre: "indie" }),
          }),
        );
      });
    } finally {
      log.restore();
    }
    urls.push(log.urls[0]);
  }

  // A per-render timestamp in startDateTime would break every cache hit.
  assert.equal(urls[0], urls[1], urls.join("\n"));
});

test("an outage on an artist or venue page is transient, not a 404", async () => {
  const log = stubTicketmaster({ failWith: 503 });

  try {
    await withApiKey(async () => {
      // A 404 would tell a crawler the page does not exist, when all we know
      // is that we could not check. Letting the error through yields a 5xx,
      // which is retried rather than dropped. The city page differs on
      // purpose: the registry already tells it which city it is, so it can
      // render an honest empty state instead.
      for (const render of [
        () => renderPage(ArtistPage({ params: Promise.resolve({ artistSlug: "the-national" }) })),
        () => renderPage(VenuePage({ params: Promise.resolve({ venueSlug: "belly-up-tavern" }) })),
      ]) {
        await assert.rejects(render, (err: Error) => {
          assert.ok(
            !/NEXT_HTTP_ERROR_FALLBACK;404/.test(err.message),
            "an outage must not present as a 404",
          );
          assert.equal(err.name, "TicketmasterApiError");
          return true;
        });
      }
    });
  } finally {
    log.restore();
  }
});
