// supabase/functions/notify-status-push/index.ts
//
// Called by the driver app right after it updates a booking's status
// (AllBookingsScreen.tsx does that update directly against the table
// via the client — there's no existing edge function in the middle to
// hook into for this specific action). This pushes the passenger a
// real, closed-app-reaching notification for the stages that actually
// matter to them — not every status, see STATUS_MESSAGES below.
//
// Reads the booking's CURRENT status from the database rather than
// trusting anything the client sends about what it changed it to —
// same "never trust the client's claim" reasoning as everywhere else,
// even though the stakes here (a notification's wording) are much
// lower than a payment amount.
//
// AUTHORIZATION: the driver's own signed-in session, matched against
// drivers.user_id and that they actually own this booking — same
// pattern as get-driver-reviews.
//
// Deploy: supabase functions deploy notify-status-push
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushToTarget } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_MESSAGES: Record<string, { title: string; body: string }> = {
  en_route: { title: "Your driver is on the way", body: "Track your trip for a live ETA." },
  arrived: { title: "Your driver has arrived", body: "Head out when you're ready." },
  in_progress: { title: "Your trip has started", body: "Have a safe ride." },
  completed: { title: "Trip completed", body: "Thanks for riding — you can rate your trip in the app." },
};

interface RequestBody {
  booking_id: string;
  driver_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id || !body.driver_id) return jsonError("Missing required field: booking_id, driver_id", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonError("Not signed in", 401);

    const { data: driver } = await supabase.from("drivers").select("id, user_id").eq("id", body.driver_id).single();
    if (!driver || driver.user_id !== userData.user.id) return jsonError("Not authorized for this driver account", 403);

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, customer_id, status, driver_id")
      .eq("id", body.booking_id)
      .eq("driver_id", body.driver_id)
      .single();
    if (!booking) return jsonError("Booking not found", 404);

    const message = STATUS_MESSAGES[booking.status];
    let sent = false;
    if (message && booking.customer_id) {
      await sendPushToTarget(supabase, { type: "customer", customerId: booking.customer_id }, { ...message, url: "/?screen=status" });
      sent = true;
    }
    // No message for this status, or a guest booking (no customer_id
    // to push to) — both are expected, non-error outcomes.

    return new Response(JSON.stringify({ sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("notify-status-push error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
