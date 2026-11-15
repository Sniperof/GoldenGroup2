// ============================================================
// fx.ts — USD-linked installment arithmetic (shared API + web)
// ============================================================
// Rates are SYP per 1 USD. Contract prices stay in SYP; an installment
// confirmed under the USD link carries a fixed amount_usd. At collection the
// remaining USD is converted with the rate of the payment day and rounded to
// the nearest multiple of the configured unit.
// ============================================================

export const DEFAULT_FX_ROUNDING_UNIT = 1000;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/** USD equivalent of an SYP amount at `rate`, rounded to cents. */
export function usdFromSyp(amountSyp: number, rate: number): number {
  if (!(rate > 0)) return 0;
  return round2(amountSyp / rate);
}

/** SYP equivalent of a USD amount at `rate`, rounded to whole SYP. */
export function sypFromUsd(amountUsd: number, rate: number): number {
  if (!(rate > 0)) return 0;
  return Math.round(amountUsd * rate);
}

/** Nearest multiple of `unit` (unit <= 0 → whole SYP). */
export function roundToUnit(value: number, unit: number): number {
  if (!(unit > 0)) return Math.round(value);
  return Math.round(value / unit) * unit;
}

export interface UsdDueInput {
  remainingUsd: number;
  dayRate: number;
  roundingUnit: number;
}

export interface UsdDue {
  /** remainingUsd × dayRate, unrounded. */
  rawSyp: number;
  /** Amount due today in SYP, rounded to the nearest unit. */
  dueTodaySyp: number;
}

/**
 * Amount due today for the remaining USD of an installment. When rounding to
 * the nearest unit would give 0 while USD is still owed, the due becomes one
 * unit (rounded up) so the installment can still be closed.
 */
export function computeUsdDue({ remainingUsd, dayRate, roundingUnit }: UsdDueInput): UsdDue {
  const rawSyp = Math.max(0, remainingUsd) * dayRate;
  let dueTodaySyp = roundToUnit(rawSyp, roundingUnit);
  if (dueTodaySyp <= 0 && remainingUsd > 0) {
    dueTodaySyp = roundingUnit > 0 ? Math.ceil(rawSyp / roundingUnit) * roundingUnit : Math.ceil(rawSyp);
  }
  return { rawSyp, dueTodaySyp };
}

/** Bounds a full payment may fall within (± 0.5 SYP tolerance is applied by callers). */
export function fullPaymentBounds(due: UsdDue): { lower: number; upper: number } {
  return {
    lower: Math.min(due.rawSyp, due.dueTodaySyp),
    upper: Math.max(due.rawSyp, due.dueTodaySyp),
  };
}

/** Signed percentage change from `fromRate` to `toRate`. */
export function rateChangePct(fromRate: number, toRate: number): number {
  if (!(fromRate > 0)) return 0;
  return round2(((toRate - fromRate) / fromRate) * 100);
}
