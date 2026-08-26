"use client";

import {
  useState,
  type FormEvent,
} from "react";

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type TicketmasterParams = {
  city?: string;
  stateCode?: string;
  postalCode?: string;
  keyword?: string;
  startDateTime?: string;
  endDateTime?: string;
};

export type ConcertQueryResponse = {
  query: string;
  ticketmasterParams: TicketmasterParams;
  meta?: {
    model?: string;
    timeZone?: string;
    currentDateTime?: string;
  };
};

export function buildConcertsUrl(
  params: TicketmasterParams,
): string {
  const searchParams = new URLSearchParams();

  if (params.city) {
    searchParams.set("city", params.city);
  }

  if (params.stateCode) {
    searchParams.set(
      "stateCode",
      params.stateCode,
    );
  }

  if (params.postalCode) {
    searchParams.set(
      "postalCode",
      params.postalCode,
    );
  }

  if (params.keyword) {
    searchParams.set(
      "keyword",
      params.keyword,
    );
  }

  if (params.startDateTime) {
    searchParams.set(
      "startDateTime",
      params.startDateTime,
    );
  }

  if (params.endDateTime) {
    searchParams.set(
      "endDateTime",
      params.endDateTime,
    );
  }

  return `/api/concerts?${searchParams.toString()}`;
}

export async function getFunctionErrorMessage(
  error: unknown,
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = (await error.context.json()) as {
        error?: unknown;
      };

      if (typeof payload.error === "string") {
        return payload.error;
      }
    } catch {
      return error.message;
    }
  }

  if (error instanceof FunctionsRelayError) {
    return `Supabase relay error: ${error.message}`;
  }

  if (error instanceof FunctionsFetchError) {
    return `Unable to reach Supabase Edge Function: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Concert query failed.";
}

export default function TestConcertQueryPage() {
  const [query, setQuery] = useState(
    "jazz in Oakland this weekend",
  );

  const [queryResult, setQueryResult] =
    useState<ConcertQueryResponse | null>(
      null,
    );

  const [
    ticketmasterResponse,
    setTicketmasterResponse,
  ] = useState<unknown>(null);

  const [queryError, setQueryError] =
    useState<string | null>(null);

  const [
    ticketmasterError,
    setTicketmasterError,
  ] = useState<string | null>(null);

  const [
    isInterpreting,
    setIsInterpreting,
  ] = useState(false);

  const [
    isSearchingTicketmaster,
    setIsSearchingTicketmaster,
  ] = useState(false);

  async function handleInterpret(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      setQueryError(
        "Enter a concert search query.",
      );
      return;
    }

    setIsInterpreting(true);
    setQueryError(null);
    setTicketmasterError(null);
    setQueryResult(null);
    setTicketmasterResponse(null);

    try {
      const timeZone =
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone || "UTC";

      const { data, error } =
        await supabase.functions.invoke(
          "concert-query",
          {
            body: {
              query: normalizedQuery,
              timeZone,
            },
          },
        );

      if (error) {
        throw new Error(
          await getFunctionErrorMessage(error),
        );
      }

      if (
        !data ||
        typeof data !== "object" ||
        !("ticketmasterParams" in data)
      ) {
        throw new Error(
          "Concert query returned an invalid response.",
        );
      }

      setQueryResult(
        data as ConcertQueryResponse,
      );
    } catch (error) {
      setQueryError(
        error instanceof Error
          ? error.message
          : "Concert query failed.",
      );
    } finally {
      setIsInterpreting(false);
    }
  }

  async function handleTicketmasterSearch() {
    if (!queryResult) {
      return;
    }

    setIsSearchingTicketmaster(true);
    setTicketmasterError(null);
    setTicketmasterResponse(null);

    try {
      const url = buildConcertsUrl(
        queryResult.ticketmasterParams,
      );

      const response = await fetch(url);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Ticketmaster request failed (${response.status})`,
        );
      }

      setTicketmasterResponse(data);
    } catch (error) {
      setTicketmasterError(
        error instanceof Error
          ? error.message
          : "Ticketmaster request failed.",
      );
    } finally {
      setIsSearchingTicketmaster(false);
    }
  }

  const ticketmasterUrl = queryResult
    ? buildConcertsUrl(
        queryResult.ticketmasterParams,
      )
    : null;

  const hasExplicitLocation =
    Boolean(
      queryResult?.ticketmasterParams.city ||
        queryResult?.ticketmasterParams
          .stateCode ||
        queryResult?.ticketmasterParams
          .postalCode,
    );

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-bold">
        GPT Concert Query Test
      </h1>

      <p className="mt-2 text-sm text-gray-600">
        Convert a natural-language query into
        Ticketmaster-compatible parameters, then
        optionally run the search through JamSpot.
      </p>

      <form
        onSubmit={handleInterpret}
        className="mt-8 flex gap-3"
      >
        <input
          type="text"
          value={query}
          onChange={(event) =>
            setQuery(event.target.value)
          }
          placeholder="e.g. punk shows in Los Angeles next Friday"
          className="flex-1 rounded border px-3 py-2"
        />

        <button
          type="submit"
          disabled={isInterpreting}
          className="rounded border px-4 py-2 disabled:opacity-50"
        >
          {isInterpreting
            ? "Interpreting..."
            : "Ask Luna"}
        </button>
      </form>

      {queryError && (
        <section className="mt-8">
          <h2 className="font-semibold">
            Concert query error
          </h2>

          <pre className="mt-2 whitespace-pre-wrap rounded border p-4 text-sm">
            {queryError}
          </pre>
        </section>
      )}

      {queryResult && (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              Original query
            </h2>

            <pre className="mt-2 whitespace-pre-wrap rounded border p-4 text-sm">
              {queryResult.query}
            </pre>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              Ticketmaster parameters
            </h2>

            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border p-4 text-sm">
              {JSON.stringify(
                queryResult.ticketmasterParams,
                null,
                2,
              )}
            </pre>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              Location
            </h2>

            <p className="mt-2 text-sm">
              {hasExplicitLocation
                ? "Location was extracted from the query."
                : "No location was supplied. JamSpot did not request or infer the user's location."}
            </p>
          </section>

          {queryResult.meta && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">
                Edge Function metadata
              </h2>

              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border p-4 text-sm">
                {JSON.stringify(
                  queryResult.meta,
                  null,
                  2,
                )}
              </pre>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">
              JamSpot Ticketmaster request
            </h2>

            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded border p-4 text-sm">
              {ticketmasterUrl}
            </pre>

            <button
              type="button"
              onClick={
                handleTicketmasterSearch
              }
              disabled={
                isSearchingTicketmaster
              }
              className="mt-4 rounded border px-4 py-2 disabled:opacity-50"
            >
              {isSearchingTicketmaster
                ? "Searching Ticketmaster..."
                : "Run Ticketmaster Search"}
            </button>
          </section>
        </>
      )}

      {ticketmasterError && (
        <section className="mt-8">
          <h2 className="font-semibold">
            Ticketmaster error
          </h2>

          <pre className="mt-2 whitespace-pre-wrap rounded border p-4 text-sm">
            {ticketmasterError}
          </pre>
        </section>
      )}

      {ticketmasterResponse !== null && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Ticketmaster response
          </h2>

          <pre className="mt-2 max-h-[800px] overflow-auto whitespace-pre-wrap rounded border p-4 text-sm">
            {JSON.stringify(
              ticketmasterResponse,
              null,
              2,
            )}
          </pre>
        </section>
      )}
    </main>
  );
}