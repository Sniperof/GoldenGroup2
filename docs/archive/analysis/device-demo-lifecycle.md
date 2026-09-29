# مهمة عرض الجهاز — السيناريوهات الكاملة والكود الحالي

> **الغرض:** مرجع دراسة لفهم كيف تعمل مهمة عرض الجهاز حالياً قبل أي تعديل.
> **تاريخ الإنشاء:** 2026-05-13

---

## مرجع المتغيرات

| المتغير | القيمة | المعنى التشغيلي |
|---------|--------|----------------|
| `open_task.status` | `open` | المهمة موجودة وتنتظر — لم يتصل بها أحد |
| | `in_contact_list` | أُضيفت لقائمة التلمارك اليوم |
| | `scheduled` | موعد محجوز — الفريق مجدول |
| | `in_visit` | الفريق عند الزبون *(غير مستخدم فعلياً)* |
| | `completed` | انتهت المهمة — نتيجة مسجَّلة |
| | `needs_reschedule` | محاولة لاحقة مطلوبة |
| | `cancelled` | ألغيت نهائياً |
| `marketing_visit.status` | `scheduled` | الموعد محجوز — لم يذهب الفريق بعد |
| | `in_visit` | الفريق عند الزبون الآن |
| | `ended` | انتهت الزيارة *(غير مستخدم فعلياً)* |
| | `completed` | الزيارة مكتملة + نتيجة مسجَّلة |
| | `needs_reschedule` | الزيارة لم تكتمل — تحتاج إعادة |
| | `cancelled` | ألغيت |
| `marketing_visit_task.status` | `pending` | لم تُسجَّل نتيجة بعد |
| | `completed` | نتيجة إيجابية مسجَّلة |
| | `not_completed` | نتيجة سلبية مسجَّلة |
| `marketing_visit_task.outcome` | `device_sold` | تم البيع |
| | `offer_presented` | قُدِّم عرض بدون بيع |
| | `rescheduled` | لم يتم العرض — موعد جديد |
| | `cancelled` | إلغاء نهائي |
| `task_list_item.status` | `pending` | التلمارك لم يتصل بعد |
| | `called` | اتصل ولم يحجز |
| | `booked` | اتصل وحجز موعداً |

---

## المرحلة 1 — النشوء

### السيناريو 1.1 — إنشاء يدوي من الإدارة

**ما يحدث تشغيلياً:**
الإدارة ترى مرشحاً جاهزاً وتُنشئ مهمة عرض جهاز له.

**ما يفعله الكود:**
```
open_task يُنشأ بـ:
  status = 'open'
  task_type = 'device_demo'
  task_family = 'marketing'
  reason = 'new_lead' (الأكثر شيوعاً)
  due_date = NULL (لا يوجد تاريخ استحقاق)
  source = يحدده من أنشأها
```

**Edge Cases:**
- لا يوجد قيد في الكود يمنع إنشاء مهمتين `device_demo` لنفس الزبون
- لا تحقق أن الزبون ليس لديه عقد فعّال (قد يُعرض الجهاز على زبون اشترى سابقاً)

---

### السيناريو 1.2 — إنشاء تلقائي من needs_reschedule

**ما يحدث تشغيلياً:**
زيارة سابقة انتهت بإعادة جدولة → النظام يُنشئ مهمة جديدة.

**ما يفعله الكود:**
```sql
-- من applyTaskOutcome عند outcome = 'rescheduled'
INSERT INTO open_tasks (
  client_id, branch_id, task_type, task_family,
  reason, status, due_date, source, notes,
  origin, origin_ref_id   -- ← يحفظ رابط للمهمة الأم
)
SELECT ... FROM open_tasks ot WHERE ot.id = $oldTaskId

-- النتيجة:
open_task جديدة:
  status = 'needs_reschedule'
  reason = 'follow_up'
  origin = 'system'
  origin_ref_id = id المهمة القديمة ← الرابط التاريخي موجود
```

**Edge Cases:**
- المهمة الجديدة تُنشأ بحالة `needs_reschedule` وليس `open`
- يوجد `origin_ref_id` يربطها بالمهمة السابقة (التاريخ محفوظ جزئياً)
- لكن لا واجهة تعرض هذا التاريخ للمستخدم حالياً

---

## المرحلة 2 — قائمة الاتصال

