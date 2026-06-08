# مرجع كامل — إعادة بناء صفحة تفاصيل الزيارة (Visit Detail Page)

> **اللغة:** عربية موحدة  
> **النطاق:** Frontend فقط — `VisitDetailPage.tsx` + `ClientInfoCard.tsx`  
> **الباك ايند جاهز:** `snapshots.ts` + `fieldVisits.ts` + `telemarketing.ts` + `openTasks.ts` — كلها شغالة  
> **الهدف:** بناء صفحة تفاصيل الزيارة بـ ٧ أقسام دقيقة حسب رؤية المستخدم

---

## ٠) خلاصة — شو صار وشو لازم يصير

**الباك ايند:**
- `packages/api/lib/snapshots.ts` — شغال (بيبني `customer_snapshot` + `contract_snapshot`)
- `packages/api/routes/fieldVisits.ts` — شغال (بيرجّع `customer_snapshot` + `contract_snapshot` + `teamData` + `station` + `appointmentInfo` + `cancellationInfo`)
- `packages/api/routes/telemarketing.ts` — شغال (بيمتلي snapshot وقت الحجز)
- `packages/api/routes/openTasks.ts` — شغال (بيمتلي snapshot وقت إغلاق الطوارئ)

**الفرونت اند:**
- `VisitDetailPage.tsx` الحالي = النسخة القديمة (٤٦٧ سطر). لازم يُبنى من جديد.
- `ClientInfoCard.tsx` موجود — لازم تعديل طفيف (يقرأ `branchName` من snapshot)

---

## ١) هيكل الـ Response من `GET /field-visits/:id`

الـ API جاهز بيرجّع هالهيكل:

```typescript
interface VisitResponse {
  // === الأساسيات ===
  id: number;
  status: string; // scheduled | in_progress | ended | completed | not_completed | cancelled | postponed_by_company | postponed_by_customer | needs_reschedule
  visit_type: string;
  visit_family: string;
  scheduled_date: string | null;
  scheduled_time: string | null;

  // === بيانات الزبون (من customer_snapshot) ===
  client_name: string;
  first_name: string;
  father_name: string;
  last_name: string;
  nickname: string | null;
  client_mobile: string | null;
  client_contacts: Array<{ number, type, label, isActive, supportsWhatsapp, isPrimary }> | null;
  occupation: string | null;
  spouse_occupation: string | null;
  water_source: string | null;
  rating: string | null; // 'Committed' | 'NotCommitted' | 'Undefined'
  client_referrers: Array<{ type, method, name, notes }> | null;
  candidate_status: string | null;
  clientOwnership: { ownerType, ownerLabel } | null;

  // === العنوان (من customer_snapshot.address) ===
  address: {
    governorate: string | null;   // اسم المحافظة
    district: string | null;      // اسم المنطقة
    subDistrict: string | null;   // اسم الناحية
    neighborhood: string | null;  // اسم الحي (null إذا neighborhood = level 3)
    detailedAddress: string | null;
    gps: string | null; // format: "lat,lng"
  };

  // === الفرع ===
  branch_name: string | null;

  // === معلومات الموعد (من field_visits مباشرة) ===
  appointmentInfo: {
    scheduledDate: string | null;
    scheduledTime: string | null;
    bookedAt: string | null;        // appointment_booked_at
    telemarketerName: string | null;
    notes: string | null;           // telemarketer_notes
    answeredBy: string | null;      // 'customer' | 'spouse' | 'child' | 'other'
  } | null;

  // === المحطة ===
  station: {
    name: string | null;  // اسم المنطقة/الحي
  } | null;

  // === الفريق ===
  teamData: {
    original: { supervisor, technician, trainee } | null;
    reassigned: { supervisor, technician, trainee, at, byId, byName } | null;
    effective: { supervisor, technician, trainee } | null;
  };

  // === المحصلة ===
  geo: {
    actual_start_time: string | null;
    actual_end_time: string | null;
    actual_start_lat: number | null;
    actual_start_lng: number | null;
    actual_end_lat: number | null;
    actual_end_lng: number | null;
    duration_minutes: number | null;
    distance_meters: number | null;
    location_missing: boolean;
  } | null;

  cancellationInfo: {
    reasonId: number | null;
    reasonName: string | null;
    notes: string | null;
  } | null;

  field_notes: string | null;
  closed_at: string | null;

  // === المهام ===
  tasks: Array<{
    id: number;
    task_type: string;
    task_family: string;
    sequence_no: number;
    status: string;
    result_id: number | null;
    final_decision: string | null;
    closing_notes: string | null;
    task_type_label: string | null;
    location_basis: string | null; // 'client' | 'contract'
    contractId: number | null;
    contractSnapshot: {
      contractNumber: string;
      installationAddress: {
        geoUnit: { id, name } | null;
        hierarchy: Array<{ level, name }>;
        addressText: string | null;
        gps: { lat, lng } | null;
      };
      device: { modelName, serialNumber };
    } | null;
    // لـ device_demo
    deviceDemoResult: { offerType, offerAmount, installmentMonths, isDeviceSold } | null;
    // لـ الاسماء
    name_coll_id: number | null;
    proposed_count: number;
    actual_count: number;
    name_coll_status: string;
    directSuggestions: Array<{ name, phone, status }>;
  }>;

  // === المصدر ===
  source: { source_type, source_label } | null;

  // === لوائح الأسماء ===
  referralSheets: Array<any>;
}
```

