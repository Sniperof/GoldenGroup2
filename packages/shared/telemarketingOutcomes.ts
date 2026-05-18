// ─────────────────────────────────────────────────────────────────
// Telemarketing Outcome Model — MVP Redesign
// ─────────────────────────────────────────────────────────────────
// This file is the single source of truth for outcome codes, their
// Arabic labels, grouping, lifecycle behavior, and phone-status
// mapping. Both the frontend and backend import from here.
// ─────────────────────────────────────────────────────────────────

// ── Outcome codes (stored in DB) ──────────────────────────────

export type TelemarketingOutcomeCode =
  // Group 1: Not reached
  | 'no_answer'
  | 'busy'
  | 'out_of_coverage'
  | 'not_in_service'
  | 'wrong_number'
  | 'auto_disconnected'
  // Group 2: Reached — no appointment
  | 'currently_busy'
  | 'interrupted'
  | 'not_interested'
  | 'other_company_not_interested'
  | 'seen_offer_not_interested'
  | 'address_updated'
  // Group 3: Reached — follow-up
  | 'other_company_callback'
  | 'seen_offer_callback'
  // Group 4: Reached — service / transfer
  | 'service_request'
  | 'company_customer_missing_phone'
  // Group 5: Appointment booking
  | 'booked_marketing_appointment'
  // Free call specific
  | 'new_number'
  // Text message (no call outcome yet)
  | 'message_sent'
  // Legacy codes (kept for backward compatibility)
  | 'rejected'
  | 'booked';

// ── Category / enum types ─────────────────────────────────────

export type TelemarketingOutcomeCategory =
  | 'not_reached'
  | 'reached'
  | 'follow_up'
  | 'service_request'
  | 'booked';

export type NextAction =
  | 'retry_later'
  | 'close_target'
  | 'needs_follow_up'
  | 'transfer_to_service'
  | 'update_address'
  | 'request_appointment'
  | 'no_action';

export type PhoneStatusUpdate =
  | 'none'
  | 'preferred'
  | 'active'
  | 'out_of_coverage'
  | 'not_in_use'
  | 'wrong_value';

// ── Phone-status UI ↔ DB mapping ──────────────────────────────

export const PHONE_STATUS_TO_CONTACT_ENTRY: Record<Exclude<PhoneStatusUpdate, 'none'>, string> = {
  preferred: 'preferred',
  active: 'active',
  out_of_coverage: 'out-of-coverage',
  not_in_use: 'unused',
  wrong_value: 'invalid',
};

// ── Arabic labels for phone status options ──────────────────────

export const PHONE_STATUS_LABELS: Record<Exclude<PhoneStatusUpdate, 'none'>, string> = {
  preferred: 'مفضل',
  active: 'فعال',
  out_of_coverage: 'خارج التغطية',
  not_in_use: 'غير مستخدم',
  wrong_value: 'قيمة خاطئة',
};

// ── Outcome group metadata ─────────────────────────────────────

export interface OutcomeGroup {
  key: TelemarketingOutcomeCategory;
  label: string;
  order: number;
}

export const OUTCOME_GROUPS: OutcomeGroup[] = [
  { key: 'not_reached', label: 'لم يتم التواصل', order: 1 },
  { key: 'reached', label: 'تم التواصل — لا يوجد موعد', order: 2 },
  { key: 'follow_up', label: 'تم التواصل — يحتاج متابعة', order: 3 },
  { key: 'service_request', label: 'تم التواصل — تحويل/طلب خدمة', order: 4 },
  { key: 'booked', label: 'حجز موعد', order: 5 },
];

// ── Per-outcome metadata ───────────────────────────────────────

export interface OutcomeMeta {
  code: TelemarketingOutcomeCode;
  label: string;
  group: TelemarketingOutcomeCategory;
  nextAction: NextAction;
  phoneStatusUpdate: PhoneStatusUpdate;
  requiresPhoneStatusUpdate: boolean;
  requiresNotes: boolean;
  itemStatusAfterSave: 'pending' | 'called' | 'booked';
  closesContactTarget: boolean;
  opensAppointment: boolean;
  defaultPhoneStatus?: Exclude<PhoneStatusUpdate, 'none'>;
}

