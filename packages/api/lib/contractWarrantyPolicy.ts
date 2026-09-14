// ────────────────────────────────────────────────────────────────────────────
// كفالة العقد خاصية للجهاز لا يتجاوزها البائع (قرار 2026-09-14).
//
// كانت قائمة «فترة كفالة العقد» في النموذج تعرض 6/12/24/36 شهراً حين لا يملك
// الموديل كفالات معرّفة — وهي أرقام غير مخزَّنة في أي جدول، تعيش داخل مكوّن
// واجهة فقط. فكان البائع يمنح كفالة لا يعرفها الكتالوج، ويُخزَّن عدد زياراتها
// صفراً لأنها بلا بند تُقرأ منه. وعدد الزيارات هو ما يحدّد فاصل الصيانة
// الدورية، فالكفالة تُسجَّل في العقد وتبقى بلا أي أثر تشغيلي.
//
// المصدر الوحيد الآن: device_models.warranty_periods. والمدة والزيارات تُؤخذان
// معاً من البند نفسه، فلا تُفبرك إحداهما دون الأخرى. والواجهة ليست الحارس.
// ────────────────────────────────────────────────────────────────────────────

export interface DeviceWarrantyPeriod {
  months: number;
  visits: number;
  label: string;
}

/** بنود الكفالة الصالحة على موديل: مدة موجبة وعدد زيارات موجب. */
export function parseDeviceWarrantyPeriods(raw: unknown): DeviceWarrantyPeriod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => ({
      months: Number(entry?.months),
      visits: Number(entry?.visits),
      label: String(entry?.label ?? ''),
    }))
    .filter(p => Number.isInteger(p.months) && p.months > 0 && Number.isInteger(p.visits) && p.visits > 0);
}

export interface WarrantyCheckResult {
  ok: boolean;
  error?: string;
  /** القيم المعتمدة بعد التحقق — تُكتب كما هي فلا ينفصل العدد عن المدة. */
  warrantyMonths: number;
  warrantyVisits: number;
}

/**
 * يتحقق أن (المدة، الزيارات) بندٌ معرَّف على الموديل. «بدون كفالة» مقبول دائماً.
 * الزيارات تُشتق من البند المطابق ولا تُؤخذ من العميل إطلاقاً.
 */
export function checkContractWarranty(
  requestedMonths: unknown,
  devicePeriodsRaw: unknown,
  deviceModelName?: string | null,
): WarrantyCheckResult {
  const months = Number(requestedMonths) || 0;
  if (months <= 0) return { ok: true, warrantyMonths: 0, warrantyVisits: 0 };

  const periods = parseDeviceWarrantyPeriods(devicePeriodsRaw);
  if (periods.length === 0) {
    return {
      ok: false,
      error: `لا توجد كفالات معرّفة على الموديل${deviceModelName ? ` «${deviceModelName}»` : ''}، فلا يمكن منح كفالة في العقد. تُعرَّف من إدارة الأجهزة.`,
      warrantyMonths: 0,
      warrantyVisits: 0,
    };
  }

  const match = periods.find(p => p.months === months);
  if (!match) {
    return {
      ok: false,
      error: `مدة الكفالة (${months} شهر) غير معرّفة على هذا الموديل. المتاح: ${periods.map(p => p.label || `${p.months} شهر`).join('، ')}.`,
      warrantyMonths: 0,
      warrantyVisits: 0,
    };
  }

  return { ok: true, warrantyMonths: match.months, warrantyVisits: match.visits };
}