---

## ٢) الأقسام السبعة بالصفحة (بالترتيب)

### القسم الأول: معلومات الموعد

**عنوان القسم:** `معلومات الموعد`

**البيانات (من `appointmentInfo`):**

| # | البيانة | المصدر | نوع العرض |
|---|---------|--------|-----------|
| ١ | **تاريخ التنفيذ** | `appointmentInfo.scheduledDate` | تاريخ بالعربية |
| ٢ | **الموعد المتوقع للوصول** | `appointmentInfo.scheduledTime` | وقت (مثلاً "10:00 - 12:00") |
| ٣ | **من رد على الاتصال** | `appointmentInfo.answeredBy` | ترجمة: `customer`→الزبون شخصياً، `spouse`→الزوج/الزوجة، `child`→الابن/الابنة، `other`→شخص آخر |
| ٤ | **تاريخ حجز الموعد** | `appointmentInfo.bookedAt` | تاريخ + وقت |
| ٥ | **اسم التيليماركتر** | `appointmentInfo.telemarketerName` | نص |
| ٦ | **ملاحظات التيليماركتر** | `appointmentInfo.notes` | نص |
| ٧ | **مصدر المياه** | `water_source` (من الزبون) | نص |
| ٨ | **محطة نطاق العمل المستهدفة** | `station.name` | اسم المنطقة |

> **تصميم:** بطاقة بيضاء معاينة (rounded-xl) مع border. عنوان القسم بخط عريض. البيانات بـ InfoRow (عنوان على اليمين، قيمة على اليسار).

---

### القسم الثاني: بيانات الزبون

**هاد القسم = `<ClientInfoCard data={clientData} />`**

**البيانات (من `customer_snapshot` fallback على live):**

| # | البيانة | المفتاح بـ `clientData` |
|---|---------|------------------------|
| ١ | الاسم الثلاثي | `name` = `[firstName, fatherName, lastName].join(' ')` |
| ٢ | اللقب الشائع | `nickname` |
| ٣ | التواصل | `contacts[]` + `mobile` |
| ٤ | العنوان | `address` (٤ مستويات + تفصيلي + GPS) |
| ٥ | الفرع | `branchName` |
| ٦ | الملكية | `ownership` |
| ٧ | مهنة الزبون | `occupation` |
| ٨ | مهنة الزوج/الزوجة | `spouseOccupation` |
| ٩ | تقييم الزبون | `rating` |
| ١٠ | الوسيط | `referrers[]` |

**هيكل `clientData`:**

```typescript
const clientData = {
  name: visit.first_name && visit.father_name && visit.last_name
    ? `${visit.first_name} ${visit.father_name} ${visit.last_name}`
    : visit.client_name,
  firstName: visit.first_name,
  fatherName: visit.father_name,
  lastName: visit.last_name,
  nickname: visit.nickname,
  mobile: visit.client_mobile,
  contacts: Array.isArray(visit.client_contacts) ? visit.client_contacts : [],
  address: visit.address, // { governorate, district, subDistrict, neighborhood, detailedAddress, gps }
  branchName: visit.branch_name,
  waterSource: visit.water_source,
  occupation: visit.occupation,
  spouseOccupation: visit.spouse_occupation,
  rating: visit.rating, // 'Committed' | 'NotCommitted' | 'Undefined'
  candidateStatus: visit.candidate_status,
  ownership: visit.clientOwnership,
  referrers: Array.isArray(visit.client_referrers) ? visit.client_referrers : [],
};
```

**ترجمة التقييم:**
- `'Committed'` → **زبون ملتزم** (أخضر)
- `'NotCommitted'` → **زبون غير ملتزم** (أحمر)
- `'Undefined'` أو null → **غير محدد** (رمادي)

> **ملاحظة:** `ClientInfoCard.tsx` موجود حالياً ومشروح بالدستور. لازم نتأكد إنه بيقرأ `address` صح من الـ snapshot.

---

