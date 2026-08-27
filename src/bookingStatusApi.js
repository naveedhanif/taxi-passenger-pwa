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
  return callGetBookingStatus({ bookingId, guestAccessToken, customerSessionToken, action: "get" });
}

/**
 * Cancels a booking that hasn't progressed past "confirmed" yet. See
 * get-booking-status/index.ts's SELF_CANCELABLE_STATUSES for exactly
 * which states allow this — once a driver is en route, the server
 * rejects the cancel and the passenger needs to contact the driver
 * directly instead.
 */
export async function cancelBooking({ bookingId, guestAccessToken, customerSessionToken }) {
  return callGetBookingStatus({ bookingId, guestAccessToken, customerSessionToken, action: "cancel" });
}

async function callGetBookingStatus({ bookingId, guestAccessToken, customerSessionToken, action }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/get-booking-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      booking_id: bookingId,
      access_token: guestAccessToken || null,
      action,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error || "Couldn't load this booking" };
  }

  return data;
}