**الانتقال:** `open` أو `needs_reschedule` → `in_contact_list`

**ما يفعله الكود (generate-from-plan):**
```sql
UPDATE open_tasks
SET status = 'in_contact_list'
WHERE id = $openTaskId AND status = 'open'
-- ملاحظة: يشترط status = 'open' فقط
-- المهام بحالة needs_reschedule لا تتغير حالتها عند إضافتها للقائمة
```

```
task_list_item يُنشأ بـ:
  status = 'pending'
  open_task_id = رقم المهمة
```

---

### السيناريو 2.1 — التلمارك يتصل ولا يرد أحد / مشغول

**ما يحدث تشغيلياً:**
التلمارك يسجل نتيجة الاتصال.

**ما يفعله الكود:**
```
call_log يُنشأ بـ outcome = 'no_answer' أو 'busy'
task_list_item.status يبقى = 'pending'  (itemStatusAfterSave = 'pending')
open_task.status يبقى = 'in_contact_list'  (لا تغيير)
contact_target.status → 'contacted' (إذا كان new/queued/in_call_list)
```

**Edge Cases:**
- لا يوجد حد أقصى لعدد المحاولات في الكود
- إذا انتهى اليوم بدون تواصل: open_task تبقى `in_contact_list`
- لا آلية لإعادتها إلى `open` تلقائياً بنهاية اليوم

---

### السيناريو 2.2 — التلمارك يتصل والزبون يرفض الموعد

**ما يحدث تشغيلياً:**
الزبون غير مهتم أو يرفض صراحةً.

**ما يفعله الكود:**
```
إذا outcome = 'not_interested' (أو مشابه):
  call_log يُنشأ
  task_list_item.status = 'called'
  open_task.status لا يتغير تلقائياً من الكود

إذا rejectScheduling = true (من واجهة التلمارك):
  open_task.status → 'needs_reschedule'
  ملاحظة سبب الرفض تُضاف في notes
```

**Edge Cases:**
- لا يوجد فرق في الكود بين "رفض مؤقت" و"رفض نهائي"
- كلاهما ينتهي بـ `needs_reschedule` أو يبقى `in_contact_list`
- لا `cancelled` تلقائي عند الرفض القاطع

---

### السيناريو 2.3 — التلمارك يتصل والزبون يقبل الموعد

**ما يحدث تشغيلياً:**
التلمارك يفتح نافذة الحجز ويحدد الوقت.

**ما يفعله الكود (POST /telemarketing/appointments):**
```
telemarketing_appointment يُنشأ ← سجل الحجز الثابت

open_task.status → 'scheduled'
  (الشرط: status = 'in_contact_list' فقط — يُهمَل بصمت إذا كانت غير ذلك)

task_list_item.status → 'booked'
task_list_item.call_outcome → 'booked_marketing_appointment'

contact_target.status → 'booked'

marketing_visit يُنشأ بـ:
  status = 'scheduled'
  id = 'mv_' + appointment.id

marketing_visit_task يُنشأ بـ:
  status = 'pending'
  task_type = 'device_demo'
  source_open_task_id = open_task.id
```

**Edge Cases:**
- لا يوجد تحقق في الباكند من وجود open_task (الحجز ينجح حتى بدون مهمة مرتبطة)
- التحقق من التعارض الزمني: فقط (teamKey + date + timeSlot) — لا يمنع حجز نفس الزبون مرتين
- إذا كانت open_task بحالة غير `in_contact_list`: تُصبح `scheduled` دون أن تمر بـ `in_contact_list`

---

## المرحلة 3 — موعد محجوز

```
open_task.status = 'scheduled'
marketing_visit.status = 'scheduled'
marketing_visit_task.status = 'pending'
```

### السيناريو 3.1 — الزيارة تسير بشكل طبيعي

**ما يفعله الكود:**
```
PATCH /marketing-visits/:id/status  { status: 'in_visit' }
  → marketing_visit.status = 'in_visit'
  → open_task.status لا يتغير (يبقى 'scheduled')
```

**Edge Cases:**
- `in_visit` موجود في `OpenTaskStatus` type لكن لا يُستخدم في open_task هنا
- الكود يسمح فقط: scheduled → in_visit → ended (لكن ended غير مستخدم فعلياً)

---

