import assert from "node:assert/strict";
import test from "node:test";

import sitemap, { genreEntries } from "../../app/sitemap";
import robots from "../../app/robots";
import { SITE_URL } from "../../lib/discovery/site";
import { DISCOVERY_CITIES, findCityBySlug } from "../../lib/discovery/taxonomy";
import { stubTicketmaster, tmEvent, withApiKey } from "./discovery-support";

/**
 * Sitemap tests (TEA-67).
 *
 * The property under test throughout is that the sitemap is *derived from
 * observed data* - it lists what a pass over the city registry actually found,
 * and nothing else.
 */

const sanDiego = findCityBySlug("san-diego")!;

/** Answer only San Diego's request with events; every other city is empty. */
function onlySanDiegoHasEvents(events: unknown[]) {
  return (url: string) =>
    url.includes("city=San+Diego") ? { _embedded: { events } } : { _embedded: { events: [] } };
}

const urlsIn = (entries: { url: string }[]) => entries.map((entry) => entry.url);

test("the sitemap lists only cities that came back with events", async () => {
  const log = stubTicketmaster({ events: onlySanDiegoHasEvents([tmEvent()]) });

  let urls: string[] = [];
  try {
    await withApiKey(async () => {
      urls = urlsIn(await sitemap());
    });
  } finally {
    log.restore();
  }

  assert.ok(urls.includes(`${SITE_URL}/concerts/san-diego`));

  // Every other registered city answered empty and is therefore absent -
  // an empty page must not be advertised to a crawler.
  for (const city of DISCOVERY_CITIES) {
    if (city.slug === "san-diego") continue;
    assert.ok(
      !urls.includes(`${SITE_URL}/concerts/${city.slug}`),
      `${city.slug} has no events and should not be listed`,
    );
  }
});

test("the sitemap never lists every arithmetic city/genre combination", async () => {
  const log = stubTicketmaster({ events: onlySanDiegoHasEvents([tmEvent()]) });

  let urls: string[] = [];
  try {
    await withApiKey(async () => {
      urls = urlsIn(await sitemap());
    });
  } finally {
    log.restore();
  }

  const genreUrls = urls.filter((url) => /\/concerts\/[^/]+\/[^/]+$/.test(url));

  // The one event is Alternative / Indie Rock, so it belongs on the
  // alternative, indie, and rock pages for San Diego - and on nothing else.
  assert.deepEqual(genreUrls.sort(), [
    `${SITE_URL}/concerts/san-diego/alternative`,
    `${SITE_URL}/concerts/san-diego/indie`,
    `${SITE_URL}/concerts/san-diego/rock`,
  ]);
});

test("the sitemap lists artists and venues drawn from real upcoming events", async () => {
  const log = stubTicketmaster({
    events: onlySanDiegoHasEvents([tmEvent()]),
    attractions: { _embedded: { attractions: [{ id: "K-nova", name: "Nova Bloom" }] } },
    venues: { _embedded: { venues: [{ id: "V-gran", name: "The Granada" }] } },
  });

  let urls: string[] = [];
  try {
    await withApiKey(async () => {
      urls = urlsIn(await sitemap());
    });
  } finally {
    log.restore();
  }

  // Both come from the event itself, so each has at least one upcoming show
  // by construction - and each was then resolved, so neither is a 404.
  assert.ok(urls.includes(`${SITE_URL}/artists/nova-bloom`));
  assert.ok(urls.includes(`${SITE_URL}/venues/the-granada`));
});

test("an entity whose slug does not resolve is left out of the sitemap", async () => {
  // The real failure this guards against: Ticketmaster prints "OKC Zoo
  // Amphitheatre" on an event, but its venues endpoint returns nothing for
  // that name, so /venues/okc-zoo-amphitheatre is a 404. Guessing the slug
  // from the event alone would put a broken URL in the sitemap.
  const log = stubTicketmaster({
    events: onlySanDiegoHasEvents([tmEvent()]),
    attractions: { _embedded: { attractions: [] } },
    venues: { _embedded: { venues: [] } },
  });

  let urls: string[] = [];
  try {
    await withApiKey(async () => {
      urls = urlsIn(await sitemap());
    });
  } finally {
    log.restore();
  }

  assert.ok(!urls.some((url) => url.includes("/artists/")), urls.join("\n"));
  assert.ok(!urls.some((url) => url.includes("/venues/")), urls.join("\n"));

  // The city and genre pages, which were observed directly, are still there.
  assert.ok(urls.includes(`${SITE_URL}/concerts/san-diego`));
});

test("a sitemap entry uses the entity's own canonical slug, not the guessed one", async () => {
  // Ticketmaster embeds this room in events under a shorter name than its
  // venues endpoint reports. The sitemap must list the URL that resolves.
  const log = stubTicketmaster({
    events: onlySanDiegoHasEvents([
      tmEvent({
        _embedded: {
          venues: [
            {
              id: "V-rave",
              name: "The Rave/Eagles Club",
              city: { name: "Milwaukee" },
              state: { stateCode: "WI" },
            },
          ],
          attractions: [{ id: "attr-nova", name: "Nova Bloom" }],
        },
      }),
    ]),
    attractions: { _embedded: { attractions: [] } },
    venues: {
      _embedded: {
        venues: [{ id: "V-rave", name: "Eagles Club/The Rave/Eagles Ballroom" }],
      },
    },
  });

  let urls: string[] = [];
  try {
    await withApiKey(async () => {
      urls = urlsIn(await sitemap());
    });
  } finally {
    log.restore();
  }

  assert.ok(
    urls.includes(`${SITE_URL}/venues/eagles-club-the-rave-eagles-ballroom`),
    urls.filter((u) => u.includes("/venues/")).join("\n"),
  );
  assert.ok(!urls.includes(`${SITE_URL}/venues/the-rave-eagles-club`));
});

