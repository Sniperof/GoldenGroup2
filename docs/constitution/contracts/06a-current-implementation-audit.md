# Current Implementation Audit

## الهدف

هذا الملف هو جرد تنفيذي واضح بين:

- ما هو موجود فعلاً في الكود اليوم
- ما هو موجود جزئياً
- ما هو غير موجود بعد
- وما الذي يجب العمل عليه حتى يصبح المشروع منسجماً مع الدستور المعتمد في هذا المجلد

هذا الملف ليس ملف أسئلة مفتوحة، بل:

> مرجع فجوات تنفيذية بين الدستور الحالي والكود الحالي

> **تحديث:** القرارات المفهومية على هذه الفجوات حُسمت في [`08-resolved-decisions.md`](./08-resolved-decisions.md).
> هذا الملف يبقى مرجعاً لما ينقص **تنفيذياً** فقط، مع إحالة كل بند إلى قرار `DEC-CT-XX`.

## طريقة قراءة هذا الملف

كل محور هنا سيصنف إلى واحدة من الحالات التالية:

- **موجود**
- **موجود جزئياً**
- **غير موجود**

ومع كل بند سنثبت:

- ما الذي يطابق الدستور
- ما الذي يخالفه
- أين يقع في الكود
- وما الذي ينقصنا للعمل عليه

---

## أولاً: العقد ككيان قانوني وتشغيلي

### 1. الحقول الأساسية للعقد

**الحالة:** موجود

الموجود فعلاً في الكود:

- `status`
- `sale_type`
- `sale_source`
- `sale_subtype`
- `closing_employee_id`
- `source_open_task_id`
- `source_task_offer_id`
- `created_by`

المرجع التنفيذي:

- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)
- [packages/shared/types.ts](../../../packages/shared/types.ts)

الملاحظات:

- البنية الأساسية للعقد موجودة
- حقول التتبع والمصدر والاعتماد موجودة
- وهذا يعطينا أساساً جيداً لبناء النموذج المعتمد

ما ينقص:

- ترجمة المفاهيم الجديدة مثل:
  - صاحب البيعة
  - مالك التحصيل
  - تمثيل الفريق الأول في النسخة القانونية
- إلى سلوك أو حقول تنفيذية أو snapshots أو اشتقاقات صريحة

### 2. حالات العقد

**الحالة:** موجود جزئياً

الموجود فعلاً:

- في الأنواع المشتركة:
  - `active`
  - `cancelled`
  - `temporary`

المرجع التنفيذي:

- [packages/shared/types.ts](../../../packages/shared/types.ts)
- [packages/web/src/pages/contracts/ContractForm.tsx](../../../packages/web/src/pages/contracts/ContractForm.tsx)
- [packages/web/src/pages/contracts/ContractDetail.tsx](../../../packages/web/src/pages/contracts/ContractDetail.tsx)

المخالفة للدستور:

الدستور (بعد DEC-CT-01) اعتمد:

- `draft`
- `active`
- `cancelled`
- `completed`
- `discarded` (بدلاً من `archived` لأنها مسودة مرفوضة)

بينما الكود ما زال:

- يعامل `temporary` كحالة عقد (يجب نقلها إلى `sale_type` — DEC-CT-01)
- لا يملك `draft / completed / discarded`

ما ينقص تنفيذياً (مرجع DEC-CT-01):

- توحيد `ContractStatus` في `shared/types.ts` بقيم: `draft / active / cancelled / completed / discarded`
- migration لتحويل `temporary` الحالية إلى `sale_type='temporary'` + `status='draft'` أو ما يناسبها
- ربط انتقال `draft → active` بتعيين `closing_employee_id`
- ربط انتقال `active → completed` تلقائياً عند سداد آخر قسط
- تعديل ContractForm و ContractDetail و API

### 3. عقد الصيانة / الجهاز الخارجي

**الحالة:** موجود لكنه لا يطابق الدستور

الموجود فعلاً:

- `contractType = 'sale_contract' | 'maintenance_contract'`

المرجع التنفيذي:

- [packages/shared/types.ts](../../../packages/shared/types.ts)
- [packages/web/src/pages/contracts/ContractForm.tsx](../../../packages/web/src/pages/contracts/ContractForm.tsx)
- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)

المخالفة للدستور:

الدستور اعتمد أن:

