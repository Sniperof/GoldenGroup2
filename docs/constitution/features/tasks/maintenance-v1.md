# صيانة طارئة — النسخة الأولى القابلة للتنفيذ (V1.0)

> **الغرض:** نسخة مُقلَّصة من [`maintenance.md`](./maintenance.md) تُمثِّل أول إصدار قابل للبناء عليه لاحقاً.
> **العلاقة بالدستور:** الملف الدستوري الكامل يَبقى المرجع. هذا الملف يُحدِّد **ما يُنفَّذ الآن** وما يُؤجَّل لـ V2+، دون أن يَنفي شيئاً من الدستور.
> **النطاق:** `emergency_maintenance` فقط. `periodic_maintenance` خارج V1.0 كلياً.
> **آخر تحديث:** 2026-06-05

---

## ١ — الفلسفة المُختصَرة

> **مهمة الصيانة الطارئة = مهمة عادية مثل باقي المهام، مع طبقة intake واحدة بسيطة قبلها هي `service_request`.**

طبقة الـ intake في V1.0 **حدُّها الأدنى التشغيلي**: ربط صحيح بزبون موجود + جهاز موجود + وصف المشكلة + لائحة أعطال مُهيكَلة، ثم اعتماد. كل ما يَلي ذلك (الإسناد، الجدولة، الزيارة، النتيجة، التسوية المالية) يَجري على `open_task` و `visit_task` بالقواعد الموحَّدة للنظام، تماماً كـ `device_delivery` و `device_demo`.

---

## ٢ — نقاط الدخول لإنشاء الـ Service Request

| نقطة الدخول | القناة (`channel`) | السياق |
|---|---|---|
| زر "طلب طوارئ جديد" (floating داخلي) | `internal_button` | الموظف يُنشئ من أي شاشة |
| من مودل تسجيل نتيجة المكالمة (نتيجة = "طلب صيانة طوارئ") | `service_request_call` | نفس المودل الحالي لـ `emergency_tickets` يُعاد استخدامه شكلاً |
| من شاشة تفاصيل الزبون — زر "إنشاء صيانة" | `client_detail_button` | الزبون مُختار سَلفاً |
| إنشاء يدوي من لوحة الأدمن | `admin_manual` | حالات استثنائية |

**القنوات الخارجية** (`mobile_app`, `website`, `whatsapp`) — schema يَبقى مُحضَّراً، **لا endpoints ولا UI** في V1.0.

---

## ٣ — مودل الإنشاء (الحقول الإلزامية الدنيا)

> القاعدة الحاكمة: **لا walk-in في V1.0.** الزبون والجهاز مُختاران من السجلات الموجودة، إلزامياً، قبل الحفظ.

| الحقل | إلزامي | المصدر | ملاحظة |
|---|:---:|---|---|
| `beneficiary_client_id` | ✅ | بحث/اختيار من `clients` الموجودين | لا إنشاء client جديد من هذا المودل |
| `installed_device_id` | ✅ | بحث/اختيار من أجهزة الزبون المُختار | يَظهر فقط بعد اختيار الزبون |
| `problem_description` | ✅ | نص حر — صوت الزبون | immutable بعد الإنشاء (SR-R008) |
| `call_notes` | ❌ | نص حر — ملاحظات داخلية للموظف المستلِم | يُخزَّن كأوّل `internal_note` على الطلب |
| `attachments[]` | ❌ | صور/فيديو قصير من الزبون | JSONB حسب schema ٠.٧ |
| `requester_user_id` | ✅ (آلي) | الموظف الذي ضغط الزر | لقطة |
| `channel` | ✅ (آلي) | حسب نقطة الدخول | من جدول §٢ |
| `submission_type` | ✅ (آلي) | `apply` ثابت في V1.0 | (نموذج الأطراف الثلاثة مُؤجَّل) |
| `submitter_tier` | ✅ (آلي) | `staff` ثابت في V1.0 | (شرائح المستخدم مُؤجَّلة) |
| `device_source` | ✅ (آلي) | `company_device` ثابت في V1.0 | (external_device مُؤجَّل) |

