// supabase/functions/get-customer-bookings/index.ts
//
// Powers the real Account History screen — replaces the hardcoded
// DEMO_BOOKINGS / DEMO_CUSTOMER ("Sarah Kelly") that AccountHistoryScreen
// previously always rendered, since App.jsx never passed it real props.
//
// Only for signed-in customers (guest passengers don't get a persistent
// multi-booking history — see customerAuth.js's design note: a customer
// account is scoped to one driver, created at signup). Authorization is
// the caller's real Supabase session — this function resolves it to a
// customer_id for the given driver_id and returns only that customer's
// own bookings, via the service role key (bypasses RLS, but the
// filtering below is exactly what enforces access control here).
//
// Deploy: supabase functions deploy get-customer-bookings
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError("Not signed in", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !userData?.user) {
      return jsonError("Not signed in", 401);
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, name, phone, email")
      .eq("user_id", userData.user.id)
      .eq("driver_id", body.driver_id)
      .single();

    if (customerError || !customer) {
      return jsonError("No account found with this driver", 404);
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("id, status, scheduled_time, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, estimated_fare, final_fare, passenger_name, passenger_phone, passenger_email")
      // awaiting_payment bookings are unpaid/abandoned attempts — not a
      // real booking, shouldn't clutter the passenger's own history
      // either, same exclusion used everywhere else in the platform.
      .neq("status", "awaiting_payment")
      .eq("customer_id", customer.id)
      .order("scheduled_time", { ascending: false });

    if (bookingsError) {
      return jsonError(`Couldn't load bookings: ${bookingsError.message}`, 500);
    }

    return new Response(
      JSON.stringify({ customer, bookings: bookings ?? [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("get-customer-bookings error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
