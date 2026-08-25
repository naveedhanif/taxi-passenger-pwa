// Ported verbatim from the already-tested fareCalculator.js (Node) —
// same logic, same test coverage applies conceptually. If you change
// the rules here, update and rerun the Node tests too so they stay
// in sync, since this is the one that actually runs in production.

export type TariffPeriod = "standard" | "premium" | "special";

export function getTariffPeriod(date: Date): TariffPeriod {
  const day = date.getDay();
  const hour = date.getHours();
  const month = date.getMonth();
  const dateOfMonth = date.getDate();

  const isWeekendLateNight = (day === 6 || day === 0) && hour >= 0 && hour < 4;

  const isChristmasWindow =
    (month === 11 && dateOfMonth === 24 && hour >= 20) ||
    (month === 11 && dateOfMonth === 25) ||
    (month === 11 && dateOfMonth === 26 && hour < 8);

  const isNewYearWindow =
    (month === 11 && dateOfMonth === 31 && hour >= 20) ||
    (month === 0 && dateOfMonth === 1 && hour < 8);

  if (isWeekendLateNight || isChristmasWindow || isNewYearWindow) {
    return "special";
  }

  const isWeekday = day >= 1 && day <= 6;
  const isDaytime = hour >= 8 && hour < 20;
  if (isWeekday && isDaytime) {
    return "standard";
  }

  return "premium";
}

export interface FareRule {
  id: string;
  name: string;
  tariff_period: TariffPeriod;
  base_rate: number;
  per_km_rate: number;
  per_minute_rate: number;
  minimum_fare: number;
  tariff_a_cap: number | null;
  tariff_b_per_km_rate: number | null;
  tariff_b_per_minute_rate: number | null;
  discount_percent: number;
  is_active: boolean;
}

export function selectFareRule(fareRules: FareRule[], tariffPeriod: TariffPeriod): FareRule | null {
  const active = fareRules.filter((r) => r.is_active);
  if (active.length === 0) return null;

  const exactMatch = active.find((r) => r.tariff_period === tariffPeriod);
  if (exactMatch) return exactMatch;

  const standardFallback = active.find((r) => r.tariff_period === "standard");
  if (standardFallback) return standardFallback;

  return active[0];
}

export interface FareBreakdown {
  baseFare: number;
  distanceCost: number;
  timeCost: number;
  tierBApplied: boolean;
  minimumFareApplied: boolean;
  discountPercent: number;
  discountAmount: number;
  preBookingFee: number;
  total: number;
}

// Mirrors fareCalculator.js exactly (the NTA two-tier structure — see
// that file's comments for the full explanation). Kept in sync
// manually since this Deno function can't import the frontend's .js
// file directly; if you change the fare math, change both places.
export function calculateFare(params: {
  distanceKm: number;
  durationMinutes: number;
  fareRule: FareRule;
  preBookingFee: number;
}): FareBreakdown {
  const { distanceKm, durationMinutes, fareRule, preBookingFee } = params;
  const {
    base_rate: baseRate,
    per_km_rate: tariffAKmRate,
    per_minute_rate: tariffAMinRate,
    minimum_fare: minimumFare,
    tariff_a_cap: tariffACap,
    tariff_b_per_km_rate: tariffBKmRate,
    tariff_b_per_minute_rate: tariffBMinRate,
  } = fareRule;

  const tariffACost = distanceKm * tariffAKmRate + durationMinutes * tariffAMinRate;

  let distanceCost: number;
  let timeCost: number;
  let tierBApplied = false;

  const hasTariffACap = tariffACap && tariffACap > 0;

  if (!hasTariffACap || tariffACost <= tariffACap) {
    if (!hasTariffACap) {
      distanceCost = distanceKm * (tariffBKmRate ?? tariffAKmRate);
      timeCost = durationMinutes * (tariffBMinRate ?? tariffAMinRate);
      tierBApplied = true;
    } else {
      distanceCost = distanceKm * tariffAKmRate;
      timeCost = durationMinutes * tariffAMinRate;
    }
  } else {
    tierBApplied = true;
    const fractionAtTariffA = tariffACap / tariffACost;
    const tariffADistance = distanceKm * fractionAtTariffA;
    const tariffATime = durationMinutes * fractionAtTariffA;
    const remainingDistance = distanceKm - tariffADistance;
    const remainingTime = durationMinutes - tariffATime;

    distanceCost = tariffADistance * tariffAKmRate + remainingDistance * (tariffBKmRate ?? tariffAKmRate);
    timeCost = tariffATime * tariffAMinRate + remainingTime * (tariffBMinRate ?? tariffAMinRate);
  }

  const subtotal = baseRate + distanceCost + timeCost;
  const beforeFees = Math.max(subtotal, minimumFare || 0);

  const discountPercent = fareRule.discount_percent || 0;
  const discountAmount = beforeFees * (discountPercent / 100);
  const afterDiscount = beforeFees - discountAmount;

  const total = afterDiscount + preBookingFee;

  const round2 = (n: number) => Math.round(n * 100) / 100;

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

export function eurosToStripeCents(amountInEuros: number): number {
  return Math.round(amountInEuros * 100);
}

