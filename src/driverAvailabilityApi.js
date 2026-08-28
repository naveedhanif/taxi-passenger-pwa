/**
 * Calls the get-driver-availability Edge Function — whether the driver
 * has manually marked themselves online/offline for the day. Separate
 * from public_driver_profiles.is_available, which reflects "busy with
 * an active trip right now" rather than "not working today at all."
 *
 * @param {string} driverId
 * @returns {Promise<boolean>} defaults to true (online) if the check fails, so a transient error never wrongly hides a driver who's actually working
 */
export async function getDriverOnlineStatus(driverId) {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/get-driver-availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ driver_id: driverId }),
    });
    const data = await response.json();
    if (!response.ok) return true;
    return data.isOnline !== false;
  } catch {
    return true;
  }
}