export const OUTCOME_MAP: Record<TelemarketingOutcomeCode, OutcomeMeta> = {
  // ── Group 1: Not reached ────────────────────────────────────
  no_answer: {
    code: 'no_answer',
    label: 'لم يتم الرد',
    group: 'not_reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },
  busy: {
    code: 'busy',
    label: 'الرقم مشغول',
    group: 'not_reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },
  out_of_coverage: {
    code: 'out_of_coverage',
    label: 'الرقم خارج التغطية',
    group: 'not_reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'out_of_coverage',
    requiresPhoneStatusUpdate: true,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
    defaultPhoneStatus: 'out_of_coverage',
  },
  not_in_service: {
    code: 'not_in_service',
    label: 'الرقم غير موضوع بالخدمة',
    group: 'not_reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'not_in_use',
    requiresPhoneStatusUpdate: true,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
    defaultPhoneStatus: 'not_in_use',
  },
  wrong_number: {
    code: 'wrong_number',
    label: 'الرقم غير صحيح',
    group: 'not_reached',
    nextAction: 'no_action',
    phoneStatusUpdate: 'wrong_value',
    requiresPhoneStatusUpdate: true,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
    defaultPhoneStatus: 'wrong_value',
  },
  auto_disconnected: {
    code: 'auto_disconnected',
    label: 'انقطع الاتصال تلقائياً',
    group: 'not_reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },

  // ── Group 2: Reached — no appointment ──────────────────────
  currently_busy: {
    code: 'currently_busy',
    label: 'العميل مشغول حالياً',
    group: 'reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },
  interrupted: {
    code: 'interrupted',
    label: 'انقطع الاتصال قبل إتمام المكالمة',
    group: 'reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },
  not_interested: {
    code: 'not_interested',
    label: 'غير مهتم بالعرض',
    group: 'reached',
    nextAction: 'close_target',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'called',
    closesContactTarget: true,
    opensAppointment: false,
  },
  other_company_not_interested: {
    code: 'other_company_not_interested',
    label: 'لديه جهاز من شركة أخرى وغير مهتم',
    group: 'reached',
    nextAction: 'close_target',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'called',
    closesContactTarget: true,
    opensAppointment: false,
  },
  seen_offer_not_interested: {
    code: 'seen_offer_not_interested',
    label: 'اطّلع على العرض سابقاً وغير مهتم',
    group: 'reached',
    nextAction: 'close_target',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'called',
    closesContactTarget: true,
    opensAppointment: false,
  },
  address_updated: {
    code: 'address_updated',
    label: 'تم تحديث العنوان',
    group: 'reached',
    nextAction: 'update_address',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: true,
    itemStatusAfterSave: 'called',
    closesContactTarget: false,
    opensAppointment: false,
  },

  // ── Group 3: Reached — follow-up ───────────────────────────
  other_company_callback: {
    code: 'other_company_callback',
    label: 'لديه جهاز من شركة أخرى وطلب المتابعة لاحقاً',
    group: 'follow_up',
    nextAction: 'needs_follow_up',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },
  seen_offer_callback: {
    code: 'seen_offer_callback',
    label: 'اطّلع على العرض سابقاً وطلب المتابعة لاحقاً',
    group: 'follow_up',
    nextAction: 'needs_follow_up',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },

  // ── Group 4: Reached — service / transfer ───────────────────
  service_request: {
    code: 'service_request',
    label: 'طلب خدمة أو صيانة',
    group: 'service_request',
    nextAction: 'transfer_to_service',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'called',
    closesContactTarget: false,  // CT stays open (تم التواصل); task creation is handled separately
    opensAppointment: false,
  },
  company_customer_missing_phone: {
    code: 'company_customer_missing_phone',
    label: 'زبون شركة ورقم التواصل غير متوفر في سجلاتنا',
    group: 'service_request',
    nextAction: 'close_target',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'called',
    closesContactTarget: true,
    opensAppointment: false,
  },

  // ── Group 5: Appointment booking ─────────────────────────────
  booked_marketing_appointment: {
    code: 'booked_marketing_appointment',
    label: 'تم حجز موعد زيارة تسويقية',
    group: 'booked',
    nextAction: 'request_appointment',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'booked',
    closesContactTarget: false,
    opensAppointment: true,
  },

  // ── Free call: data update — new number ────────────────────
  new_number: {
    code: 'new_number',
    label: 'رقم جديد — إضافة رقم',
    group: 'reached',
    nextAction: 'no_action',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: true,
    itemStatusAfterSave: 'called',
    closesContactTarget: false,
    opensAppointment: false,
  },


  // ── Text message (no call outcome yet) ─────────────────────────
  message_sent: {
    code: 'message_sent',
    label: 'رسالة نصية مرسلة — منتظر رد',
    group: 'not_reached',
    nextAction: 'retry_later',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'pending',
    closesContactTarget: false,
    opensAppointment: false,
  },
  // ── Legacy codes (backward compatibility) ───────────────────
  rejected: {
    code: 'rejected',
    label: 'غير مهتم بالعرض',
    group: 'reached',
    nextAction: 'close_target',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'called',
    closesContactTarget: true,
    opensAppointment: false,
  },
  booked: {
    code: 'booked',
    label: 'تم حجز موعد زيارة تسويقية',
    group: 'booked',
    nextAction: 'request_appointment',
    phoneStatusUpdate: 'none',
    requiresPhoneStatusUpdate: false,
    requiresNotes: false,
    itemStatusAfterSave: 'booked',
    closesContactTarget: false,
    opensAppointment: true,
  },
};

// ── Helper: resolve any outcome code (including unknown) ──────

export const UNKNOWN_OUTCOME_META: OutcomeMeta = {
  code: 'no_answer' as TelemarketingOutcomeCode,
  label: 'نتيجة غير معروفة',
  group: 'not_reached',
  nextAction: 'no_action',
  phoneStatusUpdate: 'none',
  requiresPhoneStatusUpdate: false,
  requiresNotes: false,
  itemStatusAfterSave: 'pending',
  closesContactTarget: false,
  opensAppointment: false,
};

export function getOutcomeMeta(code: string): OutcomeMeta {
  return OUTCOME_MAP[code as TelemarketingOutcomeCode] ?? UNKNOWN_OUTCOME_META;
}

// ── Outcome codes grouped by category (for UI rendering) ──────

export const OUTCOMES_BY_GROUP = OUTCOME_GROUPS.map(group => ({
  ...group,
  outcomes: (Object.values(OUTCOME_MAP) as OutcomeMeta[])
    .filter(m => m.group === group.key && m.code !== 'rejected' && m.code !== 'booked'),
}));

// ── Outcomes that close the contact target ─────────────────────

export const CLOSES_TARGET_OUTCOMES: TelemarketingOutcomeCode[] = (
  Object.values(OUTCOME_MAP) as OutcomeMeta[]
).filter(m => m.closesContactTarget).map(m => m.code);

// ── Normalise legacy codes to canonical equivalents ────────────

export function normaliseOutcomeCode(code: string): TelemarketingOutcomeCode {
  if (code === 'rejected') return 'not_interested';
  if (code === 'booked') return 'booked_marketing_appointment';
  return code as TelemarketingOutcomeCode;
}