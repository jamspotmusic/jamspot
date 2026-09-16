import assert from "node:assert/strict";
import test from "node:test";

import { pickEntityMatch, slugToKeyword } from "../../lib/discovery/entities";

/**
 * Entity-identity tests (TEA-67).
 *
 * pickEntityMatch is the single place where a URL becomes a claim about which
 * real-world act or room a page is about, so its guards are pinned down here
 * directly rather than only through the routes.
 */

const candidate = (id: string, name: string) => ({ id, name });

test("slugToKeyword builds a search term, and does not pretend to un-slug", () => {
  assert.equal(slugToKeyword("the-national"), "the national");
  assert.equal(slugToKeyword("belly-up-tavern"), "belly up tavern");
  // "r-and-b" spaces out wrongly, and that is fine: the result is only ever
  // used to fetch candidates that are then matched on their own real names,
  // so a bad search term costs a miss, never a wrong entity.
  assert.equal(slugToKeyword("r-and-b"), "r and b");
});

test("an exact name match wins over everything else", () => {
  const match = pickEntityMatch(
    [
      candidate("K-hockey", "The Women's National Hockey League"),
      candidate("K-tribute", "The Petty Hearts - The National Tom Petty Tribute Show"),
      candidate("K-band", "The National"),
    ],
    "the-national",
  );

  assert.equal(match?.id, "K-band");
});

test("entities sharing a name resolve deterministically, by lowest id", () => {
  const candidates = [
    candidate("K-zzz", "Nova Bloom"),
    candidate("K-aaa", "Nova Bloom"),
    candidate("K-mmm", "Nova Bloom"),
  ];

  // Order must not change the answer: a canonical URL that flip-flopped
  // between two entities would be worse than either choice.
  assert.equal(pickEntityMatch(candidates, "nova-bloom")?.id, "K-aaa");
  assert.equal(pickEntityMatch([...candidates].reverse(), "nova-bloom")?.id, "K-aaa");
});

test("a name Ticketmaster spells two ways still resolves to the one entity", () => {
  // Real case: Ticketmaster embeds this room in events as "The Rave/Eagles
  // Club" but its venues endpoint returns "Eagles Club/The Rave/Eagles
  // Ballroom". Both have to reach the same venue id.
  const match = pickEntityMatch(
    [candidate("KovZ-rave", "Eagles Club/The Rave/Eagles Ballroom")],
    "the-rave-eagles-club",
  );

  assert.equal(match?.id, "KovZ-rave");
});

test("the fallback refuses a name carrying more than one extra word", () => {
  // The hazard the acceptance criteria name outright.
  assert.equal(
    pickEntityMatch(
      [candidate("K-tribute", "The Petty Hearts - The National Tom Petty Tribute Show")],
      "the-national",
    ),
    null,
  );

  assert.equal(
    pickEntityMatch(
      [candidate("K-hockey", "The Women's National Hockey League")],
      "the-national",
    ),
    null,
  );
});

test("the fallback refuses an ambiguous name, however the candidates are shaped", () => {
  const houses = [
    candidate("KovZ-chi", "House of Blues Chicago"),
    candidate("KovZ-sd", "House of Blues San Diego"),
  ];

  // Both contain every word of the slug, so neither is "the" House of Blues.
  // Note Chicago alone would pass the extra-word limit and San Diego would
  // not - so ambiguity has to be judged before that limit is applied, or the
  // shorter city name silently wins.
  assert.equal(pickEntityMatch(houses, "house-of-blues"), null);
  assert.equal(pickEntityMatch([...houses].reverse(), "house-of-blues"), null);
});

test("a one-word slug is exact-match only", () => {
  // Otherwise "rush" would resolve to a tribute project.
  assert.equal(
    pickEntityMatch([candidate("K-tribute", "Rush Tribute Project")], "rush"),
    null,
  );
  assert.equal(
    pickEntityMatch(
      [candidate("K-tribute", "Rush Tribute Project"), candidate("K-rush", "Rush")],
      "rush",
    )?.id,
    "K-rush",
  );
});

test("no candidates, or none matching, resolves to nothing", () => {
  assert.equal(pickEntityMatch([], "the-national"), null);
  assert.equal(
    pickEntityMatch([candidate("K-other", "Someone Else Entirely")], "the-national"),
    null,
  );
});
