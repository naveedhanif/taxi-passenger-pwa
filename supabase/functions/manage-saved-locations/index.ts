// supabase/functions/manage-saved-locations/index.ts
//
// The other half of "saved locations" — AccountHistoryScreen already
// had the UI built for this, but App.jsx always passed it an empty
// array. Only meaningful for signed-in customers (guests don't have a
// persistent account to save anything to).
//
// Requires this table, run once in the Supabase SQL editor before
// deploying:
//
//   CREATE TABLE saved_locations (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
//     label text NOT NULL,
//     address text NOT NULL,
//     lat double precision,
//     lng double precision,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//   ALTER TABLE saved_locations ENABLE ROW LEVEL SECURITY;
//   -- No public policies needed — this function uses the service role
//   -- and is the only intended way to read/write this table.
//
// AUTHORIZATION: always requires a signed-in customer session — there's
// no guest-token path here, matching the rest of the account/history
// feature.
//
// Deploy: supabase functions deploy manage-saved-locations
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  action: "list" | "add" | "delete";
  driver_id: string;
  label?: string;
  address?: string;
  lat?: number;
  lng?: number;
  location_id?: string;
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
        .from("saved_locations")
        .select("id, label, address, lat, lng")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: true });
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ locations: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "add") {
      if (!body.label || !body.address) return jsonError("Missing required field: label, address", 400);
      const { data, error } = await supabase
        .from("saved_locations")
        .insert({
          customer_id: customer.id,
          label: body.label,
          address: body.address,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
        })
        .select("id, label, address, lat, lng")
        .single();
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ location: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "delete") {
      if (!body.location_id) return jsonError("Missing required field: location_id", 400);
      // Scoped to this customer's own id too, not just the location_id —
      // stops one customer from being able to delete another's saved
      // location just by guessing/enumerating ids.
      const { error } = await supabase
        .from("saved_locations")
        .delete()
        .eq("id", body.location_id)
        .eq("customer_id", customer.id);
      if (error) return jsonError(error.message, 500);
      return new Response(JSON.stringify({ deleted: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return jsonError("Unknown action", 400);
  } catch (err) {
    console.error("manage-saved-locations error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
