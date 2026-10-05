import assert from "node:assert/strict";
import test from "node:test";

import {
  isCanonicalSlug,
  normalizeSlugParam,
  toSlug,
} from "../../lib/discovery/slug";
import {
  DISCOVERY_CITIES,
  DISCOVERY_GENRES,
  findCityBySlug,
  findGenreByClassification,
  findGenreBySlug,
} from "../../lib/discovery/taxonomy";
import { canonicalizePath } from "../../proxy";

// --- toSlug -----------------------------------------------------------------

test("toSlug produces the documented slugs", () => {
  assert.equal(toSlug("San Diego"), "san-diego");
  assert.equal(toSlug("R&B"), "r-and-b");
  assert.equal(toSlug("Hip-Hop/Rap"), "hip-hop-rap");
  assert.equal(toSlug("Dance/Electronic"), "dance-electronic");
  assert.equal(toSlug("St. Louis"), "st-louis");
});

test("toSlug folds accents and drops apostrophes rather than splitting on them", () => {
  assert.equal(toSlug("Café Tacvba"), "cafe-tacvba");
  assert.equal(toSlug("Beyoncé"), "beyonce");
  // "levi-s" would be a different, un-resolvable slug.
  assert.equal(toSlug("Levi's Stadium"), "levis-stadium");
  assert.equal(toSlug("Sinéad O’Connor"), "sinead-oconnor");
});

test("toSlug keeps & distinct from nothing at all", () => {
  // Dropping "&" would collide these two, and they are different acts.
  assert.notEqual(toSlug("R&B"), toSlug("RB"));
  assert.equal(toSlug("Earth, Wind & Fire"), "earth-wind-and-fire");
});

test("toSlug collapses separators and trims the edges", () => {
  assert.equal(toSlug("  San   Diego  "), "san-diego");
  assert.equal(toSlug("--san--diego--"), "san-diego");
  assert.equal(toSlug("!!!"), "");
});

test("toSlug is idempotent - a slug run through it again is unchanged", () => {
  for (const value of ["San Diego", "R&B", "Hip-Hop/Rap", "Café Tacvba"]) {
    const once = toSlug(value);
    assert.equal(toSlug(once), once, `not idempotent for ${value}`);
  }
});

// --- normalizeSlugParam -----------------------------------------------------

test("normalizeSlugParam resolves capitalization and formatting variants to one slug", () => {
  for (const variant of [
    "san-diego",
    "San-Diego",
    "SAN-DIEGO",
    "san--diego",
    "-san-diego-",
    "san%20diego",
  ]) {
    assert.equal(normalizeSlugParam(variant), "san-diego", `failed for ${variant}`);
  }
});

test("normalizeSlugParam rejects params with nothing usable in them", () => {
  assert.equal(normalizeSlugParam(""), null);
  assert.equal(normalizeSlugParam("---"), null);
  assert.equal(normalizeSlugParam("!!!"), null);
  assert.equal(normalizeSlugParam(undefined), null);
});

test("normalizeSlugParam survives a malformed percent-escape", () => {
  // decodeURIComponent throws on this; the helper must not.
  assert.doesNotThrow(() => normalizeSlugParam("%E0%A4%A"));
});

test("isCanonicalSlug accepts only the exact canonical spelling", () => {
  assert.equal(isCanonicalSlug("san-diego"), true);
  assert.equal(isCanonicalSlug("San-Diego"), false);
  assert.equal(isCanonicalSlug("san--diego"), false);
  assert.equal(isCanonicalSlug("san diego"), false);
  assert.equal(isCanonicalSlug(""), false);
});

// --- registry invariants ----------------------------------------------------

test("every city slug is unique and already canonical", () => {
  const seen = new Set<string>();

  for (const city of DISCOVERY_CITIES) {
    assert.ok(isCanonicalSlug(city.slug), `${city.slug} is not a canonical slug`);
    assert.ok(!seen.has(city.slug), `duplicate city slug: ${city.slug}`);
    seen.add(city.slug);
  }
});

test("every genre slug is unique and already canonical", () => {
  const seen = new Set<string>();

  for (const genre of DISCOVERY_GENRES) {
    assert.ok(isCanonicalSlug(genre.slug), `${genre.slug} is not a canonical slug`);
    assert.ok(!seen.has(genre.slug), `duplicate genre slug: ${genre.slug}`);
    seen.add(genre.slug);
  }
});

