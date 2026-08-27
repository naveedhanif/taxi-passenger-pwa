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
