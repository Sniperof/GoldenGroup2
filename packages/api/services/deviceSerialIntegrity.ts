export const DEVICE_SERIAL_UNIQUE_INDEX = 'uq_installed_devices_serial_normalized';
export const DEVICE_SERIAL_CONFLICT_CODE = 'device_serial_conflict';
export const DEVICE_SERIAL_CONFLICT_MESSAGE = 'الرقم التسلسلي مستخدم لجهاز آخر';

type Queryable = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

export interface DeviceSerialExclusion {
  deviceId?: number | string | null;
  contractId?: number | string | null;
}

export class DeviceSerialConflictError extends Error {
  readonly status = 409;
  readonly code = DEVICE_SERIAL_CONFLICT_CODE;

  constructor() {
    super(DEVICE_SERIAL_CONFLICT_MESSAGE);
    this.name = 'DeviceSerialConflictError';
  }
}

/**
 * Preserve the operator-entered casing while removing insignificant whitespace.
 * Empty serials represent an unknown identity and are stored as NULL.
 */
export function normalizeDeviceSerialNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function isDeviceSerialUniqueViolation(error: unknown): boolean {
  if (error instanceof DeviceSerialConflictError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const postgresError = error as { code?: string; constraint?: string };
  return postgresError.code === '23505'
    && postgresError.constraint === DEVICE_SERIAL_UNIQUE_INDEX;
}

export function deviceSerialConflictPayload(error: unknown): {
  error: string;
  code: string;
} | null {
  if (!isDeviceSerialUniqueViolation(error)) return null;
  return {
    error: DEVICE_SERIAL_CONFLICT_MESSAGE,
    code: DEVICE_SERIAL_CONFLICT_CODE,
  };
}

/**
 * Friendly preflight for normal requests. The database unique index remains the
 * authoritative guard and closes the race between concurrent writers.
 */
export async function assertDeviceSerialAvailable(
  db: Queryable,
  value: unknown,
  exclusion: DeviceSerialExclusion = {},
): Promise<string | null> {
  const serialNumber = normalizeDeviceSerialNumber(value);
  if (serialNumber === null) return null;

  const excludedDeviceId = exclusion.deviceId == null ? null : Number(exclusion.deviceId);
  const excludedContractId = exclusion.contractId == null ? null : Number(exclusion.contractId);
  const { rows } = await db.query(
    `SELECT 1
       FROM installed_devices
      WHERE lower(btrim(serial_number)) = lower($1)
        AND ($2::int IS NULL OR id <> $2::int)
        AND ($3::int IS NULL OR contract_id IS DISTINCT FROM $3::int)
      LIMIT 1`,
    [serialNumber, excludedDeviceId, excludedContractId],
  );
  if (rows[0]) throw new DeviceSerialConflictError();
  return serialNumber;
}
