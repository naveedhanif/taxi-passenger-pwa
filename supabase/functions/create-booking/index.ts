// supabase/functions/create-booking/index.ts
//
// SECURITY PRINCIPLE: the fare amount is NEVER trusted from the client.
// A passenger's browser sends pickup/dropoff/time; this function always
// independently recalculates distance, duration, and fare server-side
// before creating a Stripe PaymentIntent. If a malicious client sent a
// fake low fare, it's simply ignored — this function computes its own.
//
// PAYMENT MODEL: a passenger picks one of two payment_timing options:
//   "now"   — full fare charged upfront via Stripe, exactly as before.
//   "later" — only driver.pay_later_deposit_amount is charged now (via
//             Stripe), to secure the booking. The rest is paid to the
//             driver directly in the taxi (cash or card via the
//             driver's own card reader) after the ride, and is not
//             processed by this platform at all — the dashboard just
//             lets the driver mark payment_method + mark the balance
//             collected once the trip completes.
//
// BOOKING VISIBILITY: this function creates a Stripe PaymentIntent but
// does NOT charge the card — the passenger confirms payment on the next
// screen. A booking must not appear on the driver's dashboard, and must
// not lock the driver's availability, until that payment (or deposit)
// has actually succeeded. So bookings are inserted with
// status="awaiting_payment" here; confirm-booking-payment/index.ts
// flips it to "pending" only after independently verifying with Stripe
// that the PaymentIntent succeeded. See public_driver_profiles and
// AllBookingsScreen/OverviewDashboard for the matching exclusion of
// awaiting_payment from what a driver sees as an active booking.
//
// AVAILABILITY: a driver with any booking in an active state
// (pending/confirmed/en_route/arrived/in_progress — NOT
// awaiting_payment) is treated as busy and rejected here — enforced
// server-side, not just hidden in the UI, since a client could
// otherwise race a stale "available" state.
//
// Deploy: supabase functions deploy create-booking
// Required secrets (supabase secrets set):
//   MAPBOX_TOKEN            - server-side Mapbox token
//   STRIPE_SECRET_KEY       - Stripe secret key (never the publishable one)
//   PLATFORM_FEE_PERCENT    - e.g. "10" for a 10% platform cut (see note below)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - auto-provided by Supabase

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import {
  getTariffPeriod,
  calculateFare,
  selectFareRule,
  eurosToStripeCents,
  type FareRule,
} from "../_shared/fareCalculator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Excludes "awaiting_payment" deliberately — see BOOKING VISIBILITY note
// above. A booking only becomes "pending" (and therefore visible/
// availability-locking) once payment is confirmed.
const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "en_route", "arrived", "in_progress"];

interface BookingRequest {
  driver_id: string;
  passenger_name: string;
  passenger_phone: string;
  passenger_email?: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  stops?: { address: string; lat: number; lng: number }[];
  scheduled_time: string; // ISO string
  payment_timing: "now" | "later";
  // Optional — from get-active-promo's display-only lookup. Re-validated
  // completely independently here; the client's claim about which promo
  // applies (or that one applies at all) is never trusted.
  promo_code_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: BookingRequest = await req.json();

