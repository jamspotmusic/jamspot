"use client";

import { type FormEvent, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import {
  classifySearchQuery,
  resolveConcertSearch,
  type ConcertQueryBody,
  type DeviceLocation,
  type NormalizedConcert,
  type ResolvedConcertSearch,
} from "@jamspot/shared";

import { supabase } from "@/lib/supabase";

/** The one search field the app has. Used by tests to find it. */
export const SEARCH_PLACEHOLDER =
  "Ask Luna: chill jazz under $60 this weekend — or a state like TX";

/**
 * Ask the browser for coordinates. Resolves null when geolocation is
 * unsupported, refused, or times out - the shared flow turns that into a
 * nationwide search rather than a dead end.
 */
export function requestBrowserLocation(): Promise<DeviceLocation | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}

/**
 * Invoke the `concert-query` Edge Function. The browser only ever talks to
 * Supabase here - the OpenAI credential lives in the function's own
 * server-side env and never reaches the client.
 */
async function invokeConcertQuery(body: ConcertQueryBody) {
  return supabase.functions.invoke("concert-query", { body });
}

/**
 * JamSpot's only search field (TEA-51).
 *
 * One line of text covers everything the old keyword and location inputs did.
 * `resolveConcertSearch` decides what it is: a bare state goes straight to
 * Ticketmaster, anything else goes through Luna, and input that isn't a
 * search at all is refused in the field without a request being sent.
 *
 * Whichever path runs, the result is a query string for /api/concerts - the
 * same route, the same result shape, and the same card grid as before.
 *
 * The query lives in the parent because this field moves: it sits in the
 * middle of the hero until the first search and in the header afterwards, and
 * the user's text should survive that.
 */
export default function LunaSearch({
  value,
  onChange,
  variant = "hero",
  onSearchStart,
  onSearchSuccess,
  onSearchError,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Sizing only: centred under the hero headline, or inline in the header. */
  variant?: "hero" | "header";
  /** Fired once a search is definitely running, so the page can reset its own
   *  filters and show its loading state. */
  onSearchStart: (interpretation?: string) => void;
  onSearchSuccess: (concerts: NormalizedConcert[]) => void;
  onSearchError: (message: string) => void;
}) {
  const [isSearching, setIsSearching] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  // A bare state skips the Edge Function, so the button shouldn't offer to
  // ask Luna when nothing will be asked of her.
  const isStateSearch = classifySearchQuery(value).kind === "state";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSearching(true);
    setInputError(null);

    let resolved: ResolvedConcertSearch;

    try {
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

      resolved = await resolveConcertSearch(
        value,
        timeZone,
        invokeConcertQuery,
        requestBrowserLocation,
      );
    } catch (error) {
      // Nothing has been searched yet - a refused query, an out-of-scope one,
      // or a Luna failure. It belongs under the field rather than in place of
      // results the user may still be looking at.
      setIsSearching(false);
      setInputError(
        error instanceof Error ? error.message : "Concert search failed.",
      );
      return;
    }

    setIsSearching(false);
    onSearchStart(resolved.interpretation);

    try {
      const response = await fetch(`/api/concerts?${resolved.search}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Concert search failed (${response.status})`,
        );
      }

      onSearchSuccess((data.concerts ?? []) as NormalizedConcert[]);
    } catch (error) {
      onSearchError(
        error instanceof Error ? error.message : "Failed to load concerts",
      );
    }
  }

  const isHero = variant === "hero";

  return (
    <div
      className={
        isHero
          ? "relative mx-auto w-full max-w-xl"
          : "relative ml-auto w-full max-w-2xl"
      }
    >
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        role="search"
        className={
          isHero
            ? "flex w-full flex-col gap-2 sm:flex-row sm:items-center"
            : "flex w-full items-center gap-2"
        }
      >
        <div
          className={
            isHero
              ? "flex flex-1 items-center gap-2 rounded-lg border border-white/20 bg-black/40 px-4 py-3 backdrop-blur-sm transition-colors focus-within:border-primary/60"
              : "flex flex-1 items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 transition-colors focus-within:border-primary/50"
          }
        >
          {isStateSearch ? (
            <Search size={16} className="shrink-0 text-muted-foreground" />
          ) : (
            <Sparkles size={16} className="shrink-0 text-primary" />
          )}
          <input
            type="text"
            name="luna"
            aria-label="Search concerts"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER}
            className={
              isHero
                ? "w-full flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50"
                : "w-full flex-1 truncate bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            }
          />
        </div>

        <button
          type="submit"
          disabled={isSearching}
          className={`shrink-0 cursor-pointer rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
            isHero ? "px-5 py-3" : "px-4 py-2"
          }`}
        >
          {isSearching ? "Searching..." : isStateSearch ? "Search" : "Ask Luna"}
        </button>
      </form>

      {inputError && (
        <p
          role="alert"
          className={
            isHero
              ? "mt-2 text-sm text-red-300"
              : "absolute left-0 right-0 top-full z-10 mt-1 text-sm text-red-400"
          }
        >
          {inputError}
        </p>
      )}
    </div>
  );
}
