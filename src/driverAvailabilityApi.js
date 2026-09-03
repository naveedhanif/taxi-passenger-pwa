/**
 * Calls the get-driver-availability Edge Function — whether the driver
 * has manually marked themselves online/offline for the day, is
 * outside their working-hours schedule, or is on a short break.
 * Separate from public_driver_profiles.is_available, which reflects
 * "busy with an active trip right now" rather than "not working today
 * at all."
 *
 * @param {string} driverId
 * @returns {Promise<{isOnline: boolean, breakUntil: string|null}>} defaults to online (true) if the check fails, so a transient error never wrongly hides a driver who's actually working
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
    if (!response.ok) return { isOnline: true, breakUntil: null };
    return { isOnline: data.isOnline !== false, breakUntil: data.breakUntil || null };
  } catch {
    return { isOnline: true, breakUntil: null };
  }
}

/**
 * Fetches driver/vehicle photo URLs for the main booking form, before
 * any booking exists. Returns nulls on any failure — a missing photo
 * is just not shown, never a blocking error.
 */
export async function getDriverPhotos(driverId) {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/get-driver-photos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ driver_id: driverId }),
    });
    const data = await response.json();
    if (!response.ok) return { driverPhotoUrl: null, vehiclePhotoUrl: null };
    return data;
  } catch {
    return { driverPhotoUrl: null, vehiclePhotoUrl: null };
  }
}