**الحقول المُحضَّرة في schema لكن غير مُستخدَمة في V1.0** (تَبقى nullable):
- `requester_external`, `beneficiary_external`, `referrer_*`
- `external_device_name`, `external_device_serial`
- `service_address` (يُؤخَذ من الجهاز/الزبون عند الـ promote، لا يُدخَل في المودل)

---

## ٤ — لائحة الأعطال (مطلوبة في V1.0)

اللائحة (`service_request_problems`) تُبنى على نفس مودل الإنشاء أو في شاشة التفاصيل قبل promote:

- **حد أدنى:** عطل واحد قبل `promote` (`SR-AUTH-02` يُضاف لها هذا الشرط).
- كل عطل: `problem_type_id` من `system_lists.diagnosis_problem_types` + `details`.
- `installed_device_id` على كل عطل = نفس جهاز الطلب (V1.0 طلب واحد = جهاز واحد ⇒ EM-PROB-05 طبيعي).
- باقي قواعد ٠.١٩ كاملةً سارية: التمييز بين `recorded_by` و `repaired_by`، Field Discovery، Audit Admin override، soft delete، الـ 7 statuses.

> اللائحة تَنتقل ملكيتها لـ `open_task_id` عند الـ promote (لا نسخ).

---

## ٥ — آلة الحالات (4 حالات في V1.0)

```
received  ────→  in_review  ──→  resolved_at_intake   [terminal]
                     │      ──→  rejected             [terminal]
                     │      ──→  promoted             [terminal]
                     └──→  cancelled                  [terminal]
```

**المحذوف من الست الدستورية:** `awaiting_customer_info` (طلب معلومة من الزبون) — مُؤجَّل لـ V2.

**أثر تبعي على القواعد:**
- `expected_callback_at` يَبقى في schema لكن لا UI يَكتبه في V1.0.
- cron `cronAutoCancel` (٠.٤.ج) **لا يُفعَّل** في V1.0 (لا حالة `awaiting_customer_info` تَستوجبه).
- `customer_info_requested` / `customer_info_received` events لا تَظهر.

كل قواعد الانتقال SR-R001..R011 الأخرى سارية كما هي.

---

## ٦ — المخارج الفعّالة في V1.0

| المخرج | الحالة | `open_task`؟ | المُنفِّذ |
|---|---|:---:|---|
| **حُلَّ عند الاستلام** | `resolved_at_intake` | ❌ | Operator (قنوات triager-present فقط — §٢ كلها مؤهَّلة) |
| **رُفض** | `rejected` | ❌ | **Request Audit Admin حصراً** بعد `review_required_flag = TRUE` |
| **رُقّي إلى مهمة** | `promoted` | ✅ | Operator بعد ربط الزبون+الجهاز+عطل واحد على الأقل |
| **أُلغي إدارياً** | `cancelled` | ❌ | Operator أو Audit Admin بسبب مهيكَل |

---

## ٧ — ما يَبقى من الدستور كما هو (لا تبسيط)

| الموضوع | المرجع في الدستور | لماذا يَبقى |
|---|---|---|
| **Claim غير حصري + take-over** | ٠.٤.أ (SR-CLAIM-01..07) | الفريق المركزي يَحتاج المرونة من اليوم الأول |
| **Audit Admin منفصل + الصلاحية الثنائية** | ٠.١٦ (SR-AUTH-01..06) | الرفض حصراً للـ Audit Admin مع `review_required_flag` |
| **Duplicate detection** (pg_trgm، 3 محاور، threshold 0.75، نافذة 72h) | ٠.١٥.أ | الـ flag الآلي ضروري لمنع تشويش الفريق |
| **Reopen من terminal** (rejected/resolved_at_intake/cancelled) | ٠.٤.ب (SR-REOPEN-01..05) | السيناريو واقعي حتى في V1.0 |
| **EM-UNIQ (merge vs split)** عند البلاغ الثاني | EM-UNIQ-01..06 + المحور 8 | فهرس جزئي فريد + شاشة قرار. الافتراضي merge، الـ split بـ Audit Admin |
| **`public_ref_number = SR-YYYYMMDD-NNNN`** | ٠.٧.أ (SR-REF-01..05) | مرئي للزبون من اليوم الأول |
| **Audit log المُهيكَل** | ٠.١٧ | شرط القَبول، لا تَخفيف |
| **Immutability لبيانات الزبون** | SR-R008 + ٠.١٨ | يَنطبق على `problem_description` + `attachments` |
| **أرشفة لا حذف** | SR-R010 + ٠.١٨ | DB level |

