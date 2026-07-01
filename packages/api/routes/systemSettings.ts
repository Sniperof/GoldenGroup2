// ============================================================
// systemSettings.ts — Admin read/write for editable system_settings keys
// ============================================================
// Exposes a tightly-scoped admin surface for the operational settings the
// Settings UI manages. The key allow-list prevents writing arbitrary settings
// through this endpoint.
//
// Permissions (already seeded, GLOBAL):
//   settings.view   — read the editable settings.
//   settings.manage — update them.
// ============================================================

import { Router } from 'express';
import pool from '../db.js';
import { requirePermission } from '../middleware/permission.js';
import { clearSystemSettingsCache } from '../services/systemSettings.js';

const router = Router();

// Keys the admin Settings UI is allowed to read/write. Explicit so the editor
// can never reach an arbitrary settings key through this surface.
const EDITABLE_KEYS = [
  'contact_target_cleanup_time',
  'periodic_auto_generate_enabled',
  'periodic_manual_creation_enabled',
  'periodic_default_interval_months',
  'periodic_attach_warning_days',
  'periodic_attach_allowed_statuses',
  'dashboard_metric_refresh_hours',
] as const;

type EditableKey = typeof EDITABLE_KEYS[number];

const SETTING_TYPES: Record<EditableKey, 'integer' | 'boolean' | 'time' | 'json'> = {
  contact_target_cleanup_time: 'time',
  periodic_auto_generate_enabled: 'boolean',
  periodic_manual_creation_enabled: 'boolean',
  periodic_default_interval_months: 'integer',
  periodic_attach_warning_days: 'integer',
  periodic_attach_allowed_statuses: 'json',
  dashboard_metric_refresh_hours: 'integer',
};

const ALLOWED_PERIODIC_STATUSES = new Set(['open', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution']);

function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}

function normalizeSettingValue(key: EditableKey, value: unknown): string {
  const type = SETTING_TYPES[key];

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(v)) return 'true';
      if (['false', '0', 'no', 'off'].includes(v)) return 'false';
    }
    throw new Error('قيمة boolean غير صالحة.');
  }

  if (type === 'integer') {
    const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(n) || n < 0) throw new Error('القيمة يجب أن تكون رقماً صحيحاً موجباً.');
    if (key === 'periodic_default_interval_months' && n < 1) {
      throw new Error('فترة الصيانة الافتراضية يجب أن تكون شهراً واحداً على الأقل.');
    }
    return String(n);
  }

  if (type === 'time') {
    const raw = typeof value === 'string' ? value.trim() : '';
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('صيغة الوقت يجب أن تكون HH:MM (نظام 24 ساعة).');
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) throw new Error('وقت غير صالح — الساعة بين 0 و23 والدقيقة بين 0 و59.');
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  if (key === 'periodic_attach_allowed_statuses') {
    const arr = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    const statuses = [...new Set(arr.filter((s): s is string => typeof s === 'string'))];
    if (statuses.length === 0 || statuses.some(s => !ALLOWED_PERIODIC_STATUSES.has(s))) {
      throw new Error('حالات ربط الدورية غير صالحة.');
    }
    return JSON.stringify(statuses);
  }

  throw new Error('نوع الإعداد غير مدعوم.');
}

// GET /api/system-settings — the editable settings managed by the admin UI.
router.get('/', requirePermission('settings.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value, value_type AS "valueType", category, description
         FROM system_settings
        WHERE key = ANY($1::varchar[])
        ORDER BY key`,
      [EDITABLE_KEYS as unknown as string[]],
    );
    return res.json({ settings: rows });
  } catch (err: any) {
    console.error('[system-settings] list failed:', err);
    return res.status(500).json({ error: err?.message ?? 'فشل تحميل الإعدادات' });
  }
});

// PUT /api/system-settings/contact-target-cleanup-time
// Body: { time: "HH:MM" } (24-hour). Upserts + invalidates the read cache so the
// running CRON picks up the new time within its next tick.
router.put('/contact-target-cleanup-time', requirePermission('settings.manage'), async (req, res) => {
  const raw = typeof req.body?.time === 'string' ? req.body.time.trim() : '';
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    return res.status(400).json({ error: 'صيغة الوقت يجب أن تكون HH:MM (نظام 24 ساعة).' });
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) {
    return res.status(400).json({ error: 'وقت غير صالح — الساعة بين 0 و23 والدقيقة بين 0 و59.' });
  }
  const normalized = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const userId = req.authContext?.userId ?? null;
  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, value_type, category, description, is_editable, updated_by, updated_at)
       VALUES ('contact_target_cleanup_time', $1, 'time', 'telemarketing',
               'وقت تشغيل CRON اليومي لإغلاق contact_targets القديمة (DEC-005 D26)', TRUE, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [normalized, userId],
    );
    clearSystemSettingsCache('contact_target_cleanup_time');
    return res.json({ key: 'contact_target_cleanup_time', value: normalized });
  } catch (err: any) {
    console.error('[system-settings] update cleanup time failed:', err);
    return res.status(500).json({ error: err?.message ?? 'فشل حفظ الإعداد' });
  }
});

// PUT /api/system-settings/:key
// Body: { value } — generic but allow-listed and type-validated.
router.put('/:key', requirePermission('settings.manage'), async (req, res) => {
  const key = String(req.params.key ?? '');
  if (!isEditableKey(key)) {
    return res.status(404).json({ error: 'الإعداد غير متاح للتعديل من هذه الواجهة.' });
  }

  let value: string;
  try {
    value = normalizeSettingValue(key, req.body?.value);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message ?? 'قيمة غير صالحة.' });
  }

  const userId = req.authContext?.userId ?? null;
  try {
    await pool.query(
      `UPDATE system_settings
          SET value = $2, updated_by = $3, updated_at = NOW()
        WHERE key = $1`,
      [key, value, userId],
    );
    clearSystemSettingsCache(key);
    return res.json({ key, value });
  } catch (err: any) {
    console.error('[system-settings] update failed:', err);
    return res.status(500).json({ error: err?.message ?? 'فشل حفظ الإعداد' });
  }
});

export default router;
