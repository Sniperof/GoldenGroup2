/**
 * A `datetime-local` input yields a zone-less string («2026-08-06T15:03»), and what
 * instant that denotes depends on whoever reads it. The API now pins the reading to
 * Damascus, but the honest fix is to send the instant itself: the browser knows which
 * zone the operator is sitting in, so it resolves the string here instead of leaving
 * the server to assume.
 *
 * This matters because the call reports compare the call's DATE against a task's due
 * date. A three-hour disagreement moves an evening call to the next day, and flips
 * «within the due date» into «past it».
 */
export function toCallInstant(localDateTime: string | null | undefined): string | null {
  if (localDateTime == null) return null;
  const trimmed = String(localDateTime).trim();
  if (!trimmed) return null;
  // Already names its zone — pass it through rather than reinterpreting it.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return trimmed;
  // A date-time form without an offset is local time by specification, which is
  // exactly what the input meant.
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
