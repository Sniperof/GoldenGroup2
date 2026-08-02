export const EDITABLE_KEYS = [
  'contact_target_cleanup_time',
  'periodic_auto_generate_enabled',
  'periodic_manual_creation_enabled',
  'periodic_default_interval_months',
  'periodic_attach_warning_days',
  'periodic_attach_allowed_statuses',
  'dashboard_metric_refresh_hours',
  'visit_escalation_job_interval_minutes',
  'web_login_allowed_team_slots',
] as const;

export type EditableKey = typeof EDITABLE_KEYS[number];
type EditableSettingType = 'integer' | 'boolean' | 'time' | 'json' | 'slot_list';

const SETTING_TYPES: Record<EditableKey, EditableSettingType> = {
  contact_target_cleanup_time: 'time',
  periodic_auto_generate_enabled: 'boolean',
  periodic_manual_creation_enabled: 'boolean',
  periodic_default_interval_months: 'integer',
  periodic_attach_warning_days: 'integer',
  periodic_attach_allowed_statuses: 'json',
  dashboard_metric_refresh_hours: 'integer',
  visit_escalation_job_interval_minutes: 'integer',
  web_login_allowed_team_slots: 'slot_list',
};

const ALLOWED_PERIODIC_STATUSES = new Set(['open', 'assigned', 'in_scheduling', 'scheduled', 'waiting_execution']);

/** Mirrors the CHECK constraint on roles.team_slot_type. */
export const ALLOWED_TEAM_SLOTS = ['SUPERVISOR', 'TECHNICIAN', 'TRAINEE', 'TELEMARKETER'] as const;

export function isEditableKey(key: string): key is EditableKey {
  return (EDITABLE_KEYS as readonly string[]).includes(key);
}

export function normalizeSettingValue(key: EditableKey, value: unknown): string {
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
    if (key === 'visit_escalation_job_interval_minutes' && (n < 1 || n > 1440)) {
      throw new Error('فترة فحص تنبيهات الزيارات يجب أن تكون بين دقيقة و1440 دقيقة.');
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

  if (type === 'slot_list') {
    if (!Array.isArray(value) && typeof value !== 'string') {
      throw new Error('قائمة خانات الفريق يجب أن تكون نصاً مفصولاً بفواصل أو قائمة نصية.');
    }
    const rawSlots = Array.isArray(value) ? value : value.split(',');
    if (rawSlots.some(slot => typeof slot !== 'string')) {
      throw new Error('قائمة خانات الفريق تقبل قيماً نصية فقط.');
    }
    const requested = [...new Set(rawSlots.map(slot => slot.trim().toUpperCase()).filter(Boolean))];
    const unknown = requested.filter(slot => !(ALLOWED_TEAM_SLOTS as readonly string[]).includes(slot));
    if (unknown.length > 0) {
      throw new Error(`خانة فريق غير معروفة: ${unknown.join('، ')}. المسموح: ${ALLOWED_TEAM_SLOTS.join('، ')}.`);
    }
    // Canonical role-slot order keeps API responses and UI dirty-state stable.
    return ALLOWED_TEAM_SLOTS.filter(slot => requested.includes(slot)).join(',');
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
