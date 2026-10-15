/** Display-only labels. Keep the stored final_decision codes unchanged. */
const DECISION_LABELS: Record<string, string> = {
  offer_presented: 'تم تقديم العرض',
  device_sold: 'تم بيع الجهاز',
  rescheduled: 'تمت إعادة الجدولة',
  reschedule: 'تمت إعادة الجدولة',
  cancelled: 'أُلغيت المهمة',
  accepted: 'مقبول (سجل قديم)',
  rejected: 'مرفوض (سجل قديم)',
  needs_followup: 'تحتاج متابعة',
  needs_follow_up: 'تحتاج متابعة',
  delivered_successfully: 'تم التسليم بنجاح',
  delivery_failed: 'تعذّر التسليم',
  customer_not_available: 'الزبون غير متوفر',
  wrong_address: 'العنوان غير صحيح',
  refused_delivery: 'رفض الزبون الاستلام',
  installed_successfully: 'تم التركيب بنجاح',
  installation_incomplete: 'التركيب غير مكتمل',
  refused_installation: 'رفض الزبون التركيب',
  activated_successfully: 'تم التشغيل بنجاح',
  activation_failed: 'تعذّر التشغيل',
  device_issue: 'تعذّر التشغيل بسبب عطل بالجهاز',
  checked_successfully: 'تم الفحص بنجاح',
  customer_refused_checkup: 'رفض الزبون الفحص',
  retrieved_successfully: 'تم سحب الجهاز بنجاح',
  customer_refused_retrieval: 'رفض الزبون سحب الجهاز',
  returned_successfully: 'تم إرجاع الجهاز بنجاح',
  customer_refused_return: 'رفض الزبون إرجاع الجهاز',
  transferred_successfully: 'تم نقل الجهاز بنجاح',
  customer_refused_transfer: 'رفض الزبون نقل الجهاز',
  disconnected_successfully: 'تم فك الجهاز بنجاح',
  disconnection_failed: 'تعذّر فك الجهاز',
  not_disconnected: 'لم يُفك الجهاز',
  customer_refused_disconnection: 'رفض الزبون فك الجهاز',
  requires_retrieval: 'يتطلب سحب الجهاز',
  unsafe_to_disconnect: 'الفك غير آمن حالياً',
  refused_gift: 'رفض الزبون الهدية',
  paid_full: 'تم تحصيل كامل الدفعة',
  paid_partial: 'تم تحصيل جزء من الدفعة',
  refused_to_pay: 'رفض الزبون الدفع',
  activated: 'تم التفعيل',
  delivered: 'تم التسليم',
  resolved: 'تم حل المشكلة',
  unresolved: 'لم تُحل المشكلة',
  performed: 'تمت الصيانة الدورية',
  partially_performed: 'تمت الصيانة الدورية جزئياً',
  not_performed: 'لم تتم الصيانة الدورية',
};

const TASK_DECISION_LABELS: Record<string, Record<string, string>> = {
  device_demo: { rescheduled: 'تم تأجيل العرض', cancelled: 'أُلغي العرض' },
  device_delivery: { rescheduled: 'تم تأجيل التسليم', delivered_successfully: 'تم تسليم الجهاز بنجاح' },
  device_disconnection: { rescheduled: 'تم تأجيل الفك' },
  device_checkup: { reschedule: 'تم تأجيل الفحص' },
  device_retrieval: { reschedule: 'تم تأجيل سحب الجهاز' },
  device_return: { reschedule: 'تم تأجيل إرجاع الجهاز' },
  device_transfer: { reschedule: 'تم تأجيل نقل الجهاز' },
  gift_delivery: { delivered_successfully: 'تم تسليم الهدية', rescheduled: 'تم تأجيل تسليم الهدية' },
  installment_collection: { rescheduled: 'تم تأجيل التحصيل' },
  golden_warranty_offer: { activated: 'تم تفعيل عرض الكفالة الذهبية', rescheduled: 'تم تأجيل العرض', cancelled: 'أُلغي العرض' },
  golden_warranty_card_delivery: { delivered: 'تم تسليم بطاقة الكفالة الذهبية', rescheduled: 'تم تأجيل تسليم البطاقة', cancelled: 'أُلغي التسليم' },
  emergency_maintenance: { cancelled: 'أُلغيت الصيانة' },
};

export function taskDecisionLabel(decision: string | null | undefined, taskType?: string | null): string {
  if (!decision) return 'غير مسجلة بعد';
  return (taskType ? TASK_DECISION_LABELS[taskType]?.[decision] : undefined)
    ?? DECISION_LABELS[decision]
    ?? 'نتيجة غير معرّفة';
}

const LEGACY_VISIT_OUTCOME_LABELS: Record<string, string> = {
  Pending: 'بانتظار التنفيذ',
  Completed: 'ناجحة',
  Cancelled: 'ملغاة',
};

export function legacyVisitOutcomeLabel(outcome: string | null | undefined): string {
  return outcome ? (LEGACY_VISIT_OUTCOME_LABELS[outcome] ?? 'حالة غير معرّفة') : 'غير محددة';
}
