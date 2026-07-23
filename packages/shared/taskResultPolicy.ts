export const VISIT_RESULT_TASK_TYPES = [
  'device_demo',
  'device_checkup',
  'device_delivery',
  'device_installation',
  'device_activation',
  'device_disconnection',
  'device_retrieval',
  'device_return',
  'device_transfer',
  'emergency_maintenance',
  'periodic_maintenance',
  'golden_warranty_offer',
  'golden_warranty_card_delivery',
  'installment_collection',
  'gift_delivery',
] as const;

export type VisitResultTaskType = typeof VISIT_RESULT_TASK_TYPES[number];

export const TASK_CANCELLATION_REASON_CATEGORIES = {
  device_demo: 'device_demo_cancellation_reasons',
  device_checkup: 'device_checkup_refusal_reasons',
  device_delivery: 'device_delivery_failure_reasons',
  device_installation: 'installation_refusal_reason',
  device_activation: 'device_activation_failure_reasons',
  device_disconnection: 'device_disconnection_failure_reasons',
  device_retrieval: 'device_retrieval_refusal_reasons',
  device_return: 'device_return_refusal_reasons',
  device_transfer: 'device_transfer_refusal_reasons',
  emergency_maintenance: 'emergency_cancelled_reason',
  periodic_maintenance: 'visit_cancellation_reasons',
  golden_warranty_offer: 'golden_offer_rejection_reasons',
  golden_warranty_card_delivery: 'golden_card_rejection_reasons',
  installment_collection: 'collection_refusal_reasons',
  gift_delivery: 'gift_delivery_refusal_reasons',
} as const satisfies Record<VisitResultTaskType, string>;

export const OPEN_TASK_PRE_SCHEDULE_CANCELLABLE_STATUSES = [
  'open',
  'needs_follow_up',
  'assigned',
  'in_scheduling',
] as const;

export type OpenTaskPreScheduleCancellableStatus =
  typeof OPEN_TASK_PRE_SCHEDULE_CANCELLABLE_STATUSES[number];

export function isVisitResultTaskType(taskType: string | null | undefined): taskType is VisitResultTaskType {
  return taskType != null && (VISIT_RESULT_TASK_TYPES as readonly string[]).includes(taskType);
}

export function getTaskCancellationReasonCategory(taskType: string | null | undefined): string {
  if (isVisitResultTaskType(taskType)) {
    return TASK_CANCELLATION_REASON_CATEGORIES[taskType];
  }
  return 'visit_cancellation_reasons';
}

export function canCancelOpenTaskBeforeScheduling(
  status: string | null | undefined,
  hasActiveVisit: boolean,
): boolean {
  return status != null
    && (OPEN_TASK_PRE_SCHEDULE_CANCELLABLE_STATUSES as readonly string[]).includes(status)
    && !hasActiveVisit;
}
