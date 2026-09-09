// supabase/functions/_shared/flightStatus.ts
//
// Looks up a real flight's status via AeroDataBox (through RapidAPI).
// Field names below are confirmed against an ACTUAL response captured
// during setup, not guessed from documentation alone:
//
//   [{
//     "departure": { "airport": {...}, "scheduledTime": { "utc": "2026-09-09 12:10Z", "local": "..." } },
//     "arrival": {
//       "airport": {...},
//       "scheduledTime": { "utc": "2026-09-09 13:20Z", "local": "..." },
//       "revisedTime": { "utc": "2026-09-09 12:46Z", "local": "..." }   <- optional, only present when it differs
//     },
//     "number": "EI 3193",
//     "status": "Arrived",
//     "airline": { "name": "Aer Lingus", "iata": "EI", "icao": "EIN" }
//   }]
//
// Two real things confirmed by that captured response, not assumed:
//   1. The response is always an ARRAY, even for a single flight+date query.
//   2. `revisedTime` can be EARLIER than `scheduledTime` (the flight that
//      was captured arrived early, not late) — delay must be a signed
//      difference, not a one-directional "is it late" check.
//
// Deliberately uses the DATE-SPECIFIC endpoint
// (/flights/number/{flightNumber}/{dateLocal}), not the "nearest day"
// one — confirmed during setup that the nearest-day endpoint can
// silently return a completely different flight under the same number
// if the exact one requested isn't the closest match to right now.
//
// Cost discipline: this should be called sparingly — once when a
// booking with a flight number is created, and once more a few hours
// before pickup (see send-ride-reminders) — never on a polling loop.
// AeroDataBox billing is per-call; continuous polling is what makes a
// flight-tracking feature expensive, a single validation + single
// pre-pickup recheck is not.

interface FlightLookupResult {
  found: boolean;
  status: string | null;
  scheduledArrivalUtc: string | null; // ISO string
  revisedArrivalUtc: string | null; // ISO string, only set if it actually differs from scheduled
  delayMinutes: number | null; // positive = later than scheduled, negative = earlier
  airlineName: string | null;
  error?: string;
}

/**
 * AeroDataBox returns UTC timestamps as "YYYY-MM-DD HH:MMZ" (space
 * separator) — not valid ISO 8601 on its own (needs a "T", not a
 * space) for JS Date parsing. This normalizes it.
 */
function parseAeroDataBoxUtc(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const isoish = raw.replace(" ", "T");
  const parsed = new Date(isoish);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function lookupFlightStatus(flightNumber: string, dateLocal: string): Promise<FlightLookupResult> {
  const apiKey = Deno.env.get("AERODATABOX_API_KEY");
  const notFound: FlightLookupResult = {
    found: false,
    status: null,
    scheduledArrivalUtc: null,
    revisedArrivalUtc: null,
    delayMinutes: null,
    airlineName: null,
  };

  if (!apiKey) {
    // Not configured — quietly no-op, same principle as the push
    // notification sender: a missing key should never break a real
    // booking, it just means this feature silently does nothing yet.
    return { ...notFound, error: "not configured" };
  }

  try {
    const cleanNumber = flightNumber.replace(/\s+/g, "").toUpperCase();
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(cleanNumber)}/${dateLocal}?withAircraftImage=false&withLocation=false&withFlightPlan=false`;

    const res = await fetch(url, {
      headers: {
        "x-rapidapi-host": "aerodatabox.p.rapidapi.com",
        "x-rapidapi-key": apiKey,
      },
    });

    if (res.status === 204) return notFound; // AeroDataBox's documented "no content" response for a genuinely unmatched flight
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ...notFound, error: `AeroDataBox returned ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return notFound;

    const flight = data[0];
    const arrival = flight.arrival;
    if (!arrival) return { ...notFound, status: flight.status ?? null, found: true };

    const scheduledUtc = parseAeroDataBoxUtc(arrival.scheduledTime?.utc);
    const revisedUtc = parseAeroDataBoxUtc(arrival.revisedTime?.utc);

    let delayMinutes: number | null = null;
    if (scheduledUtc && revisedUtc) {
      delayMinutes = Math.round((new Date(revisedUtc).getTime() - new Date(scheduledUtc).getTime()) / 60000);
    }

    return {
      found: true,
      status: flight.status ?? null,
      scheduledArrivalUtc: scheduledUtc,
      revisedArrivalUtc: revisedUtc,
      delayMinutes,
      airlineName: flight.airline?.name ?? null,
    };
  } catch (err) {
    console.error("lookupFlightStatus error (non-fatal):", err);
    return { ...notFound, error: err instanceof Error ? err.message : "unexpected error" };
  }
}
