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
 * Calculates an estimated fare using the NTA's official two-tier
 * structure (see https://www.transportforireland.ie/fares/taxi-fares/):
 *
 *   - Initial charge: covers the first ~500m / 85 seconds (baked into
 *     fareRule.base_rate).
 *   - Tariff A: per_km_rate / per_minute_rate apply for the next ~15km /
 *     43min, up to a capped total (fareRule.tariff_a_cap). Distance and
 *     time both accrue cost simultaneously (this mirrors how a taximeter
 *     actually runs — whichever of distance or time is "ticking" at a
 *     given moment is what a real meter charges for, but since this is
 *     an upfront estimate rather than a live meter, both rates are
 *     applied across the full trip and the NTA's own online estimator
 *     does the same simplification).
 *   - Tariff B: once the Tariff A cost hits its cap, the higher
 *     tariff_b_per_km_rate / tariff_b_per_minute_rate apply to whatever
 *     distance/time remains.
 *
 * A driver-set discount (fareRule.discount_percent) is then applied to
 * the ride fare only, before adding the pre-booking fee.
 *
 * @param {object} params
 * @param {number} params.distanceKm - route distance in km (from Mapbox Directions)
 * @param {number} params.durationMinutes - TRAFFIC-AWARE route duration in minutes
 * @param {object} params.fareRule - a row from fare_rules (NTA-fixed rates + driver discount)
 * @param {number} params.preBookingFee - from drivers.pre_booking_fee
 * @returns {object} breakdown + total, all rounded to 2 decimals
 */
function calculateFare({ distanceKm, durationMinutes, fareRule, preBookingFee }) {
  const {
    base_rate: baseRate,
    per_km_rate: tariffAKmRate,
    per_minute_rate: tariffAMinRate,
    minimum_fare: minimumFare,
    tariff_a_cap: tariffACap,
    tariff_b_per_km_rate: tariffBKmRate,
    tariff_b_per_minute_rate: tariffBMinRate,
  } = fareRule;

  // Tariff A cost if the whole trip were charged at the Tariff A rate.
  const tariffACost = distanceKm * tariffAKmRate + durationMinutes * tariffAMinRate;

  let distanceCost;
  let timeCost;
  let tierBApplied = false;

  // tariff_a_cap of 0 (or unset) means Tariff A doesn't apply at all for
  // this period — go straight to Tariff B after the initial charge, per
  // the NTA's Special Rate structure.
  const hasTariffACap = tariffACap && tariffACap > 0;

  if (!hasTariffACap || tariffACost <= tariffACap) {
    // Entire trip fits within Tariff A (or this period has no Tariff A).
    if (!hasTariffACap) {
      distanceCost = distanceKm * (tariffBKmRate ?? tariffAKmRate);
      timeCost = durationMinutes * (tariffBMinRate ?? tariffAMinRate);
      tierBApplied = true;
    } else {
      distanceCost = distanceKm * tariffAKmRate;
      timeCost = durationMinutes * tariffAMinRate;
    }
  } else {
    // Trip exceeds the Tariff A cap — the portion of distance/time
    // needed to reach the cap is charged at Tariff A; everything beyond
    // that is charged at the higher Tariff B rate.
    tierBApplied = true;
    const fractionAtTariffA = tariffACap / tariffACost; // 0-1
    const tariffADistance = distanceKm * fractionAtTariffA;
    const tariffATime = durationMinutes * fractionAtTariffA;
    const remainingDistance = distanceKm - tariffADistance;
    const remainingTime = durationMinutes - tariffATime;

    const tariffAPortion = tariffADistance * tariffAKmRate + tariffATime * tariffAMinRate; // == tariffACap
    const tariffBPortion =
      remainingDistance * (tariffBKmRate ?? tariffAKmRate) +
      remainingTime * (tariffBMinRate ?? tariffAMinRate);

    distanceCost = tariffADistance * tariffAKmRate + remainingDistance * (tariffBKmRate ?? tariffAKmRate);
    timeCost = tariffATime * tariffAMinRate + remainingTime * (tariffBMinRate ?? tariffAMinRate);
  }

  const subtotal = baseRate + distanceCost + timeCost;
  const beforeFees = Math.max(subtotal, minimumFare || 0);

  // Discount applies to the ride fare only, not the pre-booking fee —
  // set per fare_rule by the driver (fare_rules.discount_percent, 0-100).
  const discountPercent = fareRule.discount_percent || 0;
  const discountAmount = beforeFees * (discountPercent / 100);
  const afterDiscount = beforeFees - discountAmount;

  const total = afterDiscount + preBookingFee;

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    baseFare: round2(baseRate),
    distanceCost: round2(distanceCost),
    timeCost: round2(timeCost),
    tierBApplied,
    minimumFareApplied: subtotal < (minimumFare || 0),
    discountPercent,
    discountAmount: round2(discountAmount),
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

