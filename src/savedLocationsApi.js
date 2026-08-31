/**
 * List, add, and delete a signed-in customer's saved locations
 * (Home/Work/etc). Guest passengers don't have access to this — there's
 * no persistent account to save anything to.
 */
async function callSavedLocations(body, customerSessionToken) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/manage-saved-locations`, {
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

export function listSavedLocations({ driverId, customerSessionToken }) {
  return callSavedLocations({ action: "list", driver_id: driverId }, customerSessionToken);
}

export function addSavedLocation({ driverId, customerSessionToken, label, address, lat, lng }) {
  return callSavedLocations({ action: "add", driver_id: driverId, label, address, lat, lng }, customerSessionToken);
}

export function deleteSavedLocation({ driverId, customerSessionToken, locationId }) {
  return callSavedLocations({ action: "delete", driver_id: driverId, location_id: locationId }, customerSessionToken);
}
