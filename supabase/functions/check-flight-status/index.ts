// supabase/functions/check-flight-status/index.ts
//
// Public-facing flight lookup for the marketing website's interactive
// hero — lets a visitor type a real flight number and see its real
// status before they've booked anything, as a genuine demonstration
// of the flight-tracking feature rather than a claim about it.
//
// COST GUARDRAIL, worth being explicit about: AeroDataBox is a paid
// API. This function has no per-visitor rate limiting of its own —
// the real safeguard is on the frontend, which only calls this on an
// explicit button click, never on every keystroke, so volume stays
// tied to genuine visitor intent rather than being fully open-ended.
// If this page gets meaningful traffic, revisit adding real rate
// limiting here (e.g. by IP) rather than assuming click-gating alone
// is sufficient forever.
//
// Deploy: supabase functions deploy check-flight-status

import { lookupFlightStatus } from "../_shared/flightStatus.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  flight_number: string;
  date_local?: string; // defaults to today if not given
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    const flightNumber = body.flight_number?.trim();
    if (!flightNumber) {
      return new Response(JSON.stringify({ error: "Missing flight_number" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const dateLocal = body.date_local || new Date().toISOString().slice(0, 10);
    const result = await lookupFlightStatus(flightNumber, dateLocal);

    return new Response(
      JSON.stringify({
        found: result.found,
        status: result.status,
        scheduledArrivalUtc: result.scheduledArrivalUtc,
        revisedArrivalUtc: result.revisedArrivalUtc,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-flight-status error:", err);
    return new Response(JSON.stringify({ error: "Couldn't check that flight right now" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