- الجهاز الخارجي لا يحتاج عقد بيع
- بل يحتاج نموذج خدمة مستقل

بينما التنفيذ الحالي ما زال يبقيه داخل عالم العقود باسم `maintenance_contract`

**القرار محسوم (DEC-CT-02):** فصل فوري إلى كيان مستقل.

ما ينقص تنفيذياً:

- بناء جدول `service_agreements` كامل
- APIs مستقلة (`/api/service-agreements`)
- migration لنقل العقود الحالية من `contractType='maintenance_contract'`
- حذف `maintenance_contract` من enum `contractType`
- (مفتوح) حسم علاقة الجهاز الخارجي بـ `installed_devices` (راجع 06 §5)

---

## ثانياً: الجهاز الفيزيائي

### 1. فصل الجهاز عن العقد

**الحالة:** موجود

الموجود فعلاً:

- `installed_devices` موجود كجدول مستقل
- القراءة والكتابة الفيزيائية تتم عبره
- يوجد trigger لإنشائه عند `sale_contract`

المرجع التنفيذي:

- [migrations/190_create_installed_devices.sql](../../../migrations/190_create_installed_devices.sql)
- [migrations/191_installed_devices_trigger.sql](../../../migrations/191_installed_devices_trigger.sql)
- [packages/api/routes/installedDevices.ts](../../../packages/api/routes/installedDevices.ts)
- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)

هذا يطابق الدستور بشكل جيد.

### 2. حالات الجهاز التشغيلية

**الحالة:** موجود جزئياً

الموجود فعلاً:

- `pending_delivery`
- `delivered`
- `installed`
- `active`
- وفي بعض المسارات أو المهاجرات:
  - `faulty`
  - `retrieved`
  - `disconnected`
  - `under_maintenance`

المرجع التنفيذي:

- [packages/shared/types.ts](../../../packages/shared/types.ts)
- [packages/web/src/pages/contracts/ContractDetail.tsx](../../../packages/web/src/pages/contracts/ContractDetail.tsx)
- [migrations/178_device_status_extend.sql](../../../migrations/178_device_status_extend.sql)

المخالفة للدستور:

الدستور اعتمد:

- `registered`
- `pending_delivery`
- `delivered`
- `installed`
- `active`
- `faulty`
- `in_workshop`
- `ready`
- `out_of_service`
- `retrieved`

بينما الكود ما زال:

- يفتقد `registered`
- لا يملك `in_workshop`
- لا يملك `ready`
- يستعمل `under_maintenance` و`disconnected` من النموذج الأقدم

**القرار محسوم (DEC-CT-03):** تبني قاموس الدستور كاملاً + migration.

ما ينقص تنفيذياً:

- توحيد قاموس الحالة في:
  - `shared/types.ts`
  - واجهات العقود
  - API الجهاز
- migration:
  - `under_maintenance → in_workshop`
  - `disconnected → out_of_service`
  - إضافة قيم `registered`, `in_workshop`, `ready`
- مراجعة جميع triggers/checks للحالات القديمة

### 3. موقع التركيب

**الحالة:** موجود جزئياً

الموجود فعلاً:

- `installation_geo_unit_id`
- `installation_address_text`
- `installation_lat`
- `installation_lng`

المرجع التنفيذي:

- [packages/api/routes/installedDevices.ts](../../../packages/api/routes/installedDevices.ts)
- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)

ما يطابق الدستور:

- وجود موقع تركيب معتمد على الجهاز

ما ينقص:

- لا يوجد بعد تاريخ تغيرات مستقل لموقع التركيب
- لا يوجد فصل صريح في التنفيذ بين:
  - موقع التركيب المرجعي
  - وبين المواقع التشغيلية المؤقتة

### 4. سجل الحيازة

**الحالة:** غير موجود

**القرار محسوم (DEC-CT-09):** بناء `device_possession_log` كامل.

ما ينقص تنفيذياً:

- جدول `device_possession_log`:
  - `device_id`, `holder_type`, `holder_id`, `start_at`, `end_at`, `reason`
  - `holder_type` enum: `warehouse / technician / customer / workshop / supplier`
  - `reason` enum: `sale_delivery / repair_pickup / temporary_swap / retrieval / cancellation / transfer`
- API: `/api/devices/:id/possession-log`
- قواعد فتح/إغلاق transactional (الصف المفتوح = الحائز الحالي)
- ربط بمسارات: التسليم، الاسترجاع، السحب للورشة، الإعارة المؤقتة
- (مفتوح) سيناريوهات حافة في 06 §4

