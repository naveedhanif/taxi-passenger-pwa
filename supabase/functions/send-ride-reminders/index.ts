// supabase/functions/send-ride-reminders/index.ts
//
// Called on a schedule (every ~5 minutes — see reminders-01.sql for
// the two ways to set that up), not in response to any user action.
// Finds bookings whose scheduled_time is coming up within the next
// REMINDER_LEAD_MINUTES and haven't been reminded about yet, pushes
// the passenger (and a lighter heads-up to the driver), then marks
// them so they're never reminded twice even if this runs again a
// few minutes later and the row still technically matches.
//
// Deliberately only reminds about bookings that were made a
// meaningful amount of time in advance (see MIN_ADVANCE_BOOKING_MINUTES)
// — a passenger who just booked a ride for 20 minutes from now doesn't
// need a reminder, they know, they just booked it.
//
// NOT LIVE-TESTED — this sandbox has no real clock-driven cron to test
// against. Written to match the query logic exactly; first real test
// is watching it actually fire on a live schedule.
//
// AUTHORIZATION: none — this is only ever meant to be called by your
// own cron job using the service role key, never by a browser. It
// doesn't accept or trust any request body.
//
// Deploy: supabase functions deploy send-ride-reminders
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushToTarget } from "../_shared/pushSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_LEAD_MINUTES = 60;
const MIN_ADVANCE_BOOKING_MINUTES = 90; // only remind if it was booked at least this far ahead of its scheduled time

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const now = new Date();
    const reminderCutoff = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60000);

    const { data: dueBookings, error } = await supabase
      .from("bookings")
      .select("id, driver_id, customer_id, pickup_address, scheduled_time, created_at, status")
      .in("status", ["pending", "confirmed"])
      .eq("reminder_sent", false)
      .gt("scheduled_time", now.toISOString())
      .lte("scheduled_time", reminderCutoff.toISOString());

    if (error) return jsonError(error.message, 500);
    if (!dueBookings || dueBookings.length === 0) {
      return new Response(JSON.stringify({ remindersSent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let remindersSent = 0;
    const reminderedIds: string[] = [];

    for (const booking of dueBookings) {
      const leadMinutesAtBookingTime = (new Date(booking.scheduled_time).getTime() - new Date(booking.created_at).getTime()) / 60000;
      if (leadMinutesAtBookingTime < MIN_ADVANCE_BOOKING_MINUTES) {
        // Booked too close to its own scheduled time to need a
        // reminder — still mark it so it's not re-evaluated every run.
        reminderedIds.push(booking.id);
        continue;
      }

      const pickupTime = new Date(booking.scheduled_time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

      if (booking.customer_id) {
        await sendPushToTarget(
          supabase,
          { type: "customer", customerId: booking.customer_id },
          { title: "Your ride is coming up", body: `Pickup around ${pickupTime} at ${booking.pickup_address}.`, url: "/?screen=status" }
        );
      }
      // Guests have no persistent subscription to push to — no
      // reminder is possible for them today, same limitation as
      // everywhere else guests can't receive push.

      if (booking.driver_id) {
        await sendPushToTarget(
          supabase,
          { type: "driver", driverId: booking.driver_id },
          { title: "Upcoming ride", body: `Pickup around ${pickupTime} at ${booking.pickup_address}.`, url: "/?screen=bookings" }
        );
      }

      remindersSent++;
      reminderedIds.push(booking.id);
    }

    if (reminderedIds.length > 0) {
      await supabase.from("bookings").update({ reminder_sent: true }).in("id", reminderedIds);
    }

    return new Response(JSON.stringify({ remindersSent, checked: dueBookings.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-ride-reminders error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
