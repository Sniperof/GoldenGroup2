// ============================================================
// systemSettings.ts — Admin read/write for editable system_settings keys
// ============================================================
// Exposes a tightly-scoped admin surface for the handful of operational
// settings the Settings UI manages. Today: contact_target_cleanup_time — the
// daily time the CRON closes stale open contact_targets (DEC-005 D26). The key
// allow-list prevents writing arbitrary settings through this endpoint.
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
const EDITABLE_KEYS = ['contact_target_cleanup_time'] as const;

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

export default router;