    // ---- Basic input validation ----
    const required = [
      "driver_id", "passenger_name", "passenger_phone",
      "pickup_address", "pickup_lat", "pickup_lng",
      "dropoff_address", "dropoff_lat", "dropoff_lng", "scheduled_time",
      "payment_timing",
    ];
    for (const field of required) {
      if (body[field as keyof BookingRequest] === undefined || body[field as keyof BookingRequest] === null) {
        return jsonError(`Missing required field: ${field}`, 400);
      }
    }
    if (body.payment_timing !== "now" && body.payment_timing !== "later") {
      return jsonError("payment_timing must be 'now' or 'later'", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Look up the driver (must exist and be active) ----
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, is_active, stripe_connect_account_id, stripe_connect_onboarded, pre_booking_fee, pay_later_deposit_amount")
      .eq("id", body.driver_id)
      .single();

    if (driverError || !driver) {
      return jsonError("Driver not found", 404);
    }
    if (!driver.is_active) {
      return jsonError("This driver isn't currently accepting bookings", 400);
    }
    if (!driver.stripe_connect_onboarded || !driver.stripe_connect_account_id) {
      return jsonError("This driver hasn't finished payment setup yet", 400);
    }

    // ---- Availability check: reject only if the driver has a CONFLICTING trip ----
    // Server-side, not just a UI hide — the passenger app checks this via
    // public_driver_profiles.is_available before showing the booking
    // form, but that read could be stale by the time they submit, so it
    // must be re-checked here as the actual gate.
    //
    // Uses is_driver_available_at(), which checks for real TIME OVERLAP
    // against the requested scheduled_time — not just "does any active
    // booking exist". A booking two days from now must not block a
    // passenger trying to book for right now; only a booking whose
    // estimated window (scheduled_time through busy_expires_at) actually
    // contains the requested time counts as a conflict.
    const { data: availabilityCheck, error: availabilityError } = await supabase.rpc(
      "is_driver_available_at",
      { p_driver_id: body.driver_id, p_requested_time: body.scheduled_time }
    );

    if (availabilityError) {
      return jsonError(`Couldn't check driver availability: ${availabilityError.message}`, 500);
    }
    if (availabilityCheck === false) {
      return jsonError("This driver already has a booking around that time — please choose a different time", 409);
    }

    // ---- Resolve customer_id if the request is authenticated ----
    // Per the platform's design, a customer row is created at SIGNUP time
    // within a specific driver's app, not lazily here. If an authenticated
    // user somehow has no matching row yet, fall back to guest behavior
    // rather than hard-failing the booking.
    let customerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (userData?.user) {
        const { data: customerRow } = await supabase
          .from("customers")
          .select("id")
          .eq("driver_id", body.driver_id)
          .eq("user_id", userData.user.id)
          .single();
        customerId = customerRow?.id ?? null;
      }
    }

    // ---- Get a REAL route from Mapbox (server-side, never trust client distance/time) ----
    // Stops (if any) are validated and included as waypoints in order —
    // Mapbox's Directions API returns the TOTAL distance/duration
    // across every leg in one request, so nothing downstream (the fare
    // calculation) needs to change at all to support them.
    const stops = Array.isArray(body.stops) ? body.stops : [];
    if (stops.length > 3) {
      return jsonError("A trip can have at most 3 stops", 400);
    }
    for (const stop of stops) {
      if (
        typeof stop.address !== "string" || !stop.address.trim() ||
        typeof stop.lat !== "number" || typeof stop.lng !== "number"
      ) {
        return jsonError("Each stop needs a valid address and coordinates", 400);
      }
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN")!;
    const allPoints = [
      { lat: body.pickup_lat, lng: body.pickup_lng },
      ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      { lat: body.dropoff_lat, lng: body.dropoff_lng },
    ];
    const coords = allPoints.map((p) => `${p.lng},${p.lat}`).join(";");
    const directionsRes = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
      `?access_token=${mapboxToken}&geometries=geojson&overview=full`
    );
    if (!directionsRes.ok) {
      const mapboxErrorBody = await directionsRes.text();
      console.error("Mapbox directions call failed:", directionsRes.status, mapboxErrorBody);
      return jsonError(
        `Mapbox request failed (${directionsRes.status}): ${mapboxErrorBody}`,
        502
      );
    }
    const directionsJson = await directionsRes.json();
    if (!directionsJson.routes || directionsJson.routes.length === 0) {
      return jsonError("No route found for this trip", 400);
    }
    const route = directionsJson.routes[0];
    const distanceKm = Math.round((route.distance / 1000) * 100) / 100;
    const durationMinutes = Math.round((route.duration / 60) * 10) / 10;

    // ---- Determine tariff period + fare rule ----
    const scheduledTime = new Date(body.scheduled_time);
    const tariffPeriod = getTariffPeriod(scheduledTime);

    const { data: fareRules } = await supabase
      .from("fare_rules")
      .select("id, name, tariff_period, base_rate, per_km_rate, per_minute_rate, minimum_fare, tariff_a_cap, tariff_b_per_km_rate, tariff_b_per_minute_rate, discount_percent, is_active")
      .eq("driver_id", body.driver_id);

    const fareRule = selectFareRule((fareRules as FareRule[]) || [], tariffPeriod);
    if (!fareRule) {
      return jsonError("This driver hasn't set up pricing yet", 400);
    }

    const fare = calculateFare({
      distanceKm,
      durationMinutes,
      fareRule,
      preBookingFee: driver.pre_booking_fee,
    });

    // ---- Validate + apply a promo code, if one was requested ----
    // Entirely independent of whatever the client displayed via
    // get-active-promo — that lookup is a convenience preview only.
    // A promo either isn't usable (wrong customer, inactive, expired,
    // used up) or it's silently ignored rather than failing the whole
    // booking, since by the time this runs the passenger has already
    // committed to the trip; a promo that quietly stopped being valid
    // between viewing the fare estimate and confirming shouldn't block
    // them from booking at all, just from getting the discount.
    //
    // IMPORTANT: a promo code REPLACES the driver's standing per-tariff
    // discount (fare_rules.discount_percent) rather than stacking with
    // it — this is a deliberate driver-facing rule, not a bug. fare.total
    // already has that standing discount baked in (see fareCalculator.ts),
    // so to apply a promo instead we first add it back to recover the
    // pre-any-discount amount, then apply only the promo discount to that.
    const fareBeforeAnyDiscount = Math.round((fare.total + fare.discountAmount) * 100) / 100;

    let promo: { id: string; discount_type: "percent" | "fixed"; discount_value: number } | null = null;
    let promoDiscountAmount = 0;
    if (body.promo_code_id) {
      const { data: promoRow } = await supabase
        .from("promo_codes")
        .select("id, discount_type, discount_value, customer_id, driver_id, active, max_uses, uses_count, expires_at")
        .eq("id", body.promo_code_id)
        .single();

      const isUsable =
        promoRow &&
        promoRow.driver_id === body.driver_id &&
        promoRow.active === true &&
        (promoRow.expires_at == null || new Date(promoRow.expires_at) > new Date()) &&
        (promoRow.max_uses == null || promoRow.uses_count < promoRow.max_uses) &&
        // Broadcast (customer_id null) is usable by anyone; a targeted
        // code only by the exact customer it was made for — and a
        // guest (customerId null) can never redeem a targeted code.
        (promoRow.customer_id == null || promoRow.customer_id === customerId);

      if (isUsable) {
        promo = { id: promoRow!.id, discount_type: promoRow!.discount_type, discount_value: promoRow!.discount_value };
        // FIXED BUG: this used to always divide discount_value by 100
        // as if every promo were a percentage — a driver-created
        // "€5 off" fixed promo was silently computed as "5% off"
        // instead, which for a typical fare is a tiny fraction of the
        // intended discount. Now branches on the promo's real type.
        const rawDiscount =
          promo.discount_type === "percent"
            ? fareBeforeAnyDiscount * (promo.discount_value / 100)
            : promo.discount_value;
        promoDiscountAmount = Math.round(Math.min(rawDiscount, fareBeforeAnyDiscount) * 100) / 100;
      }
    }

    // No promo: unchanged from before — fare.total already has the
    // standing discount applied. Promo present: standing discount is
    // dropped and only the promo discount counts.
    const discountedTotal = promo
      ? Math.round((fareBeforeAnyDiscount - promoDiscountAmount) * 100) / 100
      : fare.total;


    // ---- Work out what's actually charged now vs owed later ----
    const payLater = body.payment_timing === "later";
    const depositAmount = payLater ? Number(driver.pay_later_deposit_amount) : 0;
    const chargeNowAmount = payLater ? depositAmount : discountedTotal;
    const balanceDue = payLater ? Math.round((discountedTotal - depositAmount) * 100) / 100 : null;

    if (payLater && depositAmount >= discountedTotal) {
      // Edge case: a very short/cheap trip (or a steep discount) where
      // the deposit would cover (or exceed) the whole fare. Don't
      // charge more than the fare, and don't create a confusing
      // zero/negative balance_due.
      return jsonError(
        "This trip's estimated fare is too low for pay-later — please choose pay now instead",
        400
      );
    }

    // ---- Create the Stripe PaymentIntent FIRST, before touching the database ----
    // ATOMICITY NOTE: this order matters. If we inserted the booking first
    // and Stripe failed afterward, we'd have an orphaned booking with no
    // payment path — a real customer-facing problem requiring a retry
    // that could create a duplicate. Creating the PaymentIntent first
    // means the worst failure case is an unused, unconfirmed
    // PaymentIntent if the booking insert fails afterward — and that
    // costs nothing and charges nobody, since Stripe PaymentIntents
    // don't move money until the customer confirms payment. This is
    // still two separate calls, not a single database transaction, but
    // it meaningfully reduces the blast radius of a partial failure.
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

    const platformFeePercent = Number(Deno.env.get("PLATFORM_FEE_PERCENT") ?? "10");
    const chargeNowCents = eurosToStripeCents(chargeNowAmount);
    const applicationFeeCents = Math.round(chargeNowCents * (platformFeePercent / 100));

    // Basic format guard — a malformed value here isn't a security issue
    // (Stripe validates server-side too), but catching it early gives a
    // clearer error than an opaque Stripe rejection.
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const receiptEmail =
      body.passenger_email && emailPattern.test(body.passenger_email) ? body.passenger_email : undefined;

    // A pay-later deposit still goes through Connect the same way a full
    // fare does — it's real money changing hands now, just a smaller
    // amount, and the driver still owes the platform its cut of it.
    //
    // receipt_email: if provided, Stripe automatically emails a receipt
    // once this PaymentIntent succeeds — no separate email-sending code
    // needed on our side. See https://docs.stripe.com/receipts.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeNowCents,
      currency: "eur",
      application_fee_amount: applicationFeeCents,
      transfer_data: { destination: driver.stripe_connect_account_id },
      receipt_email: receiptEmail,
      metadata: { payment_purpose: payLater ? "pay_later_deposit" : "full_fare" },
    });

    // ---- Now insert the booking ONCE, with the PaymentIntent id already attached ----
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        driver_id: body.driver_id,
        customer_id: customerId,
        passenger_name: body.passenger_name,
        passenger_phone: body.passenger_phone,
        passenger_email: receiptEmail ?? null,
        pickup_address: body.pickup_address,
        pickup_lat: body.pickup_lat,
        pickup_lng: body.pickup_lng,
        dropoff_address: body.dropoff_address,
        dropoff_lat: body.dropoff_lat,
        dropoff_lng: body.dropoff_lng,
        stops: stops,
        scheduled_time: body.scheduled_time,
        distance_km: distanceKm,
        // Feeds busy_expires_at (a database trigger — see
        // set_booking_busy_expires_at) which auto-clears this booking's
        // hold on driver availability if the trip runs far past its
        // estimate and the driver never marks it complete.
        estimated_duration_minutes: durationMinutes,
        estimated_fare: fare.total,
        promo_code_id: promo?.id ?? null,
        discount_amount: promoDiscountAmount,
        // Not yet visible to the driver and doesn't lock availability —
        // becomes "pending" only once confirm-booking-payment verifies
        // with Stripe that payment actually succeeded. See the
        // BOOKING VISIBILITY note at the top of this file.
        status: "awaiting_payment",
        payment_status: "unpaid",
        payment_timing: body.payment_timing,
        // For "later" bookings, payment_method/balance_collected are set
        // by the driver from the dashboard once the ride is done and
        // they know how the passenger actually paid the remainder. For
        // "now" bookings the full fare is already charged via Stripe, so
        // "card" is simply accurate immediately.
        payment_method: payLater ? null : "card",
        balance_collected: payLater ? false : true,
        deposit_amount: depositAmount,
        deposit_payment_status: "unpaid",
        deposit_stripe_payment_intent_id: payLater ? paymentIntent.id : null,
        balance_due: balanceDue,
        stripe_payment_intent_id: payLater ? null : paymentIntent.id,
      })
      .select("id, access_token")
      .single();

    if (bookingError || !booking) {
      // Booking insert failed AFTER Stripe succeeded — cancel the
      // now-orphaned PaymentIntent rather than leaving it dangling
      // indefinitely in the Stripe dashboard.
      await stripe.paymentIntents.cancel(paymentIntent.id).catch((cancelErr) => {
        console.error("Failed to cancel orphaned PaymentIntent:", cancelErr);
      });
      console.error("Booking insert failed:", bookingError);
      return jsonError(
        `Couldn't create the booking: ${bookingError?.message || "unknown database error"}`,
        500
      );
    }

    // Attach the booking id back onto the PaymentIntent's metadata, now
    // that we know it — a nice-to-have for reconciliation in the
    // Stripe dashboard, not required for the booking flow to work.
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: { booking_id: booking.id, payment_purpose: payLater ? "pay_later_deposit" : "full_fare" },
    });

    // Fire-and-forget: bump the promo's usage counter now that it's
    // actually been used. Doesn't fail or roll back the booking if
    // this errors — the booking and the charge have already both
    // genuinely succeeded, and worst case a promo's max_uses is
    // enforced slightly loosely under this specific failure mode
    // rather than the passenger losing an already-paid-for booking.
    if (promo) {
      const { error: usageError } = await supabase.rpc("increment_promo_uses", { p_promo_id: promo.id });
      if (usageError) {
        console.error("Failed to increment promo uses_count (non-fatal):", usageError);
      }
    }

    return new Response(
      JSON.stringify({
        bookingId: booking.id,
        accessToken: booking.access_token,
        clientSecret: paymentIntent.client_secret,
        fare,
        discountAmount: promoDiscountAmount,
        finalTotal: discountedTotal,
        distanceKm,
        durationMinutes,
        tariffPeriod,
        paymentTiming: body.payment_timing,
        depositAmount,
        balanceDue,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return jsonError(
      `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      500
    );
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

