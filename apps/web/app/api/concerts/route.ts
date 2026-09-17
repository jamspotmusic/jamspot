import { NextRequest, NextResponse } from "next/server";
import { searchConcerts, TicketmasterApiError } from "@/lib/ticketmaster";

/**
 * GET /api/concerts?city=Dallas&stateCode=TX&startDateTime=...&endDateTime=...
 *
 * Thin wrapper around lib/ticketmaster.ts so the Ticketmaster API key never
 * reaches the browser (it's a plain, non-NEXT_PUBLIC env var) and both the
 * home page and future preference-matching logic can hit one endpoint.
 *
 * The `concert-query` Edge Function emits these same param names, so its
 * output can be handed straight to this route - including the geolocated form
 * (`geoPoint` + `radius`) and the price bounds Ticketmaster can't filter on.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  function normalizeCity(city: string) {
    return city
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizeStateCode(state: string) {
    return state.trim().toUpperCase();
  }

  /** Reads a positive number, treating a malformed value as absent. */
  function numberParam(name: string) {
    const raw = searchParams.get(name);
    if (raw === null) return undefined;

    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  const cityParam = searchParams.get("city");
  const stateCodeParam = searchParams.get("stateCode");
  const countryCodeParam = searchParams.get("countryCode");
  const geoPointParam = searchParams.get("geoPoint");

  const city = cityParam ? normalizeCity(cityParam) : undefined;
  const stateCode = stateCodeParam ? normalizeStateCode(stateCodeParam) : undefined;
  const countryCode = countryCodeParam
    ? normalizeStateCode(countryCodeParam)
    : undefined;
  const postalCode = searchParams.get("postalCode") ?? undefined;
  // A base32 geohash such as "9q9p1dhfd" - anything else is dropped rather
  // than passed on. Note geohash base32 omits a, i, l, and o.
  const geoPoint =
    geoPointParam && /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(geoPointParam.trim())
      ? geoPointParam.trim()
      : undefined;
  const radius = numberParam("radius");
  const unit = searchParams.get("unit") === "km" ? "km" : "miles";
  const keyword = searchParams.get("keyword") ?? undefined;
  const classificationName = searchParams.get("classificationName") ?? undefined;
  const startDateTime = searchParams.get("startDateTime") ?? undefined;
  const endDateTime = searchParams.get("endDateTime") ?? undefined;
  const sort = searchParams.get("sort") ?? undefined;
  const minPrice = numberParam("minPrice");
  const maxPrice = numberParam("maxPrice");

  // classificationName counts: it's only ever set when the caller explicitly
  // narrowed to a genre, which is what a nationwide "chill" search reduces to.
  if (
    !city &&
    !stateCode &&
    !postalCode &&
    !countryCode &&
    !geoPoint &&
    !keyword &&
    !classificationName
  ) {
    return NextResponse.json(
      {
        error:
          "Provide at least one of: city, stateCode, postalCode, countryCode, geoPoint, keyword, classificationName",
      },
      { status: 400 }
    );
  }

  // TEA-52 observability. Structured searches go straight to Ticketmaster
  // and never touch the Luna rate limiter. Luna's handoff tags itself with
  // source=luna (see buildConcertsQuery), so it isn't counted here.
  if (searchParams.get("source") !== "luna") {
    console.info(
      JSON.stringify({
        event: "luna_rate_limit_bypass",
        route: "direct_ticketmaster",
      })
    );
  }

  try {
    const concerts = await searchConcerts({
      city,
      stateCode,
      postalCode,
      countryCode,
      geoPoint,
      radius,
      unit,
      keyword,
      classificationName,
      startDateTime,
      endDateTime,
      sort,
      minPrice,
      maxPrice,
    });

    return NextResponse.json({ concerts });
  } catch (err) {
    if (err instanceof TicketmasterApiError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: "Unexpected error while fetching concerts" },
      { status: 500 }
    );
  }
}