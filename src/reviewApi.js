/**
 * Submits a passenger's rating for a completed trip. Server-side
 * (submit-review Edge Function) enforces: the trip is actually
 * completed, the caller is authorized to review it, and only one
 * review per booking.
 *
 * @param {object} params
 * @param {string} params.bookingId
 * @param {string|null} [params.guestAccessToken]
 * @param {string|null} [params.customerSessionToken]
 * @param {number} params.rating - 1 to 5
 * @param {string} [params.comment]
 */
export async function submitReview({ bookingId, guestAccessToken, customerSessionToken, rating, comment }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/submit-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      booking_id: bookingId,
      access_token: guestAccessToken || null,
      rating,
      comment: comment || null,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { error: data.error || "Couldn't submit your review" };
  }
  return data;
}
