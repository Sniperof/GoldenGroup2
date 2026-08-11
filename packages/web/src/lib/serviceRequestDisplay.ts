type AuditEventLike = {
  eventType?: string;
  event_type?: string;
  eventPayload?: Record<string, unknown> | null;
  event_payload?: Record<string, unknown> | null;
};

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && !/^\d+$/.test(text) ? text : null;
}

/** The single deepest administrative unit used by request tables. */
export function deepestAdministrativeArea(raw: any): string {
  const address = raw?.serviceAddress ?? raw?.service_address ?? {};
  const labels = address?.labels ?? {};

  return [
    raw?.branchResolutionGeoUnitName,
    raw?.branch_resolution_geo_unit_name,
    labels.neighborhood,
    labels.sub_area,
    labels.city_or_area,
    labels.governorate,
    address.neighborhoodName,
    address.subdistrictName,
    address.regionName,
    address.governorateName,
    address.neighborhood,
    address.sub_area,
    address.city_or_area,
    address.governorate,
  ].map(nonEmptyText).find(Boolean) ?? '—';
}

const REVIEW_REASON_LABELS: Record<string, string> = {
  duplicate_detected: 'اكتشف النظام تشابهاً مع طلب خدمة قائم.',
  account_duplicate_detected: 'اكتشف النظام تشابهاً مع حساب أو طلب إنشاء حساب قائم.',
  submitter_unverified: 'أُرسل الطلب من مستخدم أو جهاز غير موثّق ويحتاج تحققاً بشرياً.',
  reopen_count_exceeded: 'تجاوز الطلب الحد المسموح لمرات إعادة الفتح.',
  manual_escalation: 'تم رفع الطلب يدوياً إلى المدقّق.',
};

const BRANCH_REASON_BY_STATUS: Record<string, string> = {
  missing_geo: 'بيانات الموقع الإداري ناقصة ولا تكفي لتحديد الفرع.',
  no_coverage: 'لا يوجد فرع نشط يغطي الموقع الإداري المحدد.',
  ambiguous: 'الموقع الإداري يطابق تغطية أكثر من فرع ويحتاج حسم الفرع يدوياً.',
};

function describeReviewReason(payload: Record<string, unknown>): string {
  const reason = nonEmptyText(payload.reason);
  if (reason === 'branch_resolution_required') {
    const status = nonEmptyText(payload.branch_resolution_status);
    return (status && BRANCH_REASON_BY_STATUS[status])
      ?? 'تعذّر تحديد الفرع تلقائياً من الموقع الإداري.';
  }
  return (reason && REVIEW_REASON_LABELS[reason]) ?? reason ?? 'لم يُسجّل سبب تفصيلي للوسم.';
}

/** All distinct persisted reasons that currently explain the review flag. */
export function reviewRequiredReasons(events: AuditEventLike[] | null | undefined): string[] {
  const reasons = (events ?? [])
    .filter((event) => (event.eventType ?? event.event_type) === 'review_required_flag_set')
    .map((event) => describeReviewReason(event.eventPayload ?? event.event_payload ?? {}));
  return [...new Set(reasons)];
}
