// نظام الهدايا — الأنواع وتسميات العرض المشتركة.
//
// ملاحظة مهمة (دستور gifts.md، اختبار القبول الإلزامي لمصدر الحقيقة):
// هذا الملف لا يحتوي أي بيانات mock/prototype ولا أي helper يولّد سجل معاينة.
// كل الواجهات تقرأ سجلات وتعريفات الهدايا من `gift_records` / `gift_definitions`
// عبر `api.gifts.*`. عند فشل التحميل تُعرض حالة خطأ أو جدول فارغ، لا بيانات بديلة.

export type GiftConditionStatus = 'pending' | 'met' | 'not_met';
export type GiftRecordStatus =
  | 'promised'
  | 'approved_for_delivery'
  | 'delivery_task_created'
  | 'delivered'
  | 'delivered_manually'
  | 'cancelled'
  | 'refused';

export type GiftBeneficiaryType = 'contract_customer' | 'customer_referrer' | 'employee_or_personal';
export type GiftDefinitionKind = 'standard_gift' | 'gift_contract';

export interface GiftDefinitionPrototype {
  id: string | number;
  name: string;
  description?: string;
  kind: GiftDefinitionKind;
  defaultUnitLabel: string;
  isActive: boolean;
  deliveryAcknowledgementRequired: true;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GiftRecordSource {
  id: string | number;
  sourceType: 'contract' | 'name_list' | 'direct_referral';
  label: string;
  contractId?: string | number | null;
  contractNumber?: string | null;
  quantity?: number;
  notes?: string | null;
}

export interface GiftRecordPrototype {
  id: string | number;
  giftName: string;
  giftDefinitionId?: string | number;
  giftDefinitionKind?: GiftDefinitionKind;
  unitLabel: string;
  approvedQuantity: number;
  beneficiaryName: string;
  beneficiaryType: GiftBeneficiaryType;
  beneficiaryClientId?: string | number | null;
  beneficiaryEmployeeId?: string | number | null;
  customerId?: string | number | null;
  contractId?: string | number | null;
  contractNumber?: string | null;
  customerName?: string | null;
  conditionId?: string | number | null;
  conditionLabel: string;
  conditionStatus: GiftConditionStatus;
  status: GiftRecordStatus;
  sourceBranchId?: string | number | null;
  sourceBranchName?: string | null;
  responsibleBranchId?: string | number | null;
  responsibleBranchName?: string | null;
  assignedUserId?: string | number | null;
  assignedUserName?: string | null;
  beneficiaryOwnershipLabel?: string;
  createdAt: string;
  deliveryTaskId?: string | null;
  sources: GiftRecordSource[];
}

export const giftStatusLabels: Record<GiftRecordStatus, string> = {
  promised: 'وعد',
  approved_for_delivery: 'معتمد للتسليم',
  delivery_task_created: 'مهمة تسليم منشأة',
  delivered: 'تم التسليم عبر مهمة',
  delivered_manually: 'تم التسليم يدوياً',
  cancelled: 'ملغى',
  refused: 'رفض الهدية',
};

export const giftConditionStatusLabels: Record<GiftConditionStatus, string> = {
  pending: 'بانتظار التحقق',
  met: 'الشرط تحقق',
  not_met: 'الشرط لم يتحقق',
};

export const giftBeneficiaryTypeLabels: Record<GiftBeneficiaryType, string> = {
  contract_customer: 'زبون العقد',
  customer_referrer: 'وسيط زبون',
  employee_or_personal: 'وسيط موظف/شخصي',
};

export const giftDefinitionKindLabels: Record<GiftDefinitionKind, string> = {
  standard_gift: 'هدية عادية',
  gift_contract: 'عقد هدية',
};

export const giftStatusClasses: Record<GiftRecordStatus, string> = {
  promised: 'bg-amber-50 text-amber-700 border-amber-200',
  approved_for_delivery: 'bg-sky-50 text-sky-700 border-sky-200',
  delivery_task_created: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  delivered_manually: 'bg-teal-50 text-teal-700 border-teal-200',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
  refused: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const giftConditionClasses: Record<GiftConditionStatus, string> = {
  pending: 'bg-slate-50 text-slate-600 border-slate-200',
  met: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  not_met: 'bg-rose-50 text-rose-700 border-rose-200',
};
