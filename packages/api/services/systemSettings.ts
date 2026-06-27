// ============================================================
// systemSettings.ts — Read system_settings keys with TTL caching
// ============================================================
// Constitution source:
//   DEC-005 D26/D29 — default_cooldown_days, contact_target_cleanup_time
//   DEC-006 D37/D38 — attempt_alert_threshold, visit_undocumented_alert_hours_l1/l2/l3
//
// Cache TTL is 60 seconds to balance "admin can tweak settings live" against
// not hammering the DB on every call. Admin UI invalidates via clearCache().
// ============================================================

import pool from '../db.js';

interface CachedSetting {
  value: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CachedSetting>();

async function readSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [key],
  );
  if (rows.length === 0) {
    return null;
  }
  cache.set(key, { value: rows[0].value, fetchedAt: Date.now() });
  return rows[0].value;
}

export async function getSystemSettingNumber(key: string, fallback: number): Promise<number> {
  const raw = await readSetting(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function getSystemSettingString(key: string, fallback: string): Promise<string> {
  const raw = await readSetting(key);
  return raw ?? fallback;
}

export async function getSystemSettingBoolean(key: string, fallback: boolean): Promise<boolean> {
  const raw = await readSetting(key);
  if (raw == null) return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase())) return false;
  return fallback;
}

export async function getSystemSettingJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readSetting(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** HH:MM time-of-day. Falls back to fallback when missing or malformed. */
export async function getSystemSettingTime(key: string, fallback: string): Promise<string> {
  const raw = await readSetting(key);
  if (raw == null) return fallback;
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw) ? raw : fallback;
}

export function clearSystemSettingsCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

// ── Constitution-defined defaults (kept here for single source of truth) ────

export const SYSTEM_SETTING_DEFAULTS = {
  default_cooldown_days: 7,                    // DEC-005 D29
  contact_target_cleanup_time: '22:00',        // DEC-005 D26
  attempt_alert_threshold: 5,                  // DEC-006 D37
  visit_undocumented_alert_hours_l1: 24,       // DEC-006 D38
  visit_undocumented_alert_hours_l2: 48,       // DEC-006 D38
  visit_undocumented_alert_hours_l3: 72,       // DEC-006 D38
  periodic_auto_generate_enabled: true,
  periodic_manual_creation_enabled: true,
  periodic_default_interval_months: 6,
  periodic_attach_warning_days: 14,
  periodic_attach_allowed_statuses: ['open', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution'],
} as const;

export interface PeriodicMaintenanceSettings {
  autoGenerateEnabled: boolean;
  manualCreationEnabled: boolean;
  defaultIntervalMonths: number;
  attachWarningDays: number;
  attachAllowedStatuses: string[];
}

export async function getPeriodicMaintenanceSettings(): Promise<PeriodicMaintenanceSettings> {
  const defaults = SYSTEM_SETTING_DEFAULTS;
  const [
    autoGenerateEnabled,
    manualCreationEnabled,
    defaultIntervalMonths,
    attachWarningDays,
    attachAllowedStatuses,
  ] = await Promise.all([
    getSystemSettingBoolean('periodic_auto_generate_enabled', defaults.periodic_auto_generate_enabled),
    getSystemSettingBoolean('periodic_manual_creation_enabled', defaults.periodic_manual_creation_enabled),
    getSystemSettingNumber('periodic_default_interval_months', defaults.periodic_default_interval_months),
    getSystemSettingNumber('periodic_attach_warning_days', defaults.periodic_attach_warning_days),
    getSystemSettingJson<string[]>('periodic_attach_allowed_statuses', [...defaults.periodic_attach_allowed_statuses]),
  ]);

  return {
    autoGenerateEnabled,
    manualCreationEnabled,
    defaultIntervalMonths: Math.max(1, Math.floor(defaultIntervalMonths)),
    attachWarningDays: Math.max(0, Math.floor(attachWarningDays)),
    attachAllowedStatuses: Array.isArray(attachAllowedStatuses)
      ? attachAllowedStatuses.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [...defaults.periodic_attach_allowed_statuses],
  };
}
