// supabase/functions/get-driver-availability/index.ts
//
// Lets the passenger app check whether a driver is actually taking
// bookings right now — combines two things: the driver's manual
// Online/Offline toggle, and (if they've set one) a weekly working-
// hours schedule. This is a separate concept from "busy right now"
// (which is derived from having an active trip and already exposed
// via public_driver_profiles.is_available).
//
// PRECEDENCE: manual OFF always wins immediately — a driver switching
// themselves offline stops new bookings regardless of what's
// scheduled. Manual ON means "online according to the schedule" if one
// is set (outside those hours, effectively offline even though the
// toggle itself still shows ON); if no schedule is set at all, manual
// ON simply means always-online, exactly how this worked before the
// schedule feature existed.
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
// Requires:
//   ALTER TABLE drivers ADD COLUMN is_online boolean NOT NULL DEFAULT true;
//   ALTER TABLE drivers ADD COLUMN working_hours jsonb;
// (the first one may already exist from an earlier deploy)
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

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

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
      .select("is_online, working_hours")
      .eq("id", body.driver_id)
      .maybeSingle();

    if (error) {
      return jsonError(error.message, 500);
    }

    // Fails open (true) if the row is somehow missing — a driver isn't
    // accidentally hidden from bookings due to a data gap rather than
    // a deliberate choice.
    const manualOnline = data?.is_online ?? true;
    let effectiveOnline = manualOnline;

    if (manualOnline && data?.working_hours) {
      // Server's own clock — deliberately not trusting a client-
      // supplied "current time", which could be spoofed or simply
      // wrong (wrong device timezone, etc). KNOWN LIMITATION: this
      // runs in UTC on Supabase's Edge Function runtime, not
      // necessarily the driver's own local timezone (e.g. Ireland is
      // UTC+0 in winter, UTC+1 in summer) — for a driver's schedule to
      // be exactly correct near midnight/day-boundary edge cases, the
      // driver's timezone would need to be stored and accounted for
      // explicitly. Not done here; the practical effect is the
      // computed "online" window could be off by up to an hour right
      // at the edges of a scheduled shift during summer time.
      const now = new Date();
      const todayKey = DAY_KEYS[now.getDay()];
      const todaySchedule = data.working_hours[todayKey];

      if (!todaySchedule) {
        // Explicitly marked as a day off in the schedule.
        effectiveOnline = false;
      } else {
        const [startH, startM] = todaySchedule.start.split(":").map(Number);
        const [endH, endM] = todaySchedule.end.split(":").map(Number);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        effectiveOnline = nowMinutes >= startMinutes && nowMinutes < endMinutes;
      }
    }

    return new Response(
      JSON.stringify({ isOnline: effectiveOnline }),
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
