# قرار معماري: تنقيح دورة حياة الزيارة والمهام (Lifecycle & Workflow Refinement)

> **رقم القرار:** DEC-004
> **التاريخ:** 2026-05-31
> **الحالة:** ✅ معتمد
> **الأولوية:** 🔴 حرجة
> **يكمل/ينقّح:** DEC-003
> **الكيانات المتأثرة:** field_visits, visit_tasks, visit_task_results, open_tasks, contact_targets, telemarketing_call_logs, visit_geo_logs

---

## 1. الملخص التنفيذي

هذا القرار يكمل DEC-003 بتنقيح كامل لدورة حياة الزيارة، صلاحيات الفرق، آلية تسجيل النتائج، قواعد الحجز والإلغاء، وربط المهام بالخطة. يُغلق عدة فجوات مفتوحة، يبسّط نموذج الزيارة، ويوحّد آلية التتبع.

أبرز الانتقالات:
- **حذف إعادة الجدولة من الزيارة** — الزيارة موعد لمرة واحدة (cancel فقط).
- **حذف postponed/needs_reschedule** — 7 حالات بدل 9.
- **منع الحجز خارج خطة اليوم** — لا late-binding، لا تخمين فريق المستقبل.
- **آلية Schedule-from-Expected** — للوعود اللاحقة بدون مكالمة ثانية.
- **صلاحيات حسب نوع الفريق** — مشرف القياسي / فني الطوارئ.

---

## 2. القرارات (D7 → D23)

### D7 (موسّع) — Cascading أي open_task للزبون نفسه

الفريق المسؤول عن زيارة `in_progress` يستطيع إضافة **أي `open_task` للزبون نفسه** (موجود مسبقاً أو يُنشأ لحظياً) كـ `visit_task` داخل الزيارة.

- **لا قائمة بيضاء** — أي نوع مهمة مسموح.
- **شرط N-window معطّل** — يمكن إضافة مهمة استحقاقها بعد أسبوع.
- **القيد الوحيد:** نفس `field_visit.client_id`.

### D8 — لا إلغاء بعد البدء

`cancelled` مسموح **فقط من `scheduled`**. بعد `in_progress`، الزيارة لازم تنتهي بـ `ended` ثم تتحوّل لـ `completed` أو `not_completed` (بقرار من المسؤول إذا الفريق وصل ولقي الزبون مش موجود/الموقع مغلق).

### D9 — `ended` حالة وسيطة + completed تلقائي + escalation

- `ended` يعني "الفريق غادر الموقع، النتائج لسا غير موثّقة كلها".
- `completed` ينتقل **تلقائياً** عندما آخر `visit_task` يستلم نتيجة.
- **لا إغلاق تلقائي قسري** — قرار `not_completed` للمهام بدون نتيجة يتطلب فعل بشري صريح من حامل صلاحية الإقفال.
- **escalation:** بعد 24 ساعة على `ended` → إشعار للمشرف. بعد 48 ساعة → إشعار لمدير الفرع.
- **قيد زمني للفني:** بعد 48 ساعة، الفني يفقد صلاحية التسجيل المباشر.

### D10 — `open_task` يرجع لـ `last_waiting_status`

عند رجوع `open_task` من زيارة (إلغاء قبل البدء، أو `not_completed` بدون نتيجة محسومة):
- ترجع لآخر حالة كانت فيها **ضمن مرحلة قيد الانتظار** (`open` أو `needs_follow_up`).
- الحالات الوسيطة (`assigned`, `in_scheduling`, `scheduled`) لا تكون نقطة رجوع.
- `needs_follow_up` ليست fallback — تُكتب فقط بنتائج محددة.

### D11 — صلاحيات حسب نوع الفريق

| الفريق | المسؤول عن البدء/الإنهاء/تسجيل النتائج |
|---|---|
| فريق قياسي (`TeamSlot`) | المشرف |
| فريق طوارئ (`EmergencySlot`) | الفني |
| فريق رديف | الدور المقابل في الفريق الرديف |

