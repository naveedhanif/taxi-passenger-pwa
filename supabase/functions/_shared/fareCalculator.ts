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
  minimumFareApplied: boolean;
  preBookingFee: number;
  total: number;
}

export function calculateFare(params: {
  distanceKm: number;
  durationMinutes: number;
  fareRule: FareRule;
  preBookingFee: number;
}): FareBreakdown {
  const { distanceKm, durationMinutes, fareRule, preBookingFee } = params;
  const distanceCost = distanceKm * fareRule.per_km_rate;
  const timeCost = durationMinutes * fareRule.per_minute_rate;
  const subtotal = fareRule.base_rate + distanceCost + timeCost;
  const beforeFees = Math.max(subtotal, fareRule.minimum_fare);
  const total = beforeFees + preBookingFee;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    baseFare: round2(fareRule.base_rate),
    distanceCost: round2(distanceCost),
    timeCost: round2(timeCost),
    minimumFareApplied: subtotal < fareRule.minimum_fare,
    preBookingFee: round2(preBookingFee),
    total: round2(total),
  };
}

export function eurosToStripeCents(amountInEuros: number): number {
  return Math.round(amountInEuros * 100);
}

