// supabase/functions/get-driver-availability/index.ts
//
// Lets the passenger app check whether a driver has manually marked
// themselves online/offline for the day — a separate concept from
// "busy right now" (which is derived from having an active trip and
// already exposed via public_driver_profiles.is_available).
//
// This does NOT extend the existing public_driver_profiles view. That
// view already backs several other features (fare rules, ratings,
// phone number, vehicle info) and its exact current definition isn't
// visible from here — blindly redefining it risks silently dropping
// something another feature depends on. A small dedicated function
// avoids that risk entirely: it reads directly from `drivers` (RLS-
// locked to the owning driver) via the service role key, and only
// ever returns the one boolean a passenger is allowed to see.
//
// Requires: an `is_online` boolean column on `drivers`. Run this once
// in the Supabase SQL editor before deploying:
//   ALTER TABLE drivers ADD COLUMN is_online boolean NOT NULL DEFAULT true;
//
// Deploy: supabase functions deploy get-driver-availability
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id) {
      return jsonError("Missing required field: driver_id", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase
      .from("drivers")
      .select("is_online")
      .eq("id", body.driver_id)
      .maybeSingle();

    if (error) {
      return jsonError(error.message, 500);
    }

    // Defaults to true (online) if the row/column is somehow missing —
    // fails open so a driver isn't accidentally hidden from bookings
    // due to a data gap rather than a deliberate choice.
    return new Response(
      JSON.stringify({ isOnline: data?.is_online ?? true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-driver-availability error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
