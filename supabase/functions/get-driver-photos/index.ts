// supabase/functions/get-driver-photos/index.ts
//
// Lets the passenger app show a driver's profile photo and vehicle
// photo on the main booking form, before any booking exists — at that
// point there's no booking_id yet for get-booking-status to key off of.
//
// Same reasoning as get-driver-availability for why this is a small
// dedicated function instead of extending the shared
// public_driver_profiles/public_vehicle_profiles views: those views
// back several other features and their exact current definition
// isn't visible from here, so a new column added directly to
// `drivers`/`vehicles` needs its own safe read path rather than a
// blind view redefinition.
//
// Requires:
//   ALTER TABLE drivers ADD COLUMN photo_url text;
//   ALTER TABLE vehicles ADD COLUMN photo_url text;
// (both likely already exist if the driver-photo-upload feature was
// deployed already)
//
// Deploy: supabase functions deploy get-driver-photos
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
    if (!body.driver_id) return jsonError("Missing required field: driver_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const [driverRes, vehicleRes] = await Promise.all([
      supabase.from("drivers").select("photo_url").eq("id", body.driver_id).maybeSingle(),
      supabase.from("vehicles").select("photo_url").eq("driver_id", body.driver_id).eq("is_active", true).maybeSingle(),
    ]);

    return new Response(
      JSON.stringify({
        driverPhotoUrl: driverRes.data?.photo_url ?? null,
        vehiclePhotoUrl: vehicleRes.data?.photo_url ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-driver-photos error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
