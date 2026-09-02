/**
 * Looks up any active promo code available for this driver — targeted
 * to the signed-in customer if one exists, otherwise a broadcast code.
 * Display-only: create-booking independently re-validates whatever
 * promo id gets sent along with the actual booking.
 *
 * Works for guests too (customerSessionToken omitted) — they can only
 * see broadcast promos, never a targeted one.
 */
export async function getActivePromo({ driverId, customerSessionToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/get-active-promo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ driver_id: driverId }),
  });
  const data = await response.json();
  if (!response.ok) return { error: data.error || "Something went wrong" };
  return data; // { promo: { id, code, discountType, discountValue } | null }
}