| الفعل | قبل `ended` | بعد `ended` |
|---|---|---|
| تسجيل نتيجة | المسؤول | فقط حامل صلاحية الإقفال |
| تعديل نتيجة | المسؤول (نفسه) | فقط حامل صلاحية الإقفال |
| إقفال `closed` | ❌ | حامل صلاحية الإقفال |
| فتح `closed` | — | فقط بصلاحية إدارة عليا جديدة `field_visits.reopen_closed` + سبب مكتوب |

### D12 — `customer_snapshot` = Level 2 (Standard Snapshot)

يتبع هيكل **Standard Snapshot (المستوى الثاني)** من `components/client-snapshot.md`. يشمل: الهوية الكاملة + التواصل + العنوان الكامل + المعلومات الشخصية + الوسطاء (count) + الملاحظات + المسؤولين + sourceChannel.

### D13 — تتبع `creation_origin` للمهام خارج الخطة

كل إنشاء/إضافة لمهمة يُعلَّم بـ:

| الحقل (جديد) | المعنى |
|---|---|
| `creation_origin` | `branch_plan` \| `service_request_call` \| `telemarketing_inline_booking` \| `cascading_during_visit` \| `manual_creation` \| `emergency_request` \| `system_trigger` |
| `assigned_by` | FK → `hr_users` — من نقل لـ `assigned` |
| `assigned_at` | TIMESTAMPTZ |
| `assigned_via` | `planning_calculation` \| `telemarketing_booking` \| `manual_override` \| `cascading` |

شاشة "المهام خارج الخطة" لمدير الفرع تفلتر `creation_origin != 'branch_plan'`.

### D14 — سيناريوهان لنتيجة المكالمة

#### السيناريو 1: طلب خدمة (بدون حجز)

- نتيجة مكالمة = `service_request` (موجودة بـ BR-1).
- التيليماركتر تفتح نافذة "إضافة مهمة جديدة".
- تُنشأ `open_task` بحالة `open` + `creation_origin = 'service_request_call'`.
- المهمة تدخل الطابور الطبيعي → مدير الفرع يخطط لاحقاً.

#### السيناريو 2: حجز موعد

- نتيجة مكالمة = `booked_marketing_appointment`.
- التيليماركتر تختار `visit_tasks[]` (≥ 1):
  - من مهام مُسندة بالخطة (`branch_plan`).
  - أو من مهام مرفوضة/خارج الـ N-window (bypass).
  - أو ينشئ مهمة جديدة لحظياً → `creation_origin = 'telemarketing_inline_booking'`.
- ينطبق D18 (شرط الخطة المحفوظة).

### D15 — تسجيل النتيجة: موحّد + side إلزامي حسب النوع

#### الحقول الموحّدة في `visit_task_results`

| الحقل | إلزامي |
|---|---|
| `visit_task_id` | ✅ |
| `final_decision` | ✅ (`completed` \| `not_completed`) |
| `reason_code` | ✅ إذا `not_completed` |
| `reason_text` | اختياري |
| `closing_notes` | اختياري |
| `closed_by` | ✅ تلقائي |
| `closed_at` | ✅ تلقائي |

#### Side Table إلزامي حسب `task_type`

كل نوع مهمة له side table إلزامي بحقول دنيا (`visit_task_{type}_results`). النظام يرفض submit ناقص.

`reason_code`: من `system_lists` فئة `'visit_task_reasons'` أو فئة خاصة بالنوع.

### D16 — الزيارة `completed` بمجرد التوثيق

- الزيارة تنتقل `completed` تلقائياً عند توثيق كل المهام، **بغض النظر** عن نتيجتها (completed أو not_completed).
- `not_completed` على مستوى الزيارة = استثناء واحد: الفريق وصل ولم ينفّذ شيئاً (الزبون غير موجود، الموقع مغلق). يُسجَّل **يدوياً** من المسؤول + سبب إلزامي.
- في هذه الحالة: visit_tasks تُحذف، open_tasks ترجع لـ `last_waiting_status`.

### D17 — GPS إلزامي + `location_missing` استثناء صريح

#### البدء (`POST /field-visits/:id/start`)

