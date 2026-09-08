/**
 * Calls the get-booking-status Edge Function — the real data source for
 * the live tracking screen (passenger-booking-status.jsx). Replaces the
 * hardcoded mock coordinates/driver name that screen used to render.
 *
 * @param {object} params
 * @param {string} params.bookingId
 * @param {string|null} [params.guestAccessToken] - the per-booking token returned by createBooking; omit for a signed-in customer
 * @param {string|null} [params.customerSessionToken] - the signed-in customer's Supabase session access token; omit for a guest
 */
export async function getBookingStatus({ bookingId, guestAccessToken, customerSessionToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/get-booking-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ booking_id: bookingId, access_token: guestAccessToken || null }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { error: data.error || "Couldn't load this booking" };
  }
  return data;
}

/**
 * Cancels a booking that hasn't progressed past "confirmed" yet, and
 * triggers a real Stripe refund (via cancel-booking/index.ts) for
 * whatever was actually charged — full fare or deposit. This used to
 * only flip the booking's status with no refund at all; now the server
 * response includes whether the refund actually succeeded, so the UI
 * can say so accurately rather than just assuming it worked.
 *
 * @returns {Promise<{canceled:true, refunded:boolean, refundError:string|null} | {error:string}>}
 */
export async function cancelBooking({ bookingId, guestAccessToken, customerSessionToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/cancel-booking`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ booking_id: bookingId, access_token: guestAccessToken || null }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { error: data.error || "Couldn't cancel this booking" };
  }
  return data;
}

/**
 * Changes pickup/drop-off/scheduled time on a booking that hasn't
 * progressed past "confirmed" yet — the same window cancelBooking
 * already uses, not a separately invented rule. See
 * modify-booking/index.ts for the full real-route + fare
 * recalculation this triggers server-side.
 *
 * @param {object} params
 * @param {string} params.bookingId
 * @param {string|null} [params.guestAccessToken]
 * @param {string|null} [params.customerSessionToken]
 * @param {{address:string, lat:number, lng:number}} params.pickup
 * @param {{address:string, lat:number, lng:number}} params.dropoff
 * @param {string} params.scheduledTime - ISO string
 * @returns {Promise<{modified:true, newFare:number, fareDifference:number, needsManualSettlement:boolean} | {error:string}>}
 */
export async function modifyBooking({ bookingId, guestAccessToken, customerSessionToken, pickup, dropoff, scheduledTime }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/modify-booking`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      booking_id: bookingId,
      access_token: guestAccessToken || null,
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_address: dropoff.address,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      scheduled_time: scheduledTime,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { error: data.error || "Couldn't modify this booking" };
  }
  return data;
}