### السيناريو 3.2 — إلغاء الموعد قبل الزيارة (من الإدارة)

**ما يفعله الكود (PATCH /marketing-visits/:id/cancel):**
```
الشرط: marketing_visit.status IN ('scheduled', 'in_visit')

marketing_visit.status → 'cancelled'
open_task.status → 'open'  ← يعود للبداية!
  (nextOpenTaskStatus = 'open' عند targetStatus = 'cancelled')
```

**Edge Cases:**
- يتطلب `cancellationReasonId` من system_lists
- يتطلب `taskUpdates[]` (أي مهام مفتوحة مرتبطة)
- المهمة تعود لـ `open` وليس `needs_reschedule` — كأن الحجز لم يحدث

---

### السيناريو 3.3 — إعادة جدولة الموعد قبل الزيارة (من الإدارة)

**ما يفعله الكود (PATCH /marketing-visits/:id/reschedule):**
```
الشرط: marketing_visit.status IN ('scheduled', 'in_visit')

marketing_visit.status → 'needs_reschedule'
open_task.status → 'needs_reschedule'
  (nextOpenTaskStatus = 'needs_reschedule' عند targetStatus = 'needs_reschedule')
```

**Edge Cases:**
- يتطلب `rescheduleReasonId` من system_lists
- لا ينشئ موعداً جديداً تلقائياً — يعود للتلمارك

---

## المرحلة 4 — الزيارة جارية

```
marketing_visit.status = 'in_visit'
open_task.status = 'scheduled'  (لا يتغير)
marketing_visit_task.status = 'pending'  (لا يتغير)
```

**لا انتقالات من الكود في هذه المرحلة غير PATCH /status → ended (غير مستخدم)**

---

## المرحلة 5 — تسجيل النتيجة

**ملاحظة:** يوجد مساران في الكود:
- **المسار القديم (legacy):** `PATCH /marketing-visits/:id/result`
- **المسار الجديد (canonical):** `PATCH /marketing-visits/:visitId/tasks/:taskId/outcome`

**الجداول التالية تصف المسار الجديد (الأحدث والموصى به).**

---

### السيناريو 5.1 — البيع تم ✅

```
outcome = 'device_sold'

marketing_visit_task:
  status = 'completed'
  outcome = 'device_sold'
  sold_device_model_id = الجهاز المباع
  is_device_sold = true
  sale_reference_number = رقم تسلسلي مُولَّد

marketing_visit.status:
  → 'completed' (إذا كانت 'ended' وكل المهام لها outcome)
  → لا يتغير (إذا كانت 'in_visit') ← فجوة!

open_task.status → 'completed'
```

**Edge Cases:**
- لا إنشاء تلقائي للعقد — يجب إنشاؤه يدوياً
- لا تحقق أن الجهاز المباع هو نفس المطلوب عرضه
- إذا marketing_visit كانت `in_visit` (وليس `ended`): لا تُكمَل تلقائياً

---

### السيناريو 5.2 — عرض بدون بيع (الزبون لم يشترِ)

```
outcome = 'offer_presented'
مطلوب: offers[] يحتوي عرضاً واحداً على الأقل
كل عرض يحتوي: customerResponse = 'accepted' / 'rejected' / 'extension_requested'

marketing_visit_task:
  status = 'completed'
  outcome = 'offer_presented'
  offered_device_model_id = الجهاز المعروض

marketing_visit.status → 'completed' (نفس شروط البيع)

open_task.status → 'completed'  ← المهمة تنتهي!
```

**Edge Cases (فجوات مهمة):**
- `customerResponse = 'rejected'` و`customerResponse = 'extension_requested'` كلاهما ينتهيان بـ open_task `completed`
- لا فرق في الكود بين "رفض نهائي" و"يريد التفكير"
- لا متابعة تلقائية مع `extension_requested` رغم وجود `extensionDueDate`
- المهمة تُغلق حتى لو الزبون مهتم ويريد وقتاً

---

### السيناريو 5.3 — إعادة جدولة من داخل الزيارة