---

## ٨ — ما يُؤجَّل صراحةً لـ V2+ (مع الإبقاء على schema-readiness)

| المُؤجَّل | الحالة في V1.0 |
|---|---|
| `awaiting_customer_info` + auto-cancel 7 أيام | schema جاهز، لا UI، لا cron |
| القنوات الخارجية (mobile/web/whatsapp) | schema جاهز، لا endpoints، لا auth |
| Walk-in (`requester_external` + `beneficiary_external`) | حقول JSONB موجودة، لا UI |
| نموذج الأطراف الثلاثة (`refer_a_candidate` + `referrer_*`) | حقول موجودة، `submission_type = 'apply'` ثابت |
| شرائح المستخدم (Visitor/Lead/FOP/OP) | `submitter_tier = 'staff'` ثابت |
| `external_device` في الـ intake | `device_source = 'company_device'` ثابت |
| `service_address` كـ snapshot قابل للتعديل | يُؤخَذ آلياً من الجهاز عند promote |
| `periodic_maintenance` كلياً | cron-only كما هو اليوم، خارج `service_requests` |
| **انتقال `emergency_tickets` legacy** | يَبقى عاملاً بالتوازي حتى Phase 7 (مرجع: implementation-plan §Phase 7) |

---

## ٩ — الانعكاس على خطة التنفيذ

كل المراحل في [`maintenance-implementation-plan.md`](./maintenance-implementation-plan.md) تَبقى سارية بـ **تعديلَين**:

### Phase 0 — Migrations
- ✅ كل الجداول تُنشأ بالـ schema الكامل (يَستوعب V2+).
- ✅ كل الـ CHECK constraints بالقيم الكاملة (6 حالات + 7 قنوات + إلخ).
- 🔒 الـ UI لا يَستخدم القيم خارج V1.0 — الحارس على طبقة التطبيق لا DB.

### Phase 2 — Backend Services
- ❌ احذف `cronAutoCancel.ts` من نطاق V1.0 (يُكتَب في V2).
- 🔒 `createService` يَفرض: `beneficiary_client_id NOT NULL` + `installed_device_id NOT NULL` + لا قبول لحقول walk-in JSON.
- 🔒 `promoteService` يَفرض: ≥1 عطل في اللائحة.

### Phase 3 — REST Endpoints
- ❌ `POST /service-requests/:id/request-info` و `POST /service-requests/:id/resume-review` خارج V1.0 (يَبقَيان في الـ router مُعطَّلَين بـ feature flag).

### Phase 4-5 — Frontend
- 🔒 مودل الإنشاء يَعرض: dropdown الزبون → dropdown الجهاز (مُفلتَر) → وصف → ملاحظات → مرفقات → "إضافة عطل" (≥1) → اعتماد.
- ❌ شاشة walk-in fields لا تُبنى.
- ❌ زر "طلب معلومة من الزبون" لا يَظهر في `ServiceRequestDetailPage`.

### Phase 6 — Wizard
- بدون تَغيير في النطاق.

### Phase 7 — Data Migration
- يَبقى كما هو.

---

## ١٠ — معايير القبول لـ V1.0

