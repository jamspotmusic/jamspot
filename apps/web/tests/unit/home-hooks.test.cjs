const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function installHookHarness(values) {
  const originals = {
    useEffect: React.useEffect,
    useMemo: React.useMemo,
    useState: React.useState,
  };
  const setterCalls = [];
  const cleanups = [];
  let stateIndex = 0;

  React.useState = (initialValue) => {
    const index = stateIndex++;
    const value =
      index < values.length
        ? values[index]
        : typeof initialValue === "function"
          ? initialValue()
          : initialValue;
    setterCalls[index] = [];
    return [
      value,
      (nextValue) => {
        setterCalls[index].push(nextValue);
      },
    ];
  };
  React.useMemo = (factory) => factory();
  React.useEffect = (effect) => {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  };

  return {
    cleanups,
    setterCalls,
    restore() {
      React.useEffect = originals.useEffect;
      React.useMemo = originals.useMemo;
      React.useState = originals.useState;
    },
  };
}

function findElements(node, predicate, matches = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, matches);
    return matches;
  }
  if (!React.isValidElement(node)) return matches;
  if (predicate(node)) matches.push(node);
  findElements(node.props.children, predicate, matches);
  return matches;
}

const baseEvent = {
  id: "event-1",
  artist: "Nova Bloom",
  venue: "The Granada",
  city: "Dallas",
  state: "TX",
  date: "Sep 15, 2026",
  time: "7:30 PM",
  genre: "Rock",
  priceRange: "$40 - $120",
  image: "https://picsum.photos/400/250?random=1",
  ticketUrl: "https://tickets.example.com/nova",
};

// Order matters: this array is consumed positionally by the useState stub,
// so it must track the order the hooks appear in app/page.tsx.
const HOME_STATE_INDEX = {
  query: 0,
  activeGenre: 1,
  hasSearched: 2,
  isLoadingMore: 3,
  events: 4,
  selectedEvent: 5,
  isLoading: 6,
  fetchError: 7,
  visibleCount: 8,
  searchInterpretation: 9,
};

function homeState(overrides = {}) {
  return [
    overrides.query ?? "",
    overrides.activeGenre ?? "All",
    overrides.hasSearched ?? false,
    overrides.isLoadingMore ?? false,
    overrides.events ?? [],
    overrides.selectedEvent ?? null,
    overrides.isLoading ?? false,
    overrides.fetchError ?? null,
    overrides.visibleCount ?? 6,
    overrides.searchInterpretation ?? null,
  ];
}

