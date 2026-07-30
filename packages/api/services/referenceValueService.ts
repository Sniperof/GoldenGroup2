type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export class ReferenceValueError extends Error {
  status = 400;
  code = 'reference_value_inactive_or_unknown';

  constructor(public readonly category: string, public readonly value: string) {
    super(`القيمة المحددة غير فعالة ضمن قائمة ${category}`);
  }
}

export async function resolveReferenceValueForWrite(
  db: Queryable,
  category: string,
  rawValue: unknown,
  options: { currentValue?: string | null } = {},
): Promise<string | null> {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return null;

  const currentValue = typeof options.currentValue === 'string' ? options.currentValue.trim() : '';
  if (currentValue && value === currentValue) {
    return value;
  }

  const { rows } = await db.query(
    `SELECT value
       FROM system_lists
      WHERE category = $1
        AND value = $2
        AND is_active = TRUE
      ORDER BY id
      LIMIT 1`,
    [category, value],
  );
  if (!rows[0]) {
    throw new ReferenceValueError(category, value);
  }

  return String(rows[0].value);
}
