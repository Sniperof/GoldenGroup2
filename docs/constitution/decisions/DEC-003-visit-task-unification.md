# قرار معماري: توحيد الزيارة والموعد، وفصل الوعد عن التنفيذ

> **رقم القرار:** DEC-003
> **التاريخ:** 2026-05-31
> **الحالة:** ✅ معتمد
> **الأولوية:** 🔴 حرجة
> **الفجوات المرتبطة:** UV-G003, UV-G004
> **الكيانات المتأثرة:** field_visits, telemarketing_appointments, open_tasks, visit_tasks, visit_task_results

---

## 1. ملخص المعضلة

النظام يحوي **ازدواجية فعلية** بين الموعد (`telemarketing_appointments`) والزيارة (`field_visits`):

- نفس البيانات مخزّنة بمكانين: التاريخ، الوقت، الزبون، الفريق.
- snapshots مزدوجة قد تتعارض (مثلاً `water_source` snapshot صار `null` بعد تغيير schema الزبون).
- 5 ملفات backend تقرأ من `telemarketing_appointments` (telemarketing.ts, planning.ts, openTasks.ts, contactTargets.ts, clients.ts).
- لا يوجد PATCH للموعد (ثغرة الدستور 9.2) — التعديل يتطلب حذف وإعادة إنشاء.
- المستخدم النهائي لا يفرّق بين "موعد" و "زيارة" — الزيارة هي الموعد.

بالتوازي، علاقة `open_task` بـ `visit_task` غير محسومة بوضوح، مما يخلق التباس:
- هل `visit_task` نسخة من `open_task` أم نفسه؟
- هل النتيجة تُسجَّل مرة واحدة أم سجل تاريخي؟
- كيف نتتبع محاولات إعادة التنفيذ؟

---

## 2. القرارات المعتمدة

### D1 — توحيد الزيارة والموعد
`field_visits` هو الكيان الوحيد. `telemarketing_appointments` يُحذف بالكامل. لا يوجد كيان "موعد" منفصل عن الزيارة.

**السبب:** ما في معلومات حساسة في الجدول، المشروع في طور التطوير، التنظيف الجذري الآن أرخص من التعايش مع الازدواجية لاحقاً.

### D2 — endpoint الحجز
`POST /telemarketing/book-visit` يحل محل `POST /telemarketing/appointments`. زر الواجهة يبقى "حجز موعد" (UX familiar للمستخدم)، لكنه ينشئ `field_visit` مباشرة بحالة `scheduled`.

### D3 — مصدر الزيارة (`origin_type` + `origin_id`)
كل زيارة تحمل مصدرها صراحةً. القيم:
- `telemarketing` → `origin_id` = `telemarketing_call_logs.id`
- `manual` → `origin_id` = `hr_users.id` (المنشئ)
- `emergency_request` → `origin_id` = معرّف بلاغ الطوارئ
- `system` → `origin_id` = nullable أو معرّف الحدث

**السبب:** الزيارة قد تأتي من قنوات متعددة. النمط الموحد أبسط من FKs منفصلة لكل قناة.

### D4 — تصنيف الزيارة (`visit_type`)
`visit_type` ∈ {`marketing`, `service`, `mixed`}. التفصيل عبر `visit_tasks.task_type`. `visit_family` يُهمل كحقل تصنيفي.

**السبب:** زيارة قد تحوي مهاماً من عائلات مختلفة (عرض + تسليم) → نحتاج `mixed`. التفصيل النوعي على مستوى المهمة لا الزيارة.

### D5 — `open_task` ↔ `visit_task` = الوعد vs التنفيذ
`open_task` كيان دائم (الوعد). `visit_task` نسخة تنفيذية لمحاولة واحدة. الربط: `visit_tasks.source_open_task_id`.
**نتيجة واحدة فقط** لكل `visit_task` (صف واحد في `visit_task_results`).

**السبب:** الكيانان عمرهما مختلف ومسؤوليتهما مختلفة. الفصل يمنع تضارب الحقول ويعطي قراءة واضحة.