### القسم الثالث: الفريق المسؤول

**عنوان القسم:** `الفريق المسؤول`

**البيانات (من `teamData`):**

| الدور | المصدر |
|-------|--------|
| المشرف | `teamData.effective.supervisor.name` |
| الفني | `teamData.effective.technician.name` |
| المتدرّب | `teamData.effective.trainee.name` |

**الفريق الرديف:**
إذا `teamData.reassigned != null` → نظهر قسم فرعي:
- عنوان: "الفريق الرديف"
- بيانات: `teamData.original.supervisor/technician/trainee`
- تاريخ التغيير: `teamData.reassigned.at`
- من قام بالتغيير: `teamData.reassigned.byName`

**زر تغيير الفريق:**
- يظهر فقط إذا `visit.status === 'scheduled'`
- يفتح مودال `ChangeTeamModal`
- المودال بيحتوي على ٣ dropdowns (مشرف، فني، متدرّب)
- لما يحفظ → `PATCH /field-visits/:id/team` مع `{ supervisorEmployeeId, technicianEmployeeId, traineeEmployeeId }`
- بعد الحفظ → `load()`

---

### القسم الرابع: لائحة الأسماء

**عنوان القسم:** `لائحة أسماء الزبون`

**البيانات:**
- اسم الزبون (من `visit.client_name`)
- عدد الأسماء المقترحة (من `referralSheets[].target_candidates`)
- زر "إضافة لائحة" بيفتح مودال بسيط: إدخال عدد الأسماء + ملاحظات

> **ملاحظة:** ما بنعرض أسماء الأفراد هون — التفاصيل تروح لـ "سجلات الأسماء المقترحة"

---

### القسم الخامس: مهام الزيارة

**عنوان القسم:** `مهام الزيارة ({tasks.length})`

**لكل مهمة:**

| البيانة | المصدر |
|---------|--------|
| نوع المهمة | `task.task_type_label` أو ترجمة `task.task_type` |
| العقد المرتبط | `task.contractSnapshot.contractNumber` + `task.contractSnapshot.device.modelName` |
| حالة المهمة | `task.status` |

**الإجراء حسب حالة الزيارة:**

| حالة الزيارة | الإجراء |
|-------------|---------|
| `scheduled` | عرض فقط |
| `in_progress` أو `ended` | زر "سجّل نتيجة" |
| `completed` / `not_completed` | عرض النتيجة |
| `cancelled` | لا شي |

**الإجراءات حسب نوع المهمة:**

| نوع المهمة | الزر | الوجهة |
|-----------|------|--------|
| `device_demo` | "تسجيل نتيجة العرض" | `DemoResultModal` |
| `device_delivery` | "تسجيل نتيجة التسليم" | `GeneralResultModal` (outcome: delivered_successfully / not_delivered) |
| `device_installation` | "تسجيل نتيجة التركيب" | `GeneralResultModal` (outcome: installed_successfully / not_installed) |
| `device_activation` | "تسجيل نتيجة التشغيل" | `GeneralResultModal` (outcome: activated_successfully / not_activated) |
| `emergency_maintenance` | "تسجيل نتيجة الصيانة" | `navigate(/emergency-result/${task.id})` |

**شروط ظهور الزر:**
```typescript
const canRecord = ['in_progress', 'ended'].includes(visit.status);
const showAction = canRecord && !task.result_id;
```

---

### القسم السادس: محصلة الزيارة

**عنوان القسم:** `محصلة الزيارة`

**البيانات (من `geo` + `visit.status` + `cancellationInfo`):**

| # | البيانة | المصدر |
|---|---------|--------|
| ١ | **حالة الزيارة** | `visit.status` → ترجمة |
| ٢ | **تاريخ الزيارة الفعلي** | `geo.actual_start_time` (التاريخ منه) |
| ٣ | **وقت بدء الزيارة** | `geo.actual_start_time` (الوقت منه) |
| ٤ | **وقت انتهاء الزيارة** | `geo.actual_end_time` (الوقت منه) |
| ٥ | **مدة الزيارة** | `geo.duration_minutes` → صياغة "ساعات ودقائق" |
| ٦ | **سبب الإلغاء** | `cancellationInfo.reasonName` + `cancellationInfo.notes` |
| ٧ | **ملاحظات الميدان** | `visit.field_notes` |
| ٨ | **مواقع GPS** | `geo.actual_start_lat/lng` + `geo.actual_end_lat/lng` → روابط خريطة |

> **تصميم:** بطاقة بخلفية خفيفة (slate-50). حالة الزيارة بـ badge ملوّن. الأوقات بـ font-mono. المواقع بروابط Google Maps.

---

## ٣) الملفات اللي المودل لازم يقراهن