test("Home reacts to the one search field, and to chips, cards, and paging", async () => {
  const originalWindow = global.window;
  const opened = [];

  global.window = {
    open: (...args) => opened.push(args),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  const events = Array.from({ length: 7 }, (_, index) => ({
    ...baseEvent,
    id: `event-${index}`,
    artist: `Nova Bloom ${index}`,
  }));
  const hooks = installHookHarness(homeState({ hasSearched: true, events }));

  try {
    const page = require("../../.ui-test-build/app/page.js");
    const LunaSearch = require("../../.ui-test-build/components/LunaSearch.js").default;
    const tree = page.default();

    // Once a search has been run the field lives in the header, and there is
    // exactly one of it (TEA-51).
    const fields = findElements(tree, (element) => element.type === LunaSearch);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].props.variant, "header");

    const field = fields[0];
    field.props.onChange("Texas");
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.query].at(-1), "Texas");

    // A search is starting: filters reset, the results view takes over, and
    // the interpretation the field resolved is what gets shown above them.
    field.props.onSearchStart("Upcoming live music across Texas.");
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.hasSearched].at(-1), true);
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.isLoading].at(-1), true);
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.activeGenre].at(-1), "All");
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.visibleCount].at(-1), 6);
    assert.deepEqual(hooks.setterCalls[HOME_STATE_INDEX.events].at(-1), []);
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.fetchError].at(-1), null);
    assert.equal(
      hooks.setterCalls[HOME_STATE_INDEX.searchInterpretation].at(-1),
      "Upcoming live music across Texas.",
    );

    // A search with no interpretation leaves that line off entirely.
    field.props.onSearchStart();
    assert.equal(
      hooks.setterCalls[HOME_STATE_INDEX.searchInterpretation].at(-1),
      null,
    );

    field.props.onSearchSuccess([
      {
        id: "api-event",
        name: "API Event",
        artist: "API Artist",
        venue: "API Venue",
        city: "Dallas",
        state: "TX",
        date: "2026-09-15T12:00:00Z",
        time: "19:30:00",
        imageUrl: null,
        ticketUrl: null,
        genre: "Rock",
        subGenre: null,
        priceRange: null,
      },
    ]);
    assert.equal(
      hooks.setterCalls[HOME_STATE_INDEX.events].at(-1)[0].artist,
      "API Artist",
    );
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.isLoading].at(-1), false);

    field.props.onSearchError("Ticketmaster is unavailable");
    assert.equal(
      hooks.setterCalls[HOME_STATE_INDEX.fetchError].at(-1),
      "Ticketmaster is unavailable",
    );
    assert.deepEqual(hooks.setterCalls[HOME_STATE_INDEX.events].at(-1), []);

    const rockButton = findElements(
      tree,
      (element) => element.type === "button" && element.props.children === "Rock",
    )[0];
    rockButton.props.onClick();
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.activeGenre].at(-1), "Rock");
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.visibleCount].at(-1), 6);

    const showMore = findElements(
      tree,
      (element) => element.type === "button" && element.props.children === "Show more",
    )[0];
    showMore.props.onClick();
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.isLoadingMore][0], true);
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.visibleCount].at(-1)(6), 12);
    assert.equal(hooks.setterCalls[HOME_STATE_INDEX.isLoadingMore].at(-1), false);

    const eventCardElement = findElements(
      tree,
      (element) => element.type === page.EventCard,
    )[0];
    eventCardElement.props.onOpen(baseEvent);
    assert.deepEqual(
      hooks.setterCalls[HOME_STATE_INDEX.selectedEvent].at(-1),
      baseEvent,
    );
    eventCardElement.props.onTicketClick(baseEvent);
    eventCardElement.props.onTicketClick({ ...baseEvent, ticketUrl: null });
    assert.deepEqual(opened, [
      ["https://tickets.example.com/nova", "_blank", "noreferrer"],
    ]);

    await flushPromises();
    // Nothing is fetched from the page itself any more - the field owns the
    // request - so there is no effect left to clean up.
    assert.equal(hooks.cleanups.length, 0);
  } finally {
    hooks.restore();
    global.window = originalWindow;
  }
});

test("Home puts the search field in the hero until the first search", () => {
  const hooks = installHookHarness(homeState({ hasSearched: false }));

  try {
    const page = require("../../.ui-test-build/app/page.js");
    const LunaSearch = require("../../.ui-test-build/components/LunaSearch.js").default;
    const tree = page.default();

    const fields = findElements(tree, (element) => element.type === LunaSearch);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].props.variant, "hero");
  } finally {
    hooks.restore();
  }
});

test("the search field resolves a bare state without asking Luna", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  const started = [];
  const succeeded = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({ concerts: [] });
  };

  const hooks = installHookHarness([false, null]);

  try {
    const LunaSearch = require("../../.ui-test-build/components/LunaSearch.js").default;
    const tree = LunaSearch({
      value: "Texas",
      onChange: () => undefined,
      onSearchStart: (interpretation) => started.push(interpretation),
      onSearchSuccess: (concerts) => succeeded.push(concerts),
      onSearchError: () => assert.fail("state search should not error"),
    });

    const form = findElements(tree, (element) => element.type === "form")[0];
    await form.props.onSubmit({ preventDefault: () => undefined });

    // Straight to Ticketmaster: no Edge Function invocation, and the state
    // arrives as a stateCode rather than as free text.
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /^\/api\/concerts\?/);
    assert.match(requestedUrls[0], /stateCode=TX/);
    assert.match(requestedUrls[0], /countryCode=US/);
    assert.deepEqual(started, ["Upcoming live music across Texas."]);
    assert.deepEqual(succeeded, [[]]);

    // And the button says so, rather than offering to ask Luna.
    const button = findElements(tree, (element) => element.type === "button")[0];
    assert.equal(button.props.children, "Search");
  } finally {
    hooks.restore();
    global.fetch = originalFetch;
  }
});