---

## ثالثاً: الكفالات

### 1. كيان الكفالة

**الحالة:** موجود

الموجود فعلاً:

- `device_warranties`
- مع API للقراءة والتعديل

المرجع التنفيذي:

- [migrations/196_device_warranties.sql](../../../migrations/196_device_warranties.sql)
- [packages/api/routes/deviceWarranties.ts](../../../packages/api/routes/deviceWarranties.ts)

هذا أساس قوي وموجود فعلاً.

### 2. بداية كفالة العقد

**الحالة:** موجود لكنه يخالف الدستور

الموجود فعلاً:

- `start_date` لكفالة العقد يكتب من `contractDate`

المرجع التنفيذي:

- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)

**القرار محسوم (DEC-CT-04):** بدء السريان عند نتيجة "مهمة تشغيل الجهاز".

ما ينقص تنفيذياً:

- `installed_devices.activated_at` (أصل تشغيلي) يُكتب عند إغلاق مهمة التشغيل
- `device_warranties.activated_at` (snapshot) يُجمَّد في نفس اللحظة
- `end_date` يُحسب من `device_warranties.activated_at` لا من `contract_date`
- إبقاء `contract_date` كمرجع قانوني للحق فقط

### 3. إلغاء الكفالة عند الإلغاء / الاسترجاع

**الحالة:** غير موجود بشكل صريح

**القرار محسوم (DEC-CT-05):** استبدال `is_active` بـ `status` enum + `cancellation_reason`.

ما ينقص تنفيذياً:

- migration: `device_warranties.is_active` → `status` enum (`pending / active / cancelled / expired`)
- إضافة `cancellation_reason` (`contract_cancelled / device_retrieved / manual`)
- إضافة `cancelled_at`, `cancelled_by`
- triggers تلقائية:
  - `contract.cancelled` + ذمم غير مستوفاة + جهاز `active` → الكفالة `cancelled` بسبب `contract_cancelled`
  - `device.retrieved` → الكفالة `cancelled` بسبب `device_retrieved`
- جدولة دورية أو computed: `end_date < NOW()` → `expired`

---

## رابعاً: المال

### 1. الدفعات

**الحالة:** موجود

الموجود فعلاً:

- `contract_payment_entries`
- إدخال/حفظ/عرض في API والواجهة

المرجع التنفيذي:

- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)
- [packages/web/src/pages/contracts/ContractDetail.tsx](../../../packages/web/src/pages/contracts/ContractDetail.tsx)

ما يطابق الدستور:

- الدفعة كحركة مالية فعلية

**القرار محسوم (DEC-CT-08):** `entry_type='refund'` في `contract_payment_entries`.

ما ينقص تنفيذياً:

- توسعة enum `entry_type` ليشمل `refund`
- حسم تمثيل المبلغ (سالب أم موجب + `direction`)
- ربط الـ refund بسبب الإلغاء (`cancellation_id` أو `notes`)
- مسار إلغاء يستحضر مبلغ الإرتجاع تلقائياً

### 2. الأقساط

**الحالة:** موجود

الموجود فعلاً:

- `contract_installments`
- حالات:
  - `pending`
  - `partial`
  - `paid`
  - `overdue`

المرجع التنفيذي:

- [packages/shared/types.ts](../../../packages/shared/types.ts)
- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)
- [packages/web/src/pages/contracts/ContractDetail.tsx](../../../packages/web/src/pages/contracts/ContractDetail.tsx)

هذا يطابق الجزء الأكبر من الدستور المالي.

### 3. الذمم

**الحالة:** موجود لكنه يخالف الاتجاه الجديد

الموجود فعلاً:

- `dues` ككيان مستقل كامل
- مع API تحديث وعرض مستقل

المرجع التنفيذي:

- [migrations/001_core_tables.sql](../../../migrations/001_core_tables.sql)
- [packages/api/routes/dues.ts](../../../packages/api/routes/dues.ts)
- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)

**القرار محسوم (DEC-CT-06):** إلغاء `dues` ككيان — الرصيد محسوب على القسط.

ما ينقص تنفيذياً:

