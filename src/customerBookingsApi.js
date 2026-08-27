/**
 * Calls the get-customer-bookings Edge Function — the real data source
 * for AccountHistoryScreen. Replaces the hardcoded DEMO_BOOKINGS /
 * DEMO_CUSTOMER ("Sarah Kelly") that screen previously always showed,
 * since nothing ever passed it real props.
 *
 * @param {object} params
 * @param {string} params.driverId
 * @param {string} params.customerSessionToken - the signed-in customer's Supabase session access token
 * @returns {Promise<{customer, bookings} | {error: string}>}
 */
export async function getCustomerBookings({ driverId, customerSessionToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/get-customer-bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerSessionToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ driver_id: driverId }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error || "Couldn't load your account" };
  }

  return data;
}