| الحقل | إلزامي |
|---|---|
| `actual_start_time` | ✅ تلقائي |
| `actual_start_lat/lng/accuracy` | ✅ افتراضياً |
| `location_missing` | افتراضي `false` |
| `location_missing_reason` (جديد) | إلزامي إذا `location_missing = true` (من `system_lists` فئة `'location_missing_reasons'`) |
| `started_by` (جديد) | ✅ تلقائي |

#### الإنهاء (`POST /field-visits/:id/end`)

| الحقل | إلزامي |
|---|---|
| `actual_end_time` | ✅ تلقائي |
| `actual_end_lat/lng/accuracy` | ✅ افتراضياً |
| `duration_minutes` | ✅ محسوب |
| `distance_meters` | ✅ محسوب (Haversine) |
| `ended_by` (جديد) | ✅ تلقائي |

**القواعد:**
- مهلة GPS: 30 ثانية، بعدها يُعرض خيار `location_missing` + سبب.
- إذا `actual_start_lat/lng` بعيد > 500م من `customer_snapshot.gpsLat/Lng` → تحذير (لا رفض).
- مدّة دنيا 5 دقائق — أقل = تحذير.

### D18 — لا حجز خارج خطة اليوم، لا إعادة جدولة على الزيارة، إلغاء فقط

#### قواعد الحجز

عند `POST /telemarketing/book-visit`:
- `day_schedule` موجود لـ `scheduled_date`.
- `route_assignments` تشمل منطقة الزبون لذلك اليوم.
- التاريخ ≥ اليوم.

إذا أي شرط فشل → رفض.

#### إلغاء إعادة الجدولة على مستوى الزيارة

- ❌ يُلغى `PATCH /field-visits/:id/reschedule`.
- ❌ يُلغى `field_visits.status` ∈ {`postponed_by_company`, `postponed_by_customer`, `needs_reschedule`}.
- مفهوم "إعادة الجدولة" يتنقّل لمستوى المهمة (via D10 + D22).

#### دورة حياة الزيارة المُحدَّثة (7 حالات)

```
scheduled ──→ in_progress ──→ ended ──→ completed / not_completed
   │                                         └──→ closed
   └──→ cancelled
```

**الإلغاء يتطلب سبب** من `system_lists` فئة `'visit_cancellation_reasons'`.

### D22 — `expected_date` + `expected_time` + Schedule-from-Expected

#### نتيجة مكالمة جديدة في BR-1

- **`customer_requested_followup`** (طلب الزبون متابعة بموعد محدد) — جديد.

عند اختيارها:
- التيليماركتر تدخل `expected_date` + `expected_time` + سبب.
- `open_task.status`: `open` → `needs_follow_up`.
- `open_task.expected_date` + `open_task.expected_time` يتعبأو.
- لا زيارة تُنشأ.

#### حقل جديد على `open_tasks`

| الحقل | الوصف |
|---|---|
| `expected_time` 🆕 | VARCHAR — الوقت المتوقع |

#### Schedule-from-Expected

شاشة جديدة للتيليماركتر/مدير الفرع:
- تعرض `open_tasks` بحالة `needs_follow_up` مع `expected_date` ضمن نافذة قريبة.
- زر **"حجز زيارة من الموعد المتوقع"** يفتح فورم مُعبَّأ مسبقاً من `expected_date/time`.
- **بدون مكالمة جديدة** (العقد تم في المكالمة السابقة).
- `origin_type = 'expected_followup'` (قيمة جديدة).
- شرط: ينطبق D18 (الخطة محفوظة لذلك اليوم + المنطقة في route_assignments).

#### قيم `origin_type` المحدّثة

| القيمة | المعنى |
|---|---|
| `telemarketing` | حجز فوري من مكالمة |
| `expected_followup` 🆕 | حجز مؤجَّل من وعد سابق |
| `manual` | يدوي من مدير الفرع |
| `emergency_request` | بلاغ طارئ |
| `system` | side effect |

### D23 — `contact_target` يبقى مغلقاً بعد إلغاء الزيارة

