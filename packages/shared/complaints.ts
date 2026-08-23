export const COMPLAINT_TYPES = ['technical', 'device', 'general'] as const;
export type ComplaintType = typeof COMPLAINT_TYPES[number];

export const COMPLAINT_STATUSES = [
  'new', 'triaged', 'assigned', 'in_progress', 'awaiting_complainant',
  'resolved', 'closed', 'rejected', 'withdrawn',
] as const;
export type ComplaintStatus = typeof COMPLAINT_STATUSES[number];

export const COMPLAINT_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export type ComplaintPriority = typeof COMPLAINT_PRIORITIES[number];

export const TECHNICAL_COMPLAINT_CATEGORIES = [
  'staff_conduct', 'field_team_conduct', 'service_delay',
  'scheduling_coordination', 'communication_quality', 'execution_quality',
  'unresolved_service_issue', 'other',
] as const;

export const DEVICE_COMPLAINT_CATEGORIES = [
  'operational_fault', 'electrical_fault', 'performance_issue',
  'quality_issue', 'recurring_fault', 'other',
] as const;

export type ComplaintCategory =
  | typeof TECHNICAL_COMPLAINT_CATEGORIES[number]
  | typeof DEVICE_COMPLAINT_CATEGORIES[number];

export const COMPLAINT_CATEGORY_LABELS_AR: Readonly<Record<ComplaintCategory, string>> = {
  staff_conduct: 'سلوك موظف',
  field_team_conduct: 'سلوك الفريق الميداني',
  service_delay: 'تأخر تقديم الخدمة',
  scheduling_coordination: 'تنسيق المواعيد',
  communication_quality: 'جودة التواصل',
  execution_quality: 'جودة تنفيذ الخدمة',
  unresolved_service_issue: 'مشكلة خدمة غير معالجة',
  operational_fault: 'عطل تشغيلي',
  electrical_fault: 'عطل كهربائي',
  performance_issue: 'مشكلة في الأداء',
  quality_issue: 'مشكلة في الجودة',
  recurring_fault: 'عطل متكرر',
  other: 'أخرى',
};

export const COMPLAINT_OUTCOMES = [
  'upheld', 'partially_upheld', 'not_upheld', 'service_recovery_completed',
  'redirected_to_service', 'duplicate_confirmed',
] as const;
export type ComplaintOutcome = typeof COMPLAINT_OUTCOMES[number];

export const COMPLAINT_TRANSITIONS: Readonly<Record<ComplaintStatus, readonly ComplaintStatus[]>> = {
  new: ['triaged', 'rejected', 'withdrawn'],
  triaged: ['assigned', 'rejected', 'withdrawn'],
  assigned: ['in_progress', 'withdrawn'],
  in_progress: ['awaiting_complainant', 'resolved', 'withdrawn'],
  awaiting_complainant: ['in_progress', 'resolved', 'withdrawn'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
  rejected: ['in_progress'],
  withdrawn: ['in_progress'],
};

export function isComplaintTransitionAllowed(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return COMPLAINT_TRANSITIONS[from].includes(to);
}