test("an all-empty pass yields a sitemap with nothing but the home page", async () => {
  const log = stubTicketmaster({ events: { _embedded: { events: [] } } });

  let entries: { url: string }[] = [];
  try {
    await withApiKey(async () => {
      entries = await sitemap();
    });
  } finally {
    log.restore();
  }

  assert.deepEqual(urlsIn(entries), [`${SITE_URL}/`]);
});

test("a Ticketmaster outage produces no discovery URLs at all", async () => {
  const log = stubTicketmaster({ failWith: 503 });

  let entries: { url: string }[] = [];
  try {
    await withApiKey(async () => {
      entries = await sitemap();
    });
  } finally {
    log.restore();
  }

  // We cannot vouch for any page's content, so we advertise none of them.
  assert.deepEqual(urlsIn(entries), [`${SITE_URL}/`]);
});

test("the sitemap's request count is bounded by the registry and the caps", async () => {
  const log = stubTicketmaster({
    events: onlySanDiegoHasEvents([tmEvent()]),
    attractions: { _embedded: { attractions: [{ id: "K-nova", name: "Nova Bloom" }] } },
    venues: { _embedded: { venues: [{ id: "V-gran", name: "The Granada" }] } },
  });

  try {
    await withApiKey(async () => {
      await sitemap();
    });
  } finally {
    log.restore();
  }

  const events = log.urls.filter((url) => url.includes("events.json"));
  const lookups = log.urls.filter(
    (url) => url.includes("attractions.json") || url.includes("venues.json"),
  );

  // One events request per registered city - genre entries are read out of
  // those responses and cost nothing extra.
  assert.equal(events.length, DISCOVERY_CITIES.length);

  // Plus one lookup per distinct artist and venue candidate. The fixture has
  // exactly one of each, so this is the floor, not the ceiling - what matters
  // is that it scales with distinct entities, not with events.
  assert.equal(lookups.length, 2);
  assert.equal(log.urls.length, DISCOVERY_CITIES.length + 2);
});

test("sitemap entries are well formed absolute URLs", async () => {
  const log = stubTicketmaster({
    events: onlySanDiegoHasEvents([tmEvent()]),
    attractions: { _embedded: { attractions: [{ id: "K-nova", name: "Nova Bloom" }] } },
    venues: { _embedded: { venues: [{ id: "V-gran", name: "The Granada" }] } },
  });

  let entries: Awaited<ReturnType<typeof sitemap>> = [];
  try {
    await withApiKey(async () => {
      entries = await sitemap();
    });
  } finally {
    log.restore();
  }

  for (const entry of entries) {
    assert.doesNotThrow(() => new URL(entry.url), `bad URL: ${entry.url}`);
    assert.ok(entry.url.startsWith(SITE_URL), `not absolute: ${entry.url}`);
    assert.ok(entry.lastModified instanceof Date);
  }
});

test("genre entries for a city are deduplicated and ordered deterministically", () => {
  const now = new Date("2026-09-16T00:00:00Z");

  const entries = genreEntries(
    sanDiego,
    [
      { genre: "Alternative", subGenre: "Indie Rock" },
      { genre: "Alternative", subGenre: "Alternative" },
      { genre: "Jazz", subGenre: "Jazz" },
      { genre: "Other", subGenre: "Undefined" },
    ],
    now,
  );

  assert.deepEqual(urlsIn(entries), [
    `${SITE_URL}/concerts/san-diego/alternative`,
    `${SITE_URL}/concerts/san-diego/indie`,
    `${SITE_URL}/concerts/san-diego/jazz`,
    `${SITE_URL}/concerts/san-diego/rock`,
  ]);

  // "Other"/"Undefined" map to no page, and so contribute nothing.
  assert.equal(entries.length, 4);
});

test("robots points at the sitemap and shields non-content paths", () => {
  const result = robots();

  assert.equal(result.sitemap, `${SITE_URL}/sitemap.xml`);

  const rules = result.rules as { allow?: string; disallow?: string[] };
  assert.equal(rules.allow, "/");
  assert.ok(rules.disallow?.includes("/api/"));

  // Indexing is decided per page, by each route's own robots metadata, so no
  // discovery path may be blocked wholesale here.
  for (const path of rules.disallow ?? []) {
    assert.ok(
      !["/concerts", "/artists", "/venues"].some((prefix) => path.startsWith(prefix)),
      `${path} would block discovery pages that deserve indexing`,
    );
  }
});

test("the sitemap survives an entity lookup failing, and simply omits it", async () => {
  // A rate-limited artist lookup must not fail the whole sitemap - it drops
  // that one candidate and emits everything it could confirm. The venue
  // lookups still succeed, so they are still listed.
  const log = stubTicketmaster({
    events: onlySanDiegoHasEvents([tmEvent()]),
    venues: { _embedded: { venues: [{ id: "V-gran", name: "The Granada" }] } },
    failEndpoints: ["attractions"],
  });

  let urls: string[] = [];
  try {
    await withApiKey(async () => {
      urls = urlsIn(await sitemap());
    });
  } finally {
    log.restore();
  }

  assert.ok(!urls.some((url) => url.includes("/artists/")), "the failed lookup should be omitted");
  assert.ok(urls.includes(`${SITE_URL}/venues/the-granada`));
  assert.ok(urls.includes(`${SITE_URL}/concerts/san-diego`));
});
