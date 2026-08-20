/**
 * Determines which NTA tariff period applies to a given booking time.
 *
 * Rules (National Transport Authority, effective 01 Dec 2024):
 * - special: Sat/Sun 00:00–04:00, and a few fixed Christmas/New Year windows
 * - standard: Mon–Sat 08:00–20:00 (except public holidays)
 * - premium: everything else (nights, Sundays, public holidays)
 *
 * KNOWN LIMITATION: this does not check a real Irish public holiday
 * calendar yet — only the Christmas/New Year windows explicitly named
 * by the NTA are handled. A full public holiday list needs a real data
 * source (e.g. gov.ie's published bank holiday dates) wired in later.
 */
function getTariffPeriod(date) {
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = date.getHours();
  const month = date.getMonth(); // 0-indexed, 11 = December
  const dateOfMonth = date.getDate();

  // Special: Sat/Sun 00:00–04:00
  const isWeekendLateNight = (day === 6 || day === 0) && hour >= 0 && hour < 4;

  // Special: Christmas Eve 20:00 – St Stephen's Day (26th) 08:00
  const isChristmasWindow =
    (month === 11 && dateOfMonth === 24 && hour >= 20) ||
    (month === 11 && dateOfMonth === 25) ||
    (month === 11 && dateOfMonth === 26 && hour < 8);

  // Special: New Year's Eve 20:00 – New Year's Day 08:00
  const isNewYearWindow =
    (month === 11 && dateOfMonth === 31 && hour >= 20) ||
    (month === 0 && dateOfMonth === 1 && hour < 8);

  if (isWeekendLateNight || isChristmasWindow || isNewYearWindow) {
    return "special";
  }

  // Standard: Mon(1)–Sat(6), 08:00–20:00
  const isWeekday = day >= 1 && day <= 6;
  const isDaytime = hour >= 8 && hour < 20;
  if (isWeekday && isDaytime) {
    return "standard";
  }

  // Everything else (nights, all-day Sunday) is premium
  return "premium";
}

/**
 * Calculates an estimated fare.
 *
 * @param {object} params
 * @param {number} params.distanceKm - route distance in km (from Mapbox Directions)
 * @param {number} params.durationMinutes - TRAFFIC-AWARE route duration in minutes
 *   (this is the whole trick for "fare goes up when traffic is bad" — use
 *   Mapbox's traffic-aware duration, not the free-flow one, and the existing
 *   per-minute rate naturally makes a slower trip cost more, with no extra
 *   surge-pricing logic needed)
 * @param {object} params.fareRule - a row from fare_rules (base_rate, per_km_rate, per_minute_rate, minimum_fare)
 * @param {number} params.preBookingFee - from drivers.pre_booking_fee
 * @returns {object} breakdown + total, all rounded to 2 decimals
 */
function calculateFare({ distanceKm, durationMinutes, fareRule, preBookingFee }) {
  const distanceCost = distanceKm * fareRule.per_km_rate;
  const timeCost = durationMinutes * fareRule.per_minute_rate;
  const subtotal = fareRule.base_rate + distanceCost + timeCost;
  const beforeFees = Math.max(subtotal, fareRule.minimum_fare);
  const total = beforeFees + preBookingFee;

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    baseFare: round2(fareRule.base_rate),
    distanceCost: round2(distanceCost),
    timeCost: round2(timeCost),
    minimumFareApplied: subtotal < fareRule.minimum_fare,
    preBookingFee: round2(preBookingFee),
    total: round2(total),
  };
}

/**
 * Picks the right fare_rule row for a detected tariff period.
 * Falls back sensibly if a driver hasn't set up all three periods yet —
 * most drivers will start with just "standard" configured.
 *
 * @param {Array} fareRules - rows from fare_rules for one driver
 * @param {string} tariffPeriod - 'standard' | 'premium' | 'special'
 * @returns {object|null} the matching (or best available) fare rule
 */
function selectFareRule(fareRules, tariffPeriod) {
  const active = fareRules.filter((r) => r.is_active);
  if (active.length === 0) return null;

  const exactMatch = active.find((r) => r.tariff_period === tariffPeriod);
  if (exactMatch) return exactMatch;

  // Fall back to standard if the specific period isn't configured
  const standardFallback = active.find((r) => r.tariff_period === "standard");
  if (standardFallback) return standardFallback;

  // Last resort: whatever the driver has active at all
  return active[0];
}

export { getTariffPeriod, calculateFare, selectFareRule };

