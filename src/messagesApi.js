/**
 * In-app chat tied to a booking. Same auth pattern as the rest of the
 * booking-status functions — pass whichever of guestAccessToken /
 * customerSessionToken applies.
 */
async function callMessages(path, body, customerSessionToken) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) return { error: data.error || "Something went wrong" };
  return data;
}

export function listMessages({ bookingId, guestAccessToken, customerSessionToken }) {
  return callMessages("list-messages", { booking_id: bookingId, access_token: guestAccessToken || null }, customerSessionToken);
}

export function sendMessage({ bookingId, guestAccessToken, customerSessionToken, body }) {
  return callMessages("send-message", { booking_id: bookingId, access_token: guestAccessToken || null, body }, customerSessionToken);
}
