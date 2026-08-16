// ============================================================
// reportingError.ts — نوع خطأ التقارير المشترك
// ============================================================
// مستخرَج من metricsService ليستطيع reportingScope رفضَ نطاق غير قابل للتطبيق
// (مثل ASSIGNED على مؤشر بلا موضوع إسناد) دون دورة استيراد:
//   metricsService → metricsCatalog → reportingScope → (كان) metricsService.
// metricsService يعيد تصديره فتبقى مواضع الاستيراد القائمة كما هي.
// ============================================================

export class ReportingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
