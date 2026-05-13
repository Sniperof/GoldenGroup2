# VERIFICATION — P2 Marketing Appointment Lifecycle

## منهجية التحقق

1. قراءة الكود الكامل لكل ملف مرتبط
2. استعلام DB مباشر لمقارنة الحالات النظرية بالواقعية
3. تتبع سلسلة appointments → marketing_visits → tasks → open_tasks
4. فحص وجود legacy values في DB

---

## 1. توزيع الحالات الفعلية في DB

```
contact_targets:
  booked  = 11    ← كل الـ appointments المُنجزة
  new     =  1    ← هدف لم يُضَف لقائمة بعد
  queued  =  0    ← صفر! (رغم أن الكود يكتبها)
  in_call_list = 0 ← legacy، لا يُكتَب
  contacted    = 0 ← لا مكالمات بدون حجز في staging

task_list_items:
  booked  = 17   ← كل مواعيد مُحجوزة
  pending =  9   ← بنود لم تُعالَج

open_tasks:
  open             =  8   ← مهام جديدة
  in_contact_list  =  1   ← أُضيف لقائمة اليوم
  scheduled        =  3   ← موعد مُحجوز
  completed        =  8   ← منتهية
  needs_reschedule =  2   ← تحتاج متابعة
  cancelled        =  1   ← ملغاة
  assigned         =  0   ← غير مستخدم (legacy)

marketing_visits:
  scheduled        =  2   ← زيارات قادمة
  in_visit         =  2   ← زيارات جارية
  completed        =  9   ← منجزة
  needs_reschedule =  1   ← تحتاج إعادة جدولة
  cancelled        =  1   ← ملغاة
  ended            =  0   ← NEVER USED في staging
  not_completed    =  0   ← لا يوجد

marketing_visit_tasks:
  pending        =  4   ← زيارات مجدولة أو جارية
  completed      =  8   ← نتيجة مسجَّلة
  not_completed  =  3   ← لم تكتمل
```

---

## 2. إثبات الـ Canonical vs Legacy

### `booked` vs `booked_marketing_appointment`

```sql
SELECT
  COUNT(*) FILTER (WHERE outcome = 'booked') AS legacy_count,
  COUNT(*) FILTER (WHERE outcome = 'booked_marketing_appointment') AS canonical_count
FROM telemarketing_call_logs;

-- النتيجة:
legacy_count=0  canonical_count=17
```

```sql
SELECT
  COUNT(*) FILTER (WHERE call_outcome = 'booked') AS legacy,
  COUNT(*) FILTER (WHERE call_outcome = 'booked_marketing_appointment') AS canonical
FROM telemarketing_task_list_items;

-- النتيجة:
legacy=0  canonical=17
```

**الاستنتاج:** `'booked'` (legacy) لا يوجد في أي سجل حديث. `'booked_marketing_appointment'` هو الـ canonical الوحيد المستخدم.

---

## 3. إثبات الـ Appointment → Visit chain

```sql
SELECT
  ta.id AS appointment_id,
  mv.id AS mv_id,
  mv.status AS mv_status,
  mvt.outcome AS task_outcome,
  ot.status AS open_task_status,
  ct.status AS contact_target_status
FROM telemarketing_appointments ta
LEFT JOIN marketing_visits mv ON mv.source_id = ta.id
LEFT JOIN marketing_visit_tasks mvt ON mvt.visit_id = mv.id
LEFT JOIN open_tasks ot ON ot.id = mvt.source_open_task_id
LEFT JOIN contact_targets ct ON ct.id = ta.contact_target_id
ORDER BY ta.created_at DESC LIMIT 5;

النتيجة:
  appointment → mv_id = 'mv_' + appointment_id  ✅ (العلاقة مؤكَّدة)
  ct.status = 'booked' في كل الحالات           ✅ (لا يتغير بعد الحجز)
```

---

## 4. إثبات rescheduled — السلوك المزدوج

```sql
SELECT
  mvt.outcome,
  ot_old.status AS old_open_task_status,
  ot_new.status AS new_open_task_status,
  ot_new.reason AS new_open_task_reason
FROM marketing_visit_tasks mvt
JOIN open_tasks ot_old ON ot_old.id = mvt.source_open_task_id
LEFT JOIN open_tasks ot_new ON ot_new.origin_ref_id = ot_old.id
WHERE mvt.outcome = 'rescheduled';

النتيجة:
  outcome=rescheduled:
    old_open_task.status = completed        ✅ (المهمة القديمة تُغلق)
    new_open_task.status = needs_reschedule ✅ (مهمة جديدة تُنشأ)
    new_open_task.reason = follow_up        ✅
```

---

## 5. فحص Legacy/Canonical Drift

| الظاهرة | النوع | الدليل |
|---------|-------|--------|
| `'booked'` outcome في DB | **لا يوجد** — canonical فقط | 0 سجلات legacy في call_logs |
| `'in_call_list'` في contact_targets | **لا يوجد** — legacy | 0 سجلات |
| `'cancelled'` في PlanningContactTargets labels | **phantom** — لا مسار كتابة | تم إزالته |
| `'assigned'` في ACTIVE_OPEN_TASK_STATUSES | **ghost** — ليس في type | 0 سجلات في DB |
| `'ended'` في marketing_visits | **unused** — مدعوم في API لكن لا يُستخدم | 0 سجلات في DB |
| `'not_completed'` في marketing_visits | **rare** — 0 في DB | يأتي من legacy /result |

---

## 6. الحالات الغامضة

### `marketing_visit.status = 'ended'` — Dead Phase

الكود يدعم `in_visit → ended → /outcome` لكن هذا المسار لا يُستخدم فعلياً.
الفريق يستخدم: `scheduled → in_visit → /result` مباشرة (legacy endpoint).

**نتيجة:** `applyTaskOutcome` يتحقق من `visit.status === 'ended'` قبل الترقية إلى 'completed'،
لكن بما أن الزيارة لا تصل لـ 'ended' أبداً، هذا المنطق لا يعمل أبداً.

### `contact_targets.status = 'booked'` — لا يُغلق أبداً

جميع الـ 11 سجل في DB للحالة 'booked' — حتى تلك المرتبطة بزيارات مكتملة منذ أسابيع.
لا يوجد كود يُحوّل contact_target من 'booked' لأي حالة أخرى بعد الحجز.

**نتيجة:** الـ GET /contact-targets/marketing سيظل يُعيد هذه السجلات إلى الأبد إذا لم يُضَف guard.

---

## 7. Drift بين الواجهة والباكند

| المشكلة | الواجهة | الباكند | القرار |
|---------|---------|---------|--------|
| اسم الصفحة `PlanningContactTargets` تستدعي `marketingTargets` API | `/planning/contact-targets/:teamKey` | `GET /planning/marketing-targets` | Naming drift — موثَّق |
| `AppointmentSchedulerModal` لا تُفلتر بنوع المهمة | تعرض كل المهام | API يقبل أي taskType | Intentional design |
| legacy `/result` يقبل `status='completed'` من `'scheduled'` | لا guard | لا guard في الباكند | Gap — موثَّق |
| `'cancelled'` في contactTargetStatusLabels | كان موجوداً | لا مسار كتابة | **تم إصلاحه** |