- [ ] إنشاء طلب من القنوات الأربع الداخلية يَعمل بزبون+جهاز إلزامي.
- [ ] لائحة أعطال ≥1 قبل promote.
- [ ] الأربعة مخارج تَعمل (resolved_at_intake / rejected / promoted / cancelled).
- [ ] `public_ref_number` يُولَّد بـ `SR-YYYYMMDD-NNNN`.
- [ ] Claim + take-over + notifications تَعمل.
- [ ] Audit Admin يَرفض، Operator لا يَستطيع.
- [ ] Duplicate detection يُفعِّل flag آلياً.
- [ ] Reopen من الـ terminal الثلاث المسموحة يَعمل.
- [ ] EM-UNIQ شاشة merge vs split تَظهر للبلاغ الثاني.
- [ ] Audit log كامل لكل event.
- [ ] السيناريوهات من [`maintenance-test-scenarios.md`](./maintenance-test-scenarios.md) المتعلقة بـ V1.0 تَمرّ — تَحديداً:
  - ✅ SC-01, SC-02, SC-04 (المسارات السعيدة بزبون موجود)
  - ✅ SC-06, SC-07 (الرفض الثنائي)
  - ❌ SC-03 (walk-in) — مُؤجَّل
  - ❌ SC-08 (auto-cancel) — مُؤجَّل
  - ✅ SC-09..12 (Claim + Reopen)
  - ✅ SC-13, SC-14, SC-16, SC-17 (Linking + Duplicates)
  - ⚠️ SC-15 (Candidate orphan) — يَعتمد على Walk-in، يُحذَف
  - ✅ SC-18, SC-19 (EM-UNIQ)
  - ✅ SC-20..23 (لائحة الأعطال)
  - ❌ SC-24, SC-25 (external device) — مُؤجَّل
  - ✅ SC-26..31 (immutability + audit + permissions)
  - ✅ SC-32..35 (Visit Wizard)

---

## ١٢ — فجوة الـ Promote في الـ UI الحالي (إلزامية الإغلاق في V1.0)

> **رصد 2026-06-05:** الـ backend والـ service و endpoint و زر الواجهة لـ promote **موجودة وكاملة**، لكن شروط الظهور والفشل تَجعل المسار غير قابل للوصول عملياً.

### المشاكل المرصودة

| # | الموقع | المشكلة | الأثر التشغيلي |
|---|---|---|---|
| 1 | `NewServiceRequestModal.tsx:40` | يَسمح بـ walk-in (`beneficiaryClientId = null`) | الطلب بـ `beneficiaryClientId = NULL` ⇒ زر promote مَخفي (السطر 247 في DetailPage) |
| 2 | `NewServiceRequestModal.tsx:35` | `installedDeviceId` فقط كـ prop خارجي، لا selector داخل المودل | لا جهاز مَربوط ⇒ promote يَفشل بـ SR-AUTH-02 من backend |
| 3 | `ServiceRequestDetailPage.tsx` | لا UI لربط جهاز لاحقاً بعد الإنشاء | حالات الـ legacy بلا جهاز عالِقة |
| 4 | `ServiceRequestDetailPage.tsx:247` | زر promote يَظهر بمجرد `beneficiaryClientId`، لا يَتحقق من جهاز ولا من ≥1 عطل | الزر يَظهر، الـ click يَفشل، تجربة سيّئة |

### التعديلات الإلزامية لإغلاق الفجوة في V1.0

#### (أ) `NewServiceRequestModal.tsx` — إلزام الزبون + الجهاز من المودل

- 🔒 **حذف وضع walk-in كلياً من المودل** (`isWalkIn` يُحذَف، حقول `requesterName`/`requesterPhone`/`requesterExternal` تُحذَف من الـ UI).
- 🔒 إضافة **`ClientSearchPicker`** إلزامي: بحث بالاسم/الهاتف داخل `clients` الموجودين، اختيار واحد ⇒ يُملأ `beneficiaryClientId`.
- 🔒 إضافة **`DevicePicker`** إلزامي يَظهر فور اختيار الزبون: قائمة `installed_devices` للزبون المُختار (status active)، اختيار واحد ⇒ يُملأ `installedDeviceId`.
- 🔒 **حذف حقول العنوان من المودل** (`governorate` + `detailedAddress`) — يُؤخَذ آلياً من الجهاز عند الـ promote.
- 🔒 **حذف `requesterExternal`** من الـ payload — يَبقى دائماً NULL في V1.0.
- 🔒 `validate()` الجديد:
  ```
  if (!beneficiaryClientId) return 'اختيار زبون موجود إلزامي';
  if (!installedDeviceId) return 'اختيار جهاز للزبون إلزامي';
  if (!problemDescription.trim()) return 'وصف المشكلة إلزامي';
  ```

