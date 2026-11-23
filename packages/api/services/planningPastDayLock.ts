// Planning past-day lock (planning stage 2, decided 2026-11-23).
//
// A day's team schedule and route assignments are a plan for executing that
// day. Once the day has passed (Damascus calendar), saving them is rejected:
// a save re-runs syncAssignedTasks, which would assign open tasks to a day
// that is already over and leave them stranded as `assigned`. Reading stays
// allowed; historical corrections belong to the visit record, not the plan.
// The planning-day close cycle already locks CLOSED days; this also covers a
// past day whose close never ran.

export const PAST_DAY_LOCKED = 'PAST_DAY_LOCKED';

export function todayInDamascus(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const byType = new Map(parts.map(part => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

/** True when `date` (YYYY-MM-DD) is before today in Damascus. */
export function isPastPlanningDay(date: string, now: Date = new Date()): boolean {
  return date < todayInDamascus(now);
}

export const PAST_DAY_LOCKED_RESPONSE = {
  error: 'لا يمكن تعديل خطة يوم مضى. يمكن عرضها فقط.',
  code: PAST_DAY_LOCKED,
} as const;