- migration حذف جدول `dues` (مع نقل أي معلومة منه إلى `installments` إن لزم)
- إزالة API `/api/dues/*`
- بناء computed: `installment.remaining_balance = amount - SUM(allocated_payments)`
- تحديث الواجهات التي كانت تعرض dues لتستعلم عن `installments` ذات `remaining_balance > 0`
- تنبيه: قد يكون لـ dues مستهلكون آخرون — يلزم فحص شامل

### 4. سجل التحصيل

**الحالة:** غير موجود كنموذج واضح مستقل ضمن طبقة العقود

الموجود فعلاً:

- توجد متابعة للذمم
- وتوجد مهام وزيارات مرتبطة بالتحصيل

**القرار محسوم (DEC-CT-07):** لا كيان جديد. سجل التحصيل = مهام `task_type='collection'` مرتبطة بالقسط.

ما ينقص تنفيذياً:

- إضافة `task_type='collection'` (إن لم يكن موجوداً)
- ربط الـ task بـ `installment_id`
- نتيجة المهمة تربط بـ `payment_entry_id` المنبثقة
- واجهة "سجل التحصيل" تجمع tasks ذات النوع للعقد/القسط

### 5. كشف الحساب / دفتر الأستاذ

**الحالة:** موجود جزئياً

الموجود فعلاً:

- سجل مشتريات موحد للزبون

المرجع التنفيذي:

- [packages/api/routes/customerCalls.ts](../../../packages/api/routes/customerCalls.ts)

ما يطابق الدستور:

- وجود عرض موحد لبعض الحركات من زاوية الزبون

**القرار محسوم (DEC-CT-10):** لا ledger موحَّد. `customer_statement` view مشتقة.

ما ينقص تنفيذياً:

- بناء view / endpoint `customer_statement` يدمج:
  - `contract_installments` (الاستحقاقات + الأرصدة)
  - `contract_payment_entries` (القبض + الرد)
  - معلومات العقود الجامعة (الحالة، التواريخ)
- ترتيب زمني موحد مع رصيد جاري للزبون

---

## خامساً: القطع على الجهاز

### 1. سجل القطع على الجهاز

**الحالة:** موجود جزئياً

الموجود فعلاً:

- `device_installed_parts`
- API عرض على مستوى الجهاز

المرجع التنفيذي:

- [migrations/197_device_installed_parts.sql](../../../migrations/197_device_installed_parts.sql)
- [packages/api/routes/deviceParts.ts](../../../packages/api/routes/deviceParts.ts)

ما يطابق الدستور:

- وجود سجل تاريخي للقطع المرتبطة بالجهاز

ما ينقص:

- مصدر القطعة بشكل صريح
- مرجع دخولها: عقد / مهمة / مستقل
- من الفني الذي ركبها
- هل هي ما زالت مركبة حالياً أم لا
- كيف نمثل القطعة القديمة عند الاستبدال بشكل أعمق

### 2. سجل مشتريات القطع

**الحالة:** موجود جزئياً

الموجود فعلاً:

- `purchase-history` يجلب:
  - الجهاز المبيع
  - الاكسسوارات العقدية
  - قطع الصيانة الطارئة

المرجع التنفيذي:

- [packages/api/routes/customerCalls.ts](../../../packages/api/routes/customerCalls.ts)

ما ينقص:

- لا يغطي بعد كل الطبقات التي وثقناها مرجعياً
- ولا يفصل بوضوح بين:
  - السجل التجاري
  - والسجل الفني على الجهاز

---

## سادساً: الأطراف والملكية التشغيلية

### 1. منشئ العقد / موظف الإغلاق / مصدر البيع

**الحالة:** موجود جزئياً

الموجود فعلاً:

- `created_by`
- `closing_employee_id`
- `sale_source`
- `source_open_task_id`
- `source_task_offer_id`

المرجع التنفيذي:

- [packages/api/routes/contracts.ts](../../../packages/api/routes/contracts.ts)
- [packages/web/src/pages/contracts/ContractForm.tsx](../../../packages/web/src/pages/contracts/ContractForm.tsx)

**القرار محسوم (DEC-CT-11, 12, 13):**

ما ينقص تنفيذياً:

- `contracts.sale_owner_id` (FK employees) — DEC-CT-11
- `contract_installments.collection_owner_id` (FK employees) — DEC-CT-12
- `contracts.offer_team_snapshot` (JSON) يُجمَّد عند الإنشاء — DEC-CT-13
- واجهات تعيين/تعديل هذه الأطراف
- تحديث customer_statement وأي تقرير يلزمه فصل الأدوار

