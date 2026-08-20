/**
 * Splits a customer's bookings into "upcoming" (still active/scheduled)
 * and "past" (completed or canceled), each sorted so the most relevant
 * one is first — soonest upcoming first, most recent past first.
 */
const ACTIVE_STATUSES = ["pending", "confirmed", "en_route", "arrived", "in_progress"];
const PAST_STATUSES = ["completed", "canceled"];

function categorizeBookings(bookings) {
  const upcoming = bookings
    .filter((b) => ACTIVE_STATUSES.includes(b.status))
    .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));

  const past = bookings
    .filter((b) => PAST_STATUSES.includes(b.status))
    .sort((a, b) => new Date(b.scheduled_time) - new Date(a.scheduled_time));

  return { upcoming, past };
}

export { categorizeBookings, ACTIVE_STATUSES, PAST_STATUSES };