test("the search field refuses input that isn't a search, without a request", async () => {
  const originalFetch = global.fetch;
  let fetches = 0;

  global.fetch = async () => {
    fetches += 1;
    return jsonResponse({ concerts: [] });
  };

  const hooks = installHookHarness([false, null]);

  try {
    const LunaSearch = require("../../.ui-test-build/components/LunaSearch.js").default;
    const tree = LunaSearch({
      value: "   ",
      onChange: () => undefined,
      onSearchStart: () => assert.fail("no search should start"),
      onSearchSuccess: () => assert.fail("no search should run"),
      onSearchError: () => assert.fail("the error belongs under the field"),
    });

    const form = findElements(tree, (element) => element.type === "form")[0];
    await form.props.onSubmit({ preventDefault: () => undefined });

    assert.equal(fetches, 0);
    // Hook index 1 is the field's own error state.
    assert.match(hooks.setterCalls[1].at(-1), /Search for a show/);
  } finally {
    hooks.restore();
    global.fetch = originalFetch;
  }
});

test("the search field reports a failed concert request to the page", async () => {
  const originalFetch = global.fetch;
  const errors = [];

  global.fetch = async () =>
    jsonResponse({ error: "Ticketmaster is unavailable" }, false);

  const hooks = installHookHarness([false, null]);

  try {
    const LunaSearch = require("../../.ui-test-build/components/LunaSearch.js").default;
    const tree = LunaSearch({
      value: "TX",
      onChange: () => undefined,
      onSearchStart: () => undefined,
      onSearchSuccess: () => assert.fail("the request failed"),
      onSearchError: (message) => errors.push(message),
    });

    const form = findElements(tree, (element) => element.type === "form")[0];
    await form.props.onSubmit({ preventDefault: () => undefined });

    // Past onSearchStart, so it belongs in the results area, not the field.
    assert.deepEqual(errors, ["Ticketmaster is unavailable"]);
    assert.equal(hooks.setterCalls[1].at(-1), null);
  } finally {
    hooks.restore();
    global.fetch = originalFetch;
  }
});

test("EventCard and modal callback functions execute without a browser DOM", async () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const listeners = new Map();
  let closeCount = 0;

  global.window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    open: () => undefined,
  };
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes("lastfm")) {
      return jsonResponse({ bio: { name: "Nova Bloom", summary: "A bio" } });
    }
    if (value.includes("spotify")) {
      return jsonResponse({
        artist: {
          id: "spotify-1",
          name: "Nova Bloom",
          url: "https://open.spotify.com/artist/1",
          imageUrl: null,
          genres: ["rock"],
          followers: 1,
          popularity: 1,
        },
      });
    }
    return jsonResponse({
      artist: {
        id: 1,
        name: "Nova Bloom",
        url: "https://music.apple.com/artist/1",
        primaryGenre: "Rock",
      },
    });
  };

  const hooks = installHookHarness([]);
  try {
    const page = require("../../.ui-test-build/app/page.js");
    const card = page.EventCard({
      event: baseEvent,
      onOpen: () => closeCount++,
      onTicketClick: () => closeCount++,
    });
    card.props.onClick();
    const cardButtons = findElements(card, (element) => element.type === "button");
    cardButtons[0].props.onClick({ stopPropagation: () => closeCount++ });
    assert.equal(closeCount, 3);

    const modal = page.EventDetailsModal({
      event: baseEvent,
      onClose: () => closeCount++,
    });
    const modalContainers = findElements(
      modal,
      (element) => element.props.className?.includes("cursor-pointer"),
    );
    modalContainers[0].props.onClick();
    modalContainers[1].props.onClick({ stopPropagation: () => closeCount++ });
    const closeButton = findElements(
      modal,
      (element) => element.props["aria-label"] === "Close concert details",
    )[0];
    closeButton.props.onClick();
    await flushPromises();

    const standalone = require("../../.ui-test-build/components/ConcertModal.js");
    const standaloneElement = standalone.default({
      event: { ...baseEvent, subGenre: "Indie Rock" },
      onClose: () => closeCount++,
    });
    assert.ok(standaloneElement);
    listeners.get("keydown")({ key: "Tab" });
    listeners.get("keydown")({ key: "Escape" });
    await flushPromises();
    assert.ok(closeCount >= 6);
    for (const cleanup of hooks.cleanups) cleanup();
  } finally {
    hooks.restore();
    global.fetch = originalFetch;
    global.window = originalWindow;
  }
});
