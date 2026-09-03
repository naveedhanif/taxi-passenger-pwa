/**
 * Gets (or lazily generates) the signed-in customer's own referral
 * code, plus the driver's current reward percent — always read fresh
 * from the driver's real configured value, never hardcoded here.
 */
export async function getMyReferralCode({ driverId, customerSessionToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/get-my-referral-code`, {
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
  return data; // { referralCode, rewardPercent }
}
