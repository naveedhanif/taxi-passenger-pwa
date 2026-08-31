/**
 * Creates a Stripe PaymentIntent for a post-trip tip. Only usable once
 * the trip is completed — server-side enforced, see
 * create-tip-payment/index.ts.
 *
 * @param {object} params
 * @param {string} params.bookingId
 * @param {string|null} [params.guestAccessToken]
 * @param {string|null} [params.customerSessionToken]
 * @param {number} params.amount - euros
 */
export async function createTipPayment({ bookingId, guestAccessToken, customerSessionToken, amount }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/create-tip-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ booking_id: bookingId, access_token: guestAccessToken || null, amount }),
  });

  const data = await response.json();
  if (!response.ok) return { error: data.error || "Couldn't set up the tip payment" };
  return data;
}