### D6 — سياسة إعادة المحاولة
كل زيارة تنشئ `visit_task` جديد بالكامل لنفس `open_task`. لا يُعاد استخدام `visit_task` قديم.

**النتيجة:** سجل المحاولات يصبح طبيعياً = chain من الـ `visit_tasks` تحت نفس `open_task`. كل محاولة مستقلة وقابلة للقياس.

### D7 — المهام المتسلسلة (cascading) داخل الزيارة
يجوز إنشاء `visit_task` جديد داخل زيارة `in_progress` عند توليد `open_task` جديد كـ side effect لمهمة سابقة (مثل: عرض جهاز → بيع → تسليم/تركيب/تشغيل بنفس الزيارة).

**السبب:** يعكس الواقع الميداني — الفني موجود، الزبون موافق، لا داعي لإنشاء زيارة جديدة.

---

## 3. التأثير على الكود

### 3.1 Migrations مطلوبة
1. إضافة أعمدة على `field_visits`: `origin_type`, `origin_id`, `appointment_booked_at`, `booked_by_telemarketer_id`, `telemarketer_notes`, `answered_by`, `customer_snapshot`, `cancellation_reason_id`, `cancellation_notes`.
2. ترحيل البيانات من `telemarketing_appointments` إلى `field_visits`.
3. تحديث `visit_type` constraint إلى {`marketing`, `service`, `mixed`}.
4. حذف جدول `telemarketing_appointments` وتوابعه.

### 3.2 Backend
- استبدال 5 ملفات تستخدم `telemarketing_appointments` بقراءة من `field_visits`.
- endpoint جديد: `POST /telemarketing/book-visit`.
- endpoint جديد: `POST /field-visits/:id/tasks` (cascading).
- إزالة BR-2 trigger القديم في `migration 050` (الموعد→الزيارة لم يعد له معنى).

### 3.3 Frontend
- تعديل `TelemarketerWorkspace.tsx` لاستدعاء endpoint الحجز الجديد.
- تحديث `api.ts` بإزالة `appointments.*` وإضافة `fieldVisits.book(...)`.
- صفحات تفاصيل المهام تعرض chain من `visit_tasks` تحت نفس `open_task`.

---

## 4. التأثير على الدستور

| الملف | التحديث |
|---|---|
| `features/unified-visit-model.md` | إغلاق UV-G003, UV-G004. إضافة §2.5/2.6/2.7. قواعد UV-R007/R008/R009. |
| `domains/visits.md` | كُتب كاملاً (كان draft فاضي). |
| `domains/tasks.md` | أُضيف §3.5 (open_task ↔ visit_task) بقرارات D5/D6/D7. |

---

## 5. غير المشمول بهذا القرار

- تفاصيل migrations DDL (تُكتب لاحقاً).
- تنفيذ ترحيل البيانات الفعلي.
- إعادة كتابة الواجهات.
- صلاحيات تفصيلية لـ `field_visits.*` (تبقى كما هي بعد ترحيل marketing_visits).

---

## 6. القرارات اللاحقة المعلّقة

- `P-DEC003-01`: ما هي قائمة المهام المسموح إضافتها cascading أثناء `in_progress`؟ (هل أي نوع، أم قائمة محددة؟)
- `P-DEC003-02`: عند إلغاء زيارة جارية، ما مصير الـ `visit_tasks` غير المكتملة؟ (تُلغى تلقائياً ولكن هل تُرحَّل لـ open_tasks للمتابعة؟)
- `P-DEC003-03`: ما حدّ المحاولات (`visit_tasks` count) قبل اعتبار `open_task` يحتاج تدخل إداري؟

---

## 7. المراجع

- `features/unified-visit-model.md`
- `features/visit-detail-page-constitution.md`
- `domains/visits.md`
- `domains/tasks.md`
- `domains/telemarketing.md` (BR-2 trigger chain — يتأثر)
