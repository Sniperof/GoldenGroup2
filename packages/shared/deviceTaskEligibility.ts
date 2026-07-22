export const DEVICE_SUBJECT_TASK_TYPES = [
  'device_delivery',
  'device_installation',
  'device_activation',
  'device_checkup',
  'device_disconnection',
  'device_retrieval',
  'device_transfer',
  'device_return',
  'emergency_maintenance',
  'periodic_maintenance',
  'device_repair',
  'parts_sale',
  'golden_warranty_offer',
  'golden_warranty_card_delivery',
  'warranty_cancellation',
  'warranty_reactivation',
] as const;

const DEVICE_SUBJECT_TASK_TYPE_SET = new Set<string>(DEVICE_SUBJECT_TASK_TYPES);

export type DeviceTaskEligibilityCode =
  | 'ELIGIBLE'
  | 'ACTIVE_TASK_EXISTS'
  | 'INVALID_DEVICE_STATUS'
  | 'DISCONNECTION_RESULT_REQUIRED'
  | 'MAINTENANCE_RETRIEVAL_REQUIRED'
  | 'SERVICE_BASIS_REQUIRED'
  | 'ACTIVE_GOLDEN_WARRANTY_EXISTS'
  | 'UNSUPPORTED_TASK_TYPE';

export interface DeviceTaskEligibilityInput {
  taskType: string;
  deviceStatus?: string | null;
  hasContract?: boolean;
  hasActiveServiceAgreement?: boolean;
  hasActiveTask?: boolean;
  hasSuccessfulDisconnection?: boolean;
  hasSuccessfulMaintenanceRetrieval?: boolean;
  hasActiveGoldenWarranty?: boolean;
}

export interface DeviceTaskEligibilityResult {
  allowed: boolean;
  code: DeviceTaskEligibilityCode;
  reason: string;
}

function allowed(reason: string): DeviceTaskEligibilityResult {
  return { allowed: true, code: 'ELIGIBLE', reason };
}

function denied(code: Exclude<DeviceTaskEligibilityCode, 'ELIGIBLE'>, reason: string): DeviceTaskEligibilityResult {
  return { allowed: false, code, reason };
}

export function taskRequiresInstalledDevice(taskType: string): boolean {
  return DEVICE_SUBJECT_TASK_TYPE_SET.has(taskType);
}

export function evaluateDeviceTaskEligibility(input: DeviceTaskEligibilityInput): DeviceTaskEligibilityResult {
  if (!taskRequiresInstalledDevice(input.taskType)) {
    return denied('UNSUPPORTED_TASK_TYPE', 'نوع المهمة لا يعمل على جهاز مركب محدد');
  }
  if (input.hasActiveTask) {
    return denied('ACTIVE_TASK_EXISTS', 'توجد مهمة نشطة من النوع نفسه لهذا الجهاز');
  }

  const status = String(input.deviceStatus ?? '');
  switch (input.taskType) {
    case 'device_delivery':
      return status === 'pending_delivery'
        ? allowed('الجهاز بانتظار التسليم')
        : denied('INVALID_DEVICE_STATUS', 'التسليم مسموح فقط لجهاز بانتظار التسليم');
    case 'device_installation':
      return status === 'delivered'
        ? allowed('الجهاز مسلم وجاهز للتركيب')
        : denied('INVALID_DEVICE_STATUS', 'التركيب يحتاج جهازا بحالة delivered');
    case 'device_activation':
      return status === 'installed'
        ? allowed('الجهاز مركب وجاهز للتشغيل')
        : denied('INVALID_DEVICE_STATUS', 'التشغيل يحتاج جهازا بحالة installed');
    case 'device_checkup':
      return ['delivered', 'installed', 'active'].includes(status)
        ? allowed('يمكن تسجيل الحالة الفنية للجهاز')
        : denied('INVALID_DEVICE_STATUS', 'التشييك يحتاج جهازا موجودا لدى الزبون');
    case 'device_disconnection':
      return status === 'active'
        ? allowed('الجهاز فعال ويمكن فكه')
        : denied('INVALID_DEVICE_STATUS', 'الفك يحتاج جهازا بحالة active');
    case 'device_retrieval':
    case 'device_transfer':
      if (status !== 'out_of_service') {
        return denied('INVALID_DEVICE_STATUS', 'المهمة تحتاج جهازا مفكوكا بحالة out_of_service');
      }
      return input.hasSuccessfulDisconnection
        ? allowed('الجهاز مفكوك ويمكن متابعة المهمة')
        : denied('DISCONNECTION_RESULT_REQUIRED', 'المهمة تحتاج نتيجة فك ناجحة سابقة');
    case 'device_return':
      if (status !== 'in_workshop') {
        return denied('INVALID_DEVICE_STATUS', 'الإرجاع يحتاج جهازا بحالة in_workshop');
      }
      return input.hasSuccessfulMaintenanceRetrieval
        ? allowed('الجهاز في الورشة وجاهز للإرجاع')
        : denied('MAINTENANCE_RETRIEVAL_REQUIRED', 'الإرجاع يحتاج سحب صيانة ناجحا سابقا');
    case 'emergency_maintenance':
      return ['active', 'installed', 'faulty', 'out_of_service'].includes(status)
        ? allowed('يمكن فتح صيانة طارئة لهذا الجهاز')
        : denied('INVALID_DEVICE_STATUS', 'الصيانة الطارئة تحتاج جهازا ضمن مسار خدمة فعلي');
    case 'periodic_maintenance':
      if (status !== 'active') {
        return denied('INVALID_DEVICE_STATUS', 'الصيانة الدورية تحتاج جهازا بحالة active');
      }
      return input.hasContract || input.hasActiveServiceAgreement
        ? allowed('الجهاز يملك أساس خدمة دورية صالحا')
        : denied('SERVICE_BASIS_REQUIRED', 'الصيانة الدورية تحتاج عقدا أو اتفاق خدمة فعالا');
    case 'golden_warranty_offer':
      return input.hasActiveGoldenWarranty
        ? denied('ACTIVE_GOLDEN_WARRANTY_EXISTS', 'الجهاز يملك كفالة ذهبية فعالة بالفعل')
        : allowed('الجهاز مؤهل لعرض كفالة ذهبية');
    case 'golden_warranty_card_delivery':
    case 'warranty_cancellation':
    case 'warranty_reactivation':
      return input.hasActiveGoldenWarranty
        ? allowed('الجهاز مرتبط بكفالة ذهبية فعالة')
        : denied('INVALID_DEVICE_STATUS', 'المهمة تحتاج كفالة جهاز مؤهلة');
    case 'device_repair':
    case 'parts_sale':
      return denied('UNSUPPORTED_TASK_TYPE', 'مسار إنشاء هذه المهمة غير مكتمل حاليا');
    default:
      return denied('UNSUPPORTED_TASK_TYPE', 'نوع المهمة غير مدعوم');
  }
}