test("no two genres send the same classification to Ticketmaster", () => {
  // Two slugs resolving to one Ticketmaster query would be two URLs for one
  // page - the duplicate-canonical case the acceptance criteria rule out.
  const seen = new Set<string>();

  for (const genre of DISCOVERY_GENRES) {
    const key = genre.classificationName.toLowerCase();
    assert.ok(!seen.has(key), `duplicate classification: ${genre.classificationName}`);
    seen.add(key);
  }
});

test("registry lookups are exact - a near miss is not a hit", () => {
  assert.equal(findCityBySlug("san-diego")?.name, "San Diego");
  assert.equal(findCityBySlug("San-Diego"), null);
  assert.equal(findCityBySlug("sandiego"), null);
  assert.equal(findCityBySlug(null), null);

  assert.equal(findGenreBySlug("indie")?.classificationName, "Indie");
  assert.equal(findGenreBySlug("r-and-b")?.label, "R&B");
  assert.equal(findGenreBySlug("rnb"), null);
  assert.equal(findGenreBySlug(null), null);
});

test("city slugs disambiguate a name two states share", () => {
  // Portland, OR is published; the bare "portland" slug is deliberately not a
  // page, so it can never silently mean Maine.
  assert.equal(findCityBySlug("portland-or")?.stateCode, "OR");
  assert.equal(findCityBySlug("portland"), null);
});

test("classification lookup goes through the canonical id, not the display string", () => {
  // Un-slugging "Hip-Hop/Rap" would never produce "hip-hop"; mapping through
  // classificationName does.
  assert.equal(findGenreByClassification("Hip-Hop/Rap")?.slug, "hip-hop");
  assert.equal(findGenreByClassification("Dance/Electronic")?.slug, "electronic");
  assert.equal(findGenreByClassification("R&B")?.slug, "r-and-b");
  assert.equal(findGenreByClassification("alternative")?.slug, "alternative");
});

test("classification lookup returns null for genres we publish no page for", () => {
  assert.equal(findGenreByClassification("Undefined"), null);
  assert.equal(findGenreByClassification("Other"), null);
  assert.equal(findGenreByClassification(null), null);
  assert.equal(findGenreByClassification(undefined), null);
});

// --- proxy canonicalization -------------------------------------------------

test("canonicalizePath collapses every equivalent spelling onto one path", () => {
  for (const variant of [
    "/concerts/San-Diego",
    "/concerts/SAN-DIEGO",
    "/concerts/san--diego",
    "/concerts/san diego",
    "/concerts/san-diego/",
  ]) {
    assert.equal(canonicalizePath(variant), "/concerts/san-diego", `failed for ${variant}`);
  }

  assert.equal(
    canonicalizePath("/concerts/San-Diego/Indie"),
    "/concerts/san-diego/indie",
  );
  assert.equal(canonicalizePath("/artists/The-National"), "/artists/the-national");
  assert.equal(canonicalizePath("/venues/Belly-Up-Tavern"), "/venues/belly-up-tavern");
});

test("canonicalizePath leaves an already-canonical path untouched", () => {
  // Equality with the input is what the proxy reads as "no redirect needed".
  for (const path of [
    "/concerts/san-diego",
    "/concerts/san-diego/indie",
    "/artists/the-national",
    "/venues/belly-up-tavern",
  ]) {
    assert.equal(canonicalizePath(path), path);
  }
});

test("canonicalizePath declines paths it cannot canonicalize", () => {
  // Null means "leave it to the route", which 404s - rather than redirecting
  // to a path that is just as unresolvable, or bouncing in a loop.
  assert.equal(canonicalizePath("/concerts/---"), null);
  assert.equal(canonicalizePath("/concerts/!!!"), null);
  assert.equal(canonicalizePath("/concerts/%E0%A4%A"), null);
  assert.equal(canonicalizePath("/"), null);
});

test("canonicalizePath never produces a path that would redirect again", () => {
  for (const variant of [
    "/concerts/San-Diego",
    "/concerts/SAN--DIEGO/Indie",
    "/artists/Caf%C3%A9-Tacvba",
    "/venues/Levi%27s-Stadium",
  ]) {
    const once = canonicalizePath(variant)!;
    assert.equal(canonicalizePath(once), once, `${variant} would loop`);
  }
});