- عند حجز الزيارة: `contact_target.status = 'closed'` + `latest_visit_id` يربط بالزيارة.
- عند إلغاء الزيارة: `contact_target` **لا يُعاد فتحه** — هدف اليوم تحقق بالتواصل.
- العمل اللاحق على `open_task` يكون عبر `contact_target` ليوم جديد أو من خطة المدير.

#### تغيير DB

- إعادة تسمية: `contact_targets.latest_appointment_id` → `latest_visit_id`.
- تحديث FK يشير إلى `field_visits(id)` بدل `telemarketing_appointments(id)`.

---

## 3. التأثير على الكود

### 3.1 Migrations جديدة

| الجدول | التغيير |
|---|---|
| `field_visits` | احذف القيم `postponed_by_company`, `postponed_by_customer`, `needs_reschedule` من CHECK constraint. أضف `cancellation_reason_id`, `cancellation_notes`. |
| `visit_geo_logs` | أضف `location_missing_reason`, `started_by`, `ended_by`. |
| `open_tasks` | أضف `expected_time`, `creation_origin`, `assigned_by`, `assigned_at`, `assigned_via`. |
| `contact_targets` | أعد تسمية `latest_appointment_id` → `latest_visit_id` + تحديث FK. |
| `system_lists` | أضف فئات: `visit_cancellation_reasons`, `location_missing_reasons`, `visit_task_reasons`, `customer_followup_reasons`. |
| `permissions` | أضف `field_visits.reopen_closed`. |
| `telemarketing_call_logs.outcome` CHECK | أضف `customer_requested_followup`. |

### 3.2 Backend جديد / محذوف

| Endpoint | الحالة |
|---|---|
| `PATCH /field-visits/:id/reschedule` | ❌ يُلغى |
| `POST /field-visits/:id/cancel` | ✅ يبقى + سبب إلزامي |
| `POST /open-tasks/:id/schedule-from-expected` | 🆕 |
| `POST /telemarketing/book-visit` | يفحص شرط D18 |
| Late team binding logic | ❌ غير لازم |
| Confirmation step logic | ❌ غير لازم |

### 3.3 Frontend

- `TelemarketerWorkspace`: نافذة "طلب متابعة" + إدخال expected_date/time.
- شاشة "متابعات اليوم" مع زر Schedule-from-Expected.
- شاشة "المهام خارج الخطة" لمدير الفرع.
- إزالة UI لـ reschedule الزيارة.

---

## 4. التأثير على الدستور

| الملف | التحديث |
|---|---|
| `features/unified-visit-model.md` | تحديث lifecycle (7 حالات)، إضافة قواعد D17/D18/D22، تحديث origin_type list |
| `domains/visits.md` | إعادة كتابة كاملة لـ §4 (lifecycle) و §5 (rules) و §7 (API) — تعكس D8/D9/D16/D17/D18 |
| `domains/tasks.md` | تحديث §3.5 لتشمل D7-expanded/D10/D13/D14/D22 + إضافة §3.6 (creation_origin) |
| `domains/telemarketing.md` | تحديث BR-2 (trigger chain جديد) + إضافة outcome جديد + إعادة تسمية latest_visit_id |

---

## 5. القرارات اللاحقة المعلّقة

- `P-DEC004-01`: تعريف قيمة dropdown reasons لكل فئة جديدة في `system_lists`.
- `P-DEC004-02`: نافذة Schedule-from-Expected — كم يوم قبل/بعد expected_date تظهر المهمة؟
- `P-DEC004-03`: حد escalation العلوي — بعد كم يوم بدون توثيق، تُغلق الزيارة قسرياً؟ (حالياً لا حد — قرار مفتوح).
- `P-DEC004-04`: تعريف الـ 20 نوع مهمة ضد الـ 15 سؤال الدستوري.
- `P-DEC004-05`: تفاصيل side tables لكل من الـ 20 نوع.

---

## 6. المراجع

- `features/unified-visit-model.md`
- `features/visit-detail-page-constitution.md`
- `components/client-snapshot.md`
- `domains/visits.md`
- `domains/tasks.md`
- `domains/telemarketing.md`
- `decisions/DEC-003-visit-task-unification.md`
