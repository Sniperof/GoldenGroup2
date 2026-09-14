// ────────────────────────────────────────────────────────────────────────────
// مستوى عنوان التركيب — قاعدة واحدة يشترك فيها كل من يكتب عنوان جهاز.
//
// كان العنوان محصوراً بالحي (level 4)، وهو حصرٌ لا تحتمله الخريطة: 2158 ناحية
// من أصل 2232 لا يوجد تحتها أي حي، فيصل الموظف إلى خانة «الحي» فيجدها فارغة
// ولا يستطيع إكمال العقد.
//
// والحصر لم يكن مطبَّقاً أصلاً على كل الأبواب: مسارا نتيجة التسليم ونتيجة
// التركيب كانا يقبلان الناحية ويكتبانها على الجهاز، فنشأ تناقض بين المكتب
// والميدان. فتح المكتب يرفع هذا التناقض ولا يُحدث حالة جديدة.
//
// المطابقة في التخطيط تبقى حرفية بقرار صريح: محطة «ناحية» تسحب ما عنوانه تلك
// الناحية بالضبط، ولا تسحب أحياءها — فالأحياء محطات مستقلة تُضاف للمسار بذاتها.
// ────────────────────────────────────────────────────────────────────────────

/** المستويات المقبولة كعنوان تركيب: الناحية (3) أو الحي (4). */
export const INSTALLATION_GEO_LEVELS = [3, 4] as const;

export function isInstallationGeoLevel(level: unknown): boolean {
  const n = Number(level);
  return n === 3 || n === 4;
}

/** رسالة الرفض الموحّدة عند اختيار مستوى أعلى من الناحية. */
export const INSTALLATION_GEO_LEVEL_ERROR =
  'عنوان التركيب يجب أن يكون على مستوى الناحية أو الحي';

export const INSTALLATION_GEO_LEVEL_ERROR_CODE = 'installation_geo_level_invalid';

/**
 * عنوان التركيب من حمولة العقد.
 *
 * النموذج يرسل `geoSelection` فقط ولا يرسل `installationGeoUnitId` إطلاقاً،
 * فقراءة الأخير وحده كانت تُنتج null دائماً — أي أن حارس المستوى وحارس تغطية
 * الفرع كليهما لم يكونا يعملان على أي عقد أُنشئ من النموذج. وهذا يفسّر وجود
 * أجهزة مسجّلة على مستوى الناحية رغم الحصر المعلن.
 *
 * والاختيار يُقرأ من الأعمق: الناحية تملأ `subId` وتترك `neighborhoodId` فارغاً.
 */
export function readInstallationGeoUnitId(payload: any): number | null {
  const raw =
    payload?.geoSelection?.neighborhoodId
    || payload?.geoSelection?.subId
    || payload?.installationGeoUnitId
    || payload?.installation_geo_unit_id
    || null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
