const ARABIC_BREAKDOWN_LABELS: Record<string, string> = {
  mobile_app: 'تطبيق الموبايل',
  PhoneCall: 'مكالمة هاتفية',
  SocialMedia: 'وسائل التواصل',
  Acquaintance: 'معرفة شخصية',
  correct: 'صحيحة',
  incorrect: 'تحتاج تصحيحًا',
  Complete: 'مكتملة',
  Partial: 'جزئية',
  Minimal: 'حد أدنى',
  Undefined: 'غير محددة',
};

/** تعريب دفاعي لنتائج الكاش القديمة التي قد تحمل label الخام. */
export function breakdownLabel(key: string, fallback: string): string {
  return ARABIC_BREAKDOWN_LABELS[key] ?? ARABIC_BREAKDOWN_LABELS[fallback] ?? fallback;
}