```
outcome = 'rescheduled'
مطلوب: rescheduleReasonId, followUpDueDate

marketing_visit_task:
  status = 'not_completed'
  outcome = 'rescheduled'
  follow_up_due_date = التاريخ المحدد

marketing_visit.status:
  → 'needs_reschedule' (عبر field_visits)
  → لكن marketing_visits نفسها لا تتغير تلقائياً إذا لم تكن 'ended'

open_task القديمة.status → 'completed'

open_task جديدة تُنشأ:
  status = 'needs_reschedule'
  reason = 'follow_up'
  origin_ref_id = id المهمة القديمة ← رابط تاريخي
  due_date = followUpDueDate
```

**Edge Cases:**
- المهمة الجديدة تبدأ بـ `needs_reschedule` وليس `open`
- `needs_reschedule` لا تظهر في planningMarketingTargets حالياً (الكود يستعلم عنها لكن شرط الاستعلام يشملها)
- لا حد لعدد مرات إعادة الجدولة

---

### السيناريو 5.4 — إلغاء من داخل الزيارة

```
outcome = 'cancelled'
مطلوب: cancellationReasonId

marketing_visit_task:
  status = 'not_completed'
  outcome = 'cancelled'
  cancellation_reason_id = السبب

marketing_visit.status: لا يتغير مباشرة من هذا الـ endpoint

open_task.status → 'cancelled'  ← نهائي
```

**Edge Cases:**
- `cancelled` نهائي — لا مهمة جديدة تُنشأ
- لا يمكن التراجع عن `cancelled`

---

### السيناريو 5.5 — العميل غائب / لا يفتح الباب ❌ (غير معالَج)

**المشكلة:**
لا يوجد `outcome` يصف هذا السيناريو في الكود.

**ما يحدث عملياً:**
- يستخدمون `rescheduled` كبديل → يُنشأ موعد جديد
- أو يُسجَّل في الملاحظات فقط

**الـ outcomes المتاحة حالياً:**
```
offer_presented  ← لا ينطبق
device_sold      ← لا ينطبق
rescheduled      ← يستخدمونه كحل بديل
cancelled        ← مبالغة إذا كان الغياب عرضياً
```

---

## ملخص انتقالات open_task.status

```
                    ┌─────────────────────────────────────────────────┐
                    │                  open_task                       │
                    └─────────────────────────────────────────────────┘

النشوء           open
                  │
generate-from-plan│ (شرط: status = 'open' فقط)
                  ▼
قائمة الاتصال   in_contact_list
                  │
حجز موعد         │ (شرط: status = 'in_contact_list' — صامت إذا مختلف)
                  ▼
موعد محجوز      scheduled ──────────────────────────────────┐
                  │                                            │
زيارة جارية      │ (لا تغيير على open_task)                  │
                  │                                            │
                  ├── outcome: device_sold ──────────────► completed
                  │                                            │
                  ├── outcome: offer_presented ─────────► completed
                  │                                            │
                  ├── outcome: rescheduled ─────────────► completed
                  │      └── open_task جديدة → needs_reschedule
                  │                                            │
                  ├── outcome: cancelled ───────────────► cancelled
                  │                                            │
                  └── cancel visit (before result) ──────► open  (يعود للبداية)
                       reschedule visit ─────────────────► needs_reschedule


needs_reschedule  ←── من: رفض جدولة التلمارك
                       إعادة جدولة الزيارة
                       outcome: rescheduled (مهمة جديدة)
```

---

## ملخص الفجوات (للنقاش)

| # | الفجوة | المرحلة | الخطورة |
|---|--------|---------|---------|
| 1 | المهمة تبقى `in_contact_list` بنهاية اليوم بدون إعادة تصفير | 2 | 🔴 |
| 2 | لا حد لعدد محاولات الاتصال | 2 | 🟡 |
| 3 | `offer_presented` لا تُميّز بين رفض / تأجيل / متابعة | 5.2 | 🔴 |
| 4 | `extension_requested` لا يُولّد متابعة تلقائية | 5.2 | 🔴 |
| 5 | العميل غائب — لا outcome مناسب | 5.5 | 🔴 |
| 6 | لا إنشاء تلقائي للعقد عند البيع | 5.1 | 🟡 |
| 7 | marketing_visit لا تُكمَل تلقائياً من `in_visit` | 5.1 | 🟡 |
| 8 | `in_visit` في open_task غير مستخدم رغم وجوده في النوع | 4 | 🟡 |
| 9 | لا واجهة تعرض تاريخ محاولات إعادة الجدولة | - | 🟡 |
