// supabase/functions/list-messages/index.ts
//
// Fetches chat history for a booking. Same authorization pattern as
// send-message — see that file for the full reasoning.
//
// Deploy: supabase functions deploy list-messages
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id) return jsonError("Missing required field: booking_id", 400);

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

    let authorized = false;
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
        if (driverRow) authorized = true;

        if (!authorized && booking.customer_id) {
          const { data: customerRow } = await supabase
            .from("customers")
            .select("id")
            .eq("id", booking.customer_id)
            .eq("user_id", userData.user.id)
            .maybeSingle();
          if (customerRow) authorized = true;
        }
      }
    }
    if (!authorized && body.access_token && booking.access_token && body.access_token === booking.access_token) {
      authorized = true;
    }
    if (!authorized) return jsonError("Not authorized for this booking", 403);

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("id, sender_role, body, created_at")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: true });
    if (messagesError) return jsonError(messagesError.message, 500);

    return new Response(JSON.stringify({ messages: messages ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("list-messages error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
