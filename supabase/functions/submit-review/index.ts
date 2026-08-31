// supabase/functions/submit-review/index.ts
//
// The missing half of the ratings feature — the passenger app already
// displays a driver's avg_rating/review_count on the booking form, but
// nothing anywhere let a passenger actually submit one. Those numbers
// were frozen at whatever seed data existed.
//
// Requires two new things, run once in the Supabase SQL editor before
// deploying this function:
//
//   CREATE TABLE reviews (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
//     driver_id uuid NOT NULL REFERENCES drivers(id),
//     customer_id uuid REFERENCES customers(id),  -- null for a guest passenger
//     rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
//     comment text,
//     created_at timestamptz NOT NULL DEFAULT now()
//   );
//   ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
//   -- No public policies needed — this function uses the service role
//   -- and is the only intended way to write to this table.
//
// AUTHORIZATION: same two-path pattern as get-booking-status/
// cancel-booking — guest access_token match, or a signed-in customer's
// session matched against the booking's customer_id.
//
// Deploy: supabase functions deploy submit-review
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  booking_id: string;
  access_token?: string | null;
  rating: number;
  comment?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    if (!body.booking_id) return jsonError("Missing required field: booking_id", 400);
    if (!body.rating || body.rating < 1 || body.rating > 5) {
      return jsonError("Rating must be between 1 and 5", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, driver_id, customer_id, access_token, status")
      .eq("id", body.booking_id)
      .single();

    if (bookingError || !booking) return jsonError("Booking not found", 404);

    if (booking.status !== "completed") {
      return jsonError("This trip hasn't been completed yet", 400);
    }

    // ---- Authorize: guest access_token match OR signed-in customer match ----
    let authorized = false;
    if (body.access_token && booking.access_token && body.access_token === booking.access_token) {
      authorized = true;
    }
    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (userData?.user && booking.customer_id) {
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
    if (!authorized) return jsonError("Not authorized to review this booking", 403);

    // One review per booking — the UNIQUE constraint on booking_id
    // enforces this at the DB level too, this just gives a clean error
    // message instead of a raw constraint-violation one.
    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("booking_id", booking.id)
      .maybeSingle();
    if (existing) return jsonError("This trip has already been reviewed", 400);

    const { error: insertError } = await supabase.from("reviews").insert({
      booking_id: booking.id,
      driver_id: booking.driver_id,
      customer_id: booking.customer_id,
      rating: body.rating,
      comment: body.comment || null,
    });
    if (insertError) return jsonError(`Couldn't save review: ${insertError.message}`, 500);

    // Recompute the driver's aggregate from real data, rather than
    // trusting a running counter that could drift — cheap enough given
    // review volume for a single driver, and always correct.
    const { data: allReviews, error: aggError } = await supabase
      .from("reviews")
      .select("rating")
      .eq("driver_id", booking.driver_id);

    if (!aggError && allReviews && allReviews.length > 0) {
      const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
      await supabase
        .from("drivers")
        .update({ avg_rating: Math.round(avg * 10) / 10, review_count: allReviews.length })
        .eq("id", booking.driver_id);
    }

    return new Response(JSON.stringify({ submitted: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("submit-review error:", err);
    return jsonError(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
