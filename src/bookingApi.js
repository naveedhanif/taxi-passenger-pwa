/**
 * Calls the create-booking Edge Function — the ONLY way a booking
 * should ever be created. The client sends what the passenger typed;
 * the server independently recalculates the real route and fare and
 * ignores anything the client claims about pricing. See
 * supabase/functions/create-booking/index.ts for the server side.
 *
 * NOT LIVE-TESTED — this needs the Edge Function actually deployed
 * (`supabase functions deploy create-booking`) before this call does
 * anything but fail. Written to match Supabase's documented Edge
 * Function invocation pattern exactly.
 *
 * @param {object} params
 * @param {string} params.driverId
 * @param {string} params.passengerName
 * @param {string} params.passengerPhone
 * @param {string|null} [params.passengerEmail] - optional; if provided, Stripe emails a receipt to this address on successful payment
 * @param {{address:string, lat:number, lng:number}} params.pickup
 * @param {{address:string, lat:number, lng:number}} params.dropoff
 * @param {{address:string, lat:number, lng:number}[]} [params.stops] - intermediate stops, in order
 * @param {Date} params.scheduledTime
 * @param {"now"|"later"} params.paymentTiming
 * @param {string|null} params.accessToken - the signed-in user's Supabase session token, if any; omit for guest bookings
 * @returns {Promise<{bookingId, accessToken, clientSecret, fare, distanceKm, durationMinutes, tariffPeriod, paymentTiming, depositAmount, balanceDue} | {error: string}>}
 */
export async function createBooking({ driverId, passengerName, passengerPhone, passengerEmail, pickup, dropoff, stops, scheduledTime, paymentTiming, accessToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/create-booking`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Guests use the anon key; a signed-in customer's own session
      // token takes priority so the Edge Function can resolve their
      // real customer_id instead of treating them as a guest.
      Authorization: `Bearer ${accessToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      driver_id: driverId,
      passenger_name: passengerName,
      passenger_phone: passengerPhone,
      passenger_email: passengerEmail || null,
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_address: dropoff.address,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      stops: (stops || []).map((s) => ({ address: s.address, lat: s.lat, lng: s.lng })),
      scheduled_time: scheduledTime.toISOString(),
      payment_timing: paymentTiming || "now",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error || "Something went wrong creating your booking" };
  }

  return data;
}

