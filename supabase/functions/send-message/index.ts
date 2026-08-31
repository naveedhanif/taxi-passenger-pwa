// supabase/functions/send-message/index.ts
//
// In-app chat tied to a specific booking — an addition to, not a
// replacement for, the existing tap-to-call/WhatsApp buttons. Keeping
// communication inside the platform means a record exists if there's
// ever a dispute.
//
// Requires this table, run once in the Supabase SQL editor before
// deploying:
//
//   CREATE TABLE messages (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     booking_id uuid NOT NULL REFERENCES bookings(id),
//     sender_role text NOT NULL CHECK (sender_role IN ('driver', 'passenger')),
//     body text NOT NULL,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//   ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
//   -- No public policies needed — send-message/list-messages (service
//   -- role) are the only intended way to read/write this table.
//
// AUTHORIZATION: either the driver who owns the booking (their session
// matched against drivers.user_id), or the passenger who made it
// (guest access_token match, or their customer session) — the same
// two-sided pattern as cancel-booking/get-booking-status.
//
// Deploy: supabase functions deploy send-message
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
  body: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id) return jsonError("Missing required field: booking_id", 400);
    if (!body.body || !body.body.trim()) return jsonError("Message can't be empty", 400);
    if (body.body.length > 1000) return jsonError("Message is too long", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, driver_id, customer_id, access_token")
      .eq("id", body.booking_id)
      .single();
    if (bookingError || !booking) return jsonError("Booking not found", 404);

    // ---- Authorize: driver session, guest access_token, or customer session ----
    let senderRole: "driver" | "passenger" | null = null;
    const authHeader = req.headers.get("Authorization");

    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userData?.user) {
        const { data: driverRow } = await supabase
          .from("drivers")
          .select("id")
          .eq("id", booking.driver_id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (driverRow) senderRole = "driver";

        if (!senderRole && booking.customer_id) {
          const { data: customerRow } = await supabase
            .from("customers")
            .select("id")
            .eq("id", booking.customer_id)
            .eq("user_id", userData.user.id)
            .maybeSingle();
          if (customerRow) senderRole = "passenger";
        }
      }
    }

    if (!senderRole && body.access_token && booking.access_token && body.access_token === booking.access_token) {
      senderRole = "passenger";
    }

    if (!senderRole) return jsonError("Not authorized for this booking", 403);

    const { data: message, error: insertError } = await supabase
      .from("messages")
      .insert({ booking_id: booking.id, sender_role: senderRole, body: body.body.trim() })
      .select("id, sender_role, body, created_at")
      .single();
    if (insertError) return jsonError(insertError.message, 500);

    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-message error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