#### (ب) `ServiceRequestDetailPage.tsx` — زر promote ذكي + سَدّ الـ pre-conditions

- 🔒 شرط ظهور الزر الجديد:
  ```tsx
  {req.status === 'in_review' && canReview &&
   req.beneficiaryClientId && req.installedDeviceId && problemsCount >= 1 && (
    <button onClick={doPromote}>ترقية إلى مهمة</button>
  )}
  ```
- 🔒 إذا أحد الشروط مفقود ⇒ يَظهر **زر مُعطَّل** مع tooltip يُبيِّن السبب:
  - "يَنقصك: ربط جهاز للزبون"
  - "يَنقصك: عطل واحد على الأقل في اللائحة"
- 🔒 إضافة **زر "ربط جهاز"** على شاشة التفاصيل إذا `installedDeviceId IS NULL` (يَفتح DevicePicker بنفس بيانات الزبون المربوط).
- 🔒 إضافة قسم "لائحة الأعطال" بارز على شاشة التفاصيل مع زر "إضافة عطل" (مودل بسيط: dropdown من `system_lists.diagnosis_problem_types` + textarea details).

#### (ج) `EmergencyProblemsSection.tsx` (إن وُجد منفصلاً) — يُعاد توصيله

- يُستخدَم نفس الـ component لإضافة/تعديل الأعطال على `service_request_problems` (لا على `emergency_tickets` legacy).

#### (د) endpoints مطلوبة موجودة فعلاً، تَحتاج فقط ربط UI

| Endpoint | الموجود؟ | يَستخدمه الـ UI الجديد؟ |
|---|:---:|:---:|
| `POST /service-requests/:id/link` (ربط beneficiary) | ✅ | للحالات القديمة فقط (الجديدة مَربوطة من الإنشاء) |
| **`PATCH /service-requests/:id/installed-device`** (ربط/تغيير جهاز) | ⚠️ يَجب التحقق | إن لم يَكن، يُضاف في Phase 3 |
| `POST /service-requests/:id/problems` | ✅ | نعم — مودل إضافة عطل |
| `POST /service-requests/:id/promote` | ✅ | نعم — زر الترقية |

### الأثر على معايير القبول §١٠

يُضاف بَنداً جديداً في checklist V1.0:
- [ ] من مودل الإنشاء، لا يُمكن حفظ طلب بدون زبون + جهاز + وصف.
- [ ] على شاشة التفاصيل، زر "ترقية إلى مهمة" يَظهر فعلياً ويَنجح للطلبات المُنشأة بـ V1.0 flow.
- [ ] الطلبات القديمة (legacy بدون جهاز) تَملك زر "ربط جهاز" مرئياً.
- [ ] محاولة promote بدون ≥1 عطل تُعطّل الزر مع tooltip واضح، لا تَفشل في الـ backend.

---

## ١١ — المراجع

- [`maintenance.md`](./maintenance.md) — الدستور الكامل (المرجع الأساسي لكل قاعدة لم تُذكَر هنا)
- [`maintenance-implementation-plan.md`](./maintenance-implementation-plan.md) — الخطة التقنية المرحلية
- [`maintenance-test-scenarios.md`](./maintenance-test-scenarios.md) — 35 سيناريو
- [`device-delivery.md`](./device-delivery.md) + [`device-demo.md`](./device-demo.md) — القالب المرجعي للمهام