### ملفات المرجع (ممنوع التعديل عليها):

| # | الملف | الغرض |
|---|-------|-------|
| ١ | `/opt/golden-crm/apps/staging/packages/web/src/components/ClientInfoCard.tsx` | شوف كيف بيعرض بيانات الزبون |
| ٢ | `/opt/golden-crm/apps/staging/packages/web/src/lib/api.ts` | شوف دوال الـ API المتاحة |
| ٣ | `/opt/golden-crm/apps/staging/packages/api/routes/fieldVisits.ts` السطر ٤٠٥-٧٤٠ | شوف هيكل الـ response من `GET /:id` |

### ملفات التعديل:

| # | الملف | التعديل |
|---|-------|---------|
| ١ | `/opt/golden-crm/apps/staging/packages/web/src/pages/visits/VisitDetailPage.tsx` | **أعد بناء من جديد** |
| ٢ | `/opt/golden-crm/apps/staging/packages/web/src/components/ClientInfoCard.tsx` | تعديل طفيف — `branchName` من snapshot + `rating` translation |

---

## ٤) قواعد العرض (UI Rules)

### VDP-R001 — Snapshot وليس Live
بعد تطبيق migration، بيانات الزبون (الاسم + العنوان + التواصل) بتُقرأ من `customer_snapshot`. **الـ API بيعمل fallback تلقائياً.**

### VDP-R002 — IDs مخفية
IDs المناطق محفوظة بالـ JSONB للـ backend. الـ UI بيعرض أسماء المناطق فقط.

### VDP-R003 — الفريق الجديد = الرئيسي
إذا `reassigned_supervisor_id IS NOT NULL` → الفريق الجديد بيظهر كرئيسي، القديم (من `team_snapshot`) كرديف.

### VDP-R004 — زر تغيير الفريق بس قبل البدء
يظهر فقط إذا `status = 'scheduled'`. لما الزيارة تبدأ (`in_progress`) → الزر يختفي.

### VDP-R005 — لائحة الأسماء = عدد فقط في الزيارة
الزيارة بتعرض العدد (SUM `proposed_count`). التفاصيل في `direct_suggestions` + `referral_sheets`.

### VDP-R006 — المحطة محسوبة تلقائياً
النظام يحسب عنوان المحطة من `visit_tasks` + `task_type_config.location_basis`. المستخدم لا يختار يدوياً.

### VDP-R007 — canRecord لـ in_progress + ended
الزر "سجّل نتيجة" يظهر لـ `in_progress` و `ended` فقط.

### VDP-R008 — التقييم بالعربي
الـ DB بيخزن `'Committed'` / `'NotCommitted'` / `'Undefined'`. الـ UI بيترجم للعربي.

---

## ٥) ملاحظات تقنية حاسمة

1. **لا تحذف** `NameCollectionModal` أو `DirectSuggestionForm` — هنّ موجودين ومستعملين
2. **لا تغيّر** `ClientInfoCard` كثير — بس أضف `branchName` من snapshot + `rating` translation
3. **الـ `station.name`** بيجي جاهز من الـ API — ما تحسبه بالفرونت اند
4. **الـ `contractSnapshot`** موجود على كل مهمة — استخدمه مباشرة
5. **الـ `teamData.effective`** = الفريق الحالي (الجديد إذا فيه تغيير)
6. **التصميم:** استخدم Tailwind classes — `rounded-xl`, `border`, `bg-white`, `shadow-sm`. خلفية الصفحة `bg-slate-50`.
7. **الخط:** text-sm للبيانات، text-xs للوصف، font-bold للعناوين.
8. **الاتجاه:** `dir="rtl"` على الصفحة.
9. **الأيقونات:** lucide-react فقط.

---

## ٦) التحقق (Verification)

بعد التطبيق:

1. افتح زيارة — كل ٧ أقسام لازم تظهر
2. افتح زيارة قديمة (قبل migration) — بيانات الزبون ظاهرة (fallback على live)
3. اضغط "تغيير الفريق" — لازم يفتح مودال
4. اضغط "بدء الزيارة" → "إنهاء الزيارة" → "تسجيل نتيجة" على أي مهمة
5. جرّب مهمة `device_delivery` أو `device_installation` — لازم يظهر زر "تسجيل نتيجة"
6. تأكد التقييم بيظهر عربي (زبون ملتزم / غير ملتزم / غير محدد)

---

## ٧) الخلاصة

> **الصفحة = ٧ أقسام:** موعد + زبون + فريق + أسماء + مهام + محصلة.
> الباك ايند جاهز — كل اللي لازم يتعمل هو إعادة بناء `VisitDetailPage.tsx` و تعديل `ClientInfoCard.tsx`.