### 2. تمثيل الفريق الأول في النسخة القانونية

**الحالة:** غير موجود تنفيذياً

الدستور اعتمد:

- ممثل الفريق الأول في العقد المطبوع هو موظف الإغلاق فقط
- وإذا كان العقد مسودة يجب أن يظهر ذلك بوضوح

ما ينقص:

- عند تنفيذ printable contract لاحقاً
- يجب أن يشتق ذلك من:
  - `closing_employee_id`
  - `contract_status`

---

## سابعاً: العقد الإلكتروني القابل للطباعة

### 1. القالب القانوني

**الحالة:** غير موجود تنفيذياً

الموجود فعلاً:

- لا يوجد renderer أو HTML/PDF contract generator حتى الآن

الدستور أنجز:

- القالب المفاهيمي
- الـ placeholders
- النص القانوني المرجعي لعقد البيع القطعي

**القرار محسوم (DEC-CT-14, 15):** Hybrid — قوالب في الكود + `contract_documents` للنسخ المُولَّدة. Freeze عند `draft → active`.

ما ينقص تنفيذياً:

- مجلد قوالب في الكود: `packages/api/templates/contracts/` (versioned)
- جدول `contract_documents`: `contract_id, template_version, hash, frozen_at, pdf_path/blob`
- renderer (HTML) + PDF generator (puppeteer أو ما يناسب)
- تجميد تلقائي عند انتقال `draft → active`
- conditional sections: الحسم، الأقساط، الزيارات، حالة المسودة
- علامة "مسودة غير معتمدة" عند طلب PDF لمسودة بلا closing_employee
- منطق `amendment` لإصدار نسخة جديدة عند تعديل بنود — (مفتوح في 06 §3)

---

## ثامناً: الخلاصة التنفيذية

### ما هو موجود بقوة ويمكن البناء عليه مباشرة

- `installed_devices`
- `device_warranties`
- `device_installed_parts`
- `contract_payment_entries`
- `contract_installments`
- `purchase-history`
- حقول التتبع الأساسية في العقد

### ما هو موجود لكنه يحتاج مواءمة مع الدستور الجديد

- حالات العقد
- حالات الجهاز
- منطق بداية الكفالة
- الذمم ككيان مستقل
- عقد الصيانة كمسار داخل العقود

### ما هو غير موجود ويعد GAP حقيقياً

- سجل الحيازة
- سجل تحصيل واضح ككيان
- دفتر أستاذ / كشف حساب مالي رسمي
- منطق `refund_payment`
- printable contract renderer
- التمثيل التنفيذي الكامل للأطراف التشغيلية الجديدة

## الأولويات التنفيذية المعتمدة

استناداً إلى القرارات في [`08-resolved-decisions.md`](./08-resolved-decisions.md):

### المرحلة 1: الأنواع المشتركة والمخططات (foundation)

1. **DEC-CT-01**: توحيد `ContractStatus` في `shared/types.ts` + migration
2. **DEC-CT-03**: توحيد قاموس حالات الجهاز + migration للقيم القديمة
3. **DEC-CT-05**: تحويل `device_warranties.is_active` إلى `status` enum + `cancellation_reason`

### المرحلة 2: المالية

4. **DEC-CT-06**: إلغاء `dues` ككيان وبناء الرصيد المحسوب على القسط
5. **DEC-CT-08**: إضافة `entry_type='refund'`
6. **DEC-CT-12**: إضافة `installment.collection_owner_id`
7. **DEC-CT-10**: بناء view `customer_statement`

### المرحلة 3: الجهاز والحيازة

8. **DEC-CT-09**: بناء جدول `device_possession_log` + API
9. **DEC-CT-04**: ربط تفعيل الكفالة بـ `activated_at` (snapshot)

### المرحلة 4: الأطراف والعقد المطبوع

10. **DEC-CT-11**: إضافة `sale_owner_id`
11. **DEC-CT-13**: إضافة `offer_team_snapshot`
12. **DEC-CT-14/15**: بناء templates + `contract_documents` + freeze عند draft→active
13. **DEC-CT-07**: ربط مهام التحصيل بـ `installment_id`

### المرحلة 5: فصل عقد الصيانة

14. **DEC-CT-02**: بناء `service_agreements` + migration + حذف `maintenance_contract`
