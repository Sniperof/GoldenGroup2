/**
 * Canonical SQL-side phone normalisation.
 *
 * Mirrors `normalizePhone()` in contactValidation.ts rule-for-rule so a number
 * normalised in Node and the same number normalised inside a query always
 * compare equal. Kept in one place because several duplicate-detection paths
 * (client creation, candidate BR-2 detection, service-request fuzzy matching)
 * depend on them agreeing — a private copy per call site is exactly the drift
 * the engineering standard forbids.
 */
export function phoneNormalizationSql(expression: string): string {
  const digits = `regexp_replace(COALESCE(${expression}, ''), '\\D', '', 'g')`;
  return `
    CASE
      WHEN ${digits} ~ '^009639\\d{8}$' THEN '0' || right(${digits}, 9)
      WHEN ${digits} ~ '^9639\\d{8}$' THEN '0' || right(${digits}, 9)
      WHEN ${digits} ~ '^9\\d{8}$' THEN '0' || ${digits}
      ELSE ${digits}
    END
  `;
}
