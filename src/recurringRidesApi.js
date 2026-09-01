/**
 * List, add, delete, and toggle a signed-in customer's recurring ride
 * templates. See manage-recurring-rides/index.ts for why these are
 * templates that pre-fill the booking form, not automatically-charged
 * bookings.
 */
async function callRecurringRides(body, customerSessionToken) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/manage-recurring-rides`, {
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

export function listRecurringRides({ driverId, customerSessionToken }) {
  return callRecurringRides({ action: "list", driver_id: driverId }, customerSessionToken);
}

export function addRecurringRide({ driverId, customerSessionToken, label, pickup, dropoff, daysOfWeek, timeOfDay }) {
  return callRecurringRides(
    {
      action: "add",
      driver_id: driverId,
      label,
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_address: dropoff.address,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      days_of_week: daysOfWeek,
      time_of_day: timeOfDay,
    },
    customerSessionToken
  );
}

export function toggleRecurringRide({ driverId, customerSessionToken, rideId, active }) {
  return callRecurringRides({ action: "toggle", driver_id: driverId, ride_id: rideId, active }, customerSessionToken);
}

export function deleteRecurringRide({ driverId, customerSessionToken, rideId }) {
  return callRecurringRides({ action: "delete", driver_id: driverId, ride_id: rideId }, customerSessionToken);
}
