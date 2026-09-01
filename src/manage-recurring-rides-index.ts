// supabase/functions/manage-recurring-rides/index.ts
//
// Recurring ride TEMPLATES — not automatic bookings. A passenger saves
// a trip (e.g. "Morning commute, Mon-Fri, 8am"); on a matching day the
// booking form shows a one-tap banner that pre-fills everything, but
// the passenger still confirms and pays normally every time.
//
// Deliberately NOT building genuine unattended recurring billing here
// — that needs a saved payment method (Stripe setup_future_usage) and
// off-session charging, which has real failure modes (3D Secure can
// still trigger off-session, cards expire, declines need a
// notification workflow) that need hands-on device/Stripe-dashboard
// testing to get right. Building that blind and calling it done would
// contradict every other "verify before trusting it" decision made
// throughout this project.
//
// Requires this table, run once in the Supabase SQL editor before
// deploying:
//
//   CREATE TABLE recurring_rides (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
//     driver_id uuid NOT NULL REFERENCES drivers(id),
//     label text NOT NULL,
//     pickup_address text NOT NULL,
//     pickup_lat double precision NOT NULL,
//     pickup_lng double precision NOT NULL,
//     dropoff_address text NOT NULL,
//     dropoff_lat double precision NOT NULL,
//     dropoff_lng double precision NOT NULL,
//     days_of_week jsonb NOT NULL,
//     time_of_day text NOT NULL,
//     active boolean NOT NULL DEFAULT true,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//   ALTER TABLE recurring_rides ENABLE ROW LEVEL SECURITY;
//
// AUTHORIZATION: signed-in customer only, matched against the row's
// own customer_id — same pattern as saved locations.
//
// Deploy: supabase functions deploy manage-recurring-rides
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  action: "list" | "add" | "delete" | "toggle";
  driver_id: string;
  label?: string;
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_address?: string;
  dropoff_lat?: number;
  dropoff_lng?: number;
  days_of_week?: string[];
  time_of_day?: string;
  ride_id?: string;
  active?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.action || !body.driver_id) {
      return jsonError("Missing required field: action, driver_id", 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("Not signed in", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) return jsonError("Not signed in", 401);

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("driver_id", body.driver_id)
      .single();
    if (customerError || !customer) return jsonError("No account found with this driver", 404);

    if (body.action === "list") {
      const { data, error } = await supabase
        .from("recurring_rides")
        .select("id, label, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, days_of_week, time_of_day, active")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: true });
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ rides: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "add") {
      const required = ["label", "pickup_address", "pickup_lat", "pickup_lng", "dropoff_address", "dropoff_lat", "dropoff_lng", "days_of_week", "time_of_day"];
      for (const field of required) {
        if (body[field as keyof RequestBody] === undefined) return jsonError(`Missing required field: ${field}`, 400);
      }
      if (!Array.isArray(body.days_of_week) || body.days_of_week.length === 0) {
        return jsonError("days_of_week must be a non-empty array", 400);
      }
      const { data, error } = await supabase
        .from("recurring_rides")
        .insert({
          customer_id: customer.id,
          driver_id: body.driver_id,
          label: body.label,
          pickup_address: body.pickup_address,
          pickup_lat: body.pickup_lat,
          pickup_lng: body.pickup_lng,
          dropoff_address: body.dropoff_address,
          dropoff_lat: body.dropoff_lat,
          dropoff_lng: body.dropoff_lng,
          days_of_week: body.days_of_week,
          time_of_day: body.time_of_day,
        })
        .select("id, label, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, days_of_week, time_of_day, active")
        .single();
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ ride: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "toggle") {
      if (!body.ride_id || body.active === undefined) return jsonError("Missing required field: ride_id, active", 400);
      const { error } = await supabase
        .from("recurring_rides")
        .update({ active: body.active })
        .eq("id", body.ride_id)
        .eq("customer_id", customer.id);
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ updated: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "delete") {
      if (!body.ride_id) return jsonError("Missing required field: ride_id", 400);
      const { error } = await supabase
        .from("recurring_rides")
        .delete()
        .eq("id", body.ride_id)
        .eq("customer_id", customer.id);
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ deleted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return jsonError("Unknown action", 400);
  } catch (err) {
    console.error("manage-recurring-rides error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
