// supabase/functions/notify-licence-submitted/index.ts
//
// Called by the driver app right after LicenceScreen.tsx successfully
// saves a genuinely NEW/changed SPSV licence number — pushes every
// registered owner so a submission doesn't just sit unseen until
// someone happens to open the Owner Dashboard. Licence verification is
// now a real gate (see _shared/driverAvailability.ts) that blocks a
// driver from going online at all, so getting eyes on a submission
// promptly actually matters to the driver, not just to you.
//
// Looks up the driver's own business_name/licence number server-side
// rather than trusting whatever the client sends about itself.
//
// AUTHORIZATION: the driver's own signed-in session, matched against
// drivers.user_id — same pattern as get-driver-reviews.
//
// Deploy: supabase functions deploy notify-licence-submitted
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushToAllAdmins } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  driver_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.driver_id) return jsonError("Missing required field: driver_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonError("Not signed in", 401);

    const { data: driver } = await supabase
      .from("drivers")
      .select("user_id, business_name, spsv_licence_number")
      .eq("id", body.driver_id)
      .single();
    if (!driver || driver.user_id !== userData.user.id) return jsonError("Not authorized for this driver account", 403);

    sendPushToAllAdmins(supabase, {
      title: "New licence submitted for review",
      body: `${driver.business_name || "A driver"} submitted licence ${driver.spsv_licence_number || ""} for verification.`,
      url: "/drivers",
    });

    return new Response(JSON.stringify({ sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("notify-licence-submitted error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
