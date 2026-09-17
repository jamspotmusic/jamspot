"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import {
  buildConcertsQuery,
  getOrCreateLunaSessionId,
  interpretConcertQuery,
  LUNA_SESSION_ID_HEADER,
  type ConcertQueryBody,
  type ConcertQueryResponse,
  type DeviceLocation,
  type NormalizedConcert,
} from "@jamspot/shared";

import { createClient } from "@/lib/supabase-browser";

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

/** localStorage, or null where it isn't available (SSR, some private modes). */
function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Invoke the `concert-query` Edge Function. The browser only ever talks to
 * Supabase here - the OpenAI credential lives in the function's own
 * server-side env and never reaches the client.
 *
 * Uses the cookie-backed auth client (lib/supabase-browser.ts), so a
 * signed-in user's access token is sent and the function rate-limits them
 * by their verified user ID. Signed-out visitors send the anonymous session
 * ID instead (TEA-52).
 */
export async function invokeConcertQuery(body: ConcertQueryBody) {
  const sessionId = await getOrCreateLunaSessionId(browserStorage());

  return createClient().functions.invoke("concert-query", {
    body,
    headers: { [LUNA_SESSION_ID_HEADER]: sessionId },
  });
}

export default function LunaSearch({
  onSearchStart,
  onSearchSuccess,
  onSearchError,
}: {
  /** Fired before the concert request begins, so the page can reset its own
   *  filters and show its loading state. */
  onSearchStart: (interpretation?: string) => void;
  onSearchSuccess: (concerts: NormalizedConcert[]) => void;
  onSearchError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = query.trim();

    if (!trimmed) {
      setInterpretError("Describe the kind of show you're looking for.");
      return;
    }

    setIsInterpreting(true);
    setInterpretError(null);

    let result: ConcertQueryResponse;

    try {
      const timeZone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

      result = await interpretConcertQuery(
        invokeConcertQuery,
        trimmed,
        timeZone,
        requestBrowserLocation,
      );
    } catch (error) {
      setIsInterpreting(false);
      setInterpretError(
        error instanceof Error ? error.message : "Concert query failed.",
      );
      return;
    }

    setIsInterpreting(false);
    // Hand off to the existing concert search flow: same /api/concerts route,
    // same result shape, same card grid the structured search renders into.
    onSearchStart(result.interpretation);

    try {
      const search = buildConcertsQuery(
        result.ticketmasterParams,
        result.filters,
      );
      const response = await fetch(`/api/concerts?${search}`);
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

  return (
    <div className="mx-auto w-full max-w-xl">
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="flex w-full flex-col gap-2 sm:flex-row sm:items-center"
      >
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/20 bg-black/40 px-4 py-3 backdrop-blur-sm transition-colors focus-within:border-primary/60">
          <Sparkles size={16} className="shrink-0 text-primary" />
          <input
            type="text"
            name="luna"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask Luna: chill jazz shows under $60 this weekend..."
            className="w-full flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50"
          />
        </div>

        <button
          type="submit"
          disabled={isInterpreting}
          className="shrink-0 cursor-pointer rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isInterpreting ? "Asking Luna..." : "Ask Luna"}
        </button>
      </form>

      {interpretError && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {interpretError}
        </p>
      )}
    </div>
  );
}