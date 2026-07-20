export const TELEMARKETING_SERVICE_REQUEST_TASK_TYPES = [
  'device_demo',
  'golden_warranty_offer',
  'emergency_maintenance',
  'periodic_maintenance',
] as const;

const TELEMARKETING_SERVICE_REQUEST_TASK_TYPE_SET = new Set<string>(
  TELEMARKETING_SERVICE_REQUEST_TASK_TYPES,
);

const DEVICE_LINK_REQUIRED_TASK_TYPES = new Set([
  'device_delivery',
  'device_installation',
  'device_activation',
  'device_disconnection',
  'device_retrieval',
  'device_checkup',
  'device_return',
  'device_transfer',
]);

export interface OpenTaskLinkageSnapshot {
  taskType: string;
  deviceId?: number | null;
  installmentId?: number | null;
  hasGiftDeliveryLink?: boolean;
  hasGoldenWarrantyLink?: boolean;
}

export interface OpenTaskLinkageIssue {
  code: 'DEVICE_REQUIRED' | 'INSTALLMENT_REQUIRED' | 'GIFT_RECORD_REQUIRED' | 'GOLDEN_WARRANTY_REQUIRED';
  message: string;
}

export function isTelemarketingServiceRequestTaskType(taskType: string): boolean {
  return TELEMARKETING_SERVICE_REQUEST_TASK_TYPE_SET.has(taskType);
}

export function getOpenTaskLinkageIssue(task: OpenTaskLinkageSnapshot): OpenTaskLinkageIssue | null {
  if (DEVICE_LINK_REQUIRED_TASK_TYPES.has(task.taskType) && !task.deviceId) {
    return {
      code: 'DEVICE_REQUIRED',
      message: 'لا يمكن سحب المهمة لأنها غير مرتبطة بجهاز مثبت',
    };
  }

  if (task.taskType === 'installment_collection' && !task.installmentId) {
    return {
      code: 'INSTALLMENT_REQUIRED',
      message: 'لا يمكن سحب مهمة التحصيل لأنها غير مرتبطة بقسط',
    };
  }

  if (task.taskType === 'gift_delivery' && task.hasGiftDeliveryLink !== true) {
    return {
      code: 'GIFT_RECORD_REQUIRED',
      message: 'لا يمكن سحب مهمة تسليم الهدية لعدم وجود سجلات هدايا نشطة مرتبطة بها',
    };
  }

  if (task.taskType === 'golden_warranty_card_delivery' && task.hasGoldenWarrantyLink !== true) {
    return {
      code: 'GOLDEN_WARRANTY_REQUIRED',
      message: 'لا يمكن سحب مهمة تسليم بطاقة الضمان لعدم وجود كفالة ذهبية نشطة مرتبطة بها',
    };
  }

  return null;
}

export function getGoldenWarrantyDeliveryResultIssue(
  decision: string,
  deliveredCount: number,
): string | null {
  if (decision === 'delivered' && deliveredCount === 0) {
    return 'لا توجد كفالة ذهبية نشطة قابلة للتسليم - لم يتم تحديث أي بطاقة ضمان';
  }
  return null;
}
