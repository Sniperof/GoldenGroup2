# P2 — Marketing Appointment Lifecycle: State Machine الرسمية

## ما الذي يعبّر عنه هذا الـ Lifecycle

دورة حياة الموعد التسويقي هي سلسلة انتقالات **موزّعة على 5 جداول مختلفة** في آنٍ واحد. لا يوجد جدول واحد يحمل الحالة الكاملة — كل جدول يحمل وجهة نظره.

```
contact_targets          → وجهة نظر الاستهداف
task_list_items          → وجهة نظر التلمارك (يومية)
open_tasks               → وجهة نظر المهمة التشغيلية
telemarketing_appointments → سجل الحجز (لا status فيه)
marketing_visits         → وجهة نظر التنفيذ الميداني
marketing_visit_tasks    → وجهة نظر مهمة الزيارة
```

---

## الحالات الكاملة بكل جدول

### 1. `contact_targets.status`
| الحالة | المعنى الفعلي | من يكتبها |
|--------|--------------|----------|
| `new` | تم إنشاء السجل، لم يُضَف لقائمة | sync أو generate-from-plan |
| `queued` | أُضيف لقائمة اتصال اليوم | generate-from-plan |
| `contacted` | تم الاتصال، بدون حجز | POST /call-logs (outcomes غير booked) |
| `booked` | **تم حجز موعد** — نهاية الرحلة فعلياً | POST /appointments |
| `closed` | لا إجراء مطلوب (رفض، طلب خدمة) | POST /call-logs (outcomes تُغلق الهدف) |
| ~~`in_call_list`~~ | legacy — لم تُكتَب منذ وقت طويل | لا أحد (صفر سجل في DB) |
| ~~`cancelled`~~ | phantom — في UI labels فقط، لا مسار كتابة | لا أحد (لا يوجد في DB) |

**ملاحظة حرجة:** `contact_targets.status` لا يتحرك أبداً بعد `'booked'`.
حتى لو انتهت الزيارة بـ `completed`, `cancelled`, أو `needs_reschedule` — يبقى `'booked'`.
هذا **مقصود** (لا يوجد كود يُحدّثه بعد الحجز) لكن **غير موثَّق**.

### 2. `telemarketing_task_list_items.status`
| الحالة | المعنى | من يكتبها |
|--------|--------|----------|
| `pending` | لم يُتصل به بعد (اليوم) | generate-from-plan |
| `called` | تم الاتصال، لا حجز | PATCH /task-lists/:id/items/:itemId |
| `booked` | **تم الحجز** | POST /appointments (كل items المُختارة) |

### 3. `open_tasks.status`
| الحالة | المعنى | من يكتبها |
|--------|--------|----------|
| `open` | مهمة جديدة، لم تبدأ | إنشاء المهمة |
| `in_contact_list` | أُضيفت لقائمة اتصال | generate-from-plan |
| `scheduled` | تم حجز موعد لها | POST /appointments |
| `in_visit` | الفريق في الزيارة | (لا كود يكتبها في مسار appointments — غير مستخدمة هنا) |
| `completed` | المهمة منتهية | /result أو /outcome |
| `needs_reschedule` | تحتاج متابعة | /result أو /reschedule أو عند outcome='rescheduled' (open_task الجديد) |
| `cancelled` | ملغاة | /result أو /outcome='cancelled' |
| ~~`assigned`~~ | legacy — في ACTIVE_OPEN_TASK_STATUSES لكن لا سجلات في DB | لا أحد |

### 4. `telemarketing_appointments`
**لا يحتوي على status field** — سجل immutable بعد الإنشاء.
المعرّف: `appointment.id` = UUID، يُشتق منه `marketing_visit.id = 'mv_' + appointment.id`.

### 5. `marketing_visits.status`
| الحالة | المعنى | من يكتبها |
|--------|--------|----------|
| `scheduled` | زيارة مُجدوَلة، الفريق لم يبدأ | POST /appointments |
| `in_visit` | الفريق بدأ الزيارة | PATCH /:id/status |
| `ended` | الزيارة انتهت ميدانياً، النتيجة لم تُسجَّل | PATCH /:id/status — **صفر سجل في DB** |
| `completed` | النتيجة مُسجَّلة بنجاح | /result أو /outcome (إذا كانت 'ended') |
| `not_completed` | الزيارة لم تكتمل | /result |
| `needs_reschedule` | تحتاج إعادة جدولة | /reschedule أو /outcome='rescheduled' (غير مباشر) |
| `cancelled` | ملغاة | /cancel |

### 6. `marketing_visit_tasks.status`
| الحالة | المعنى |
|--------|--------|
| `pending` | المهمة منشأة، لم تُنفَّذ |
| `completed` | نتيجة مسجَّلة |
| `not_completed` | لم تكتمل (رفض/إلغاء/...) |

---

## الـ State Machine الكاملة

```
══════════════════════════════════════════════════════
PHASE 0 — تكوين الهدف
══════════════════════════════════════════════════════
contact_target: [لا يوجد]
    → sync أو generate-from-plan
    → contact_target: new

PHASE 1 — توليد قائمة الاتصال
══════════════════════════════════════════════════════
generate-from-plan:
  contact_target: new → queued
  open_task: open → in_contact_list    (ONLY IF status='open')
  task_list_item: [جديد] → pending

PHASE 2 — تسجيل المكالمة
══════════════════════════════════════════════════════
POST /call-logs (outcome ≠ booked_marketing_appointment):
  contact_target: → contacted         (if was new/queued/in_call_list)
  contact_target: → closed            (if outcome closes target)
  task_list_item: → called            (outcomes with itemStatusAfterSave='called')
  task_list_item: → pending           (outcomes with itemStatusAfterSave='pending')

POST /call-logs (outcome = booked_marketing_appointment):
  contact_target: latest_call_outcome updated ONLY — status unchanged
  task_list_item: → booked            (via PATCH /items/:id بشكل منفصل)

PHASE 3 — الحجز  ←←← هذه الخطوة المحورية
══════════════════════════════════════════════════════
POST /appointments (atomic transaction):
  telemarketing_appointment: [INSERT جديد]
  task_list_items (كل المُختارة): → booked + call_outcome='booked_marketing_appointment'
  open_task: in_contact_list → scheduled    (ONLY IF status='in_contact_list')
  contact_target: → booked
  marketing_visit: [INSERT] → scheduled
  marketing_visit_task: [INSERT] → pending

PHASE 4 — التنفيذ الميداني
══════════════════════════════════════════════════════
PATCH /marketing-visits/:id/status:
  scheduled → in_visit     ✅
  in_visit  → ended        ✅
  (أي انتقال آخر مرفوض)

PHASE 5A — تسجيل النتيجة (legacy endpoint)
══════════════════════════════════════════════════════
PATCH /:id/result  [لا يتحقق من حالة الزيارة الحالية!]
  status=completed + closed_result:
    mv: → completed | mvt: → completed | open_task: → completed
  status=completed + not_closed:
    mv: → completed | mvt: → completed | open_task: → needs_reschedule
  status=not_completed:
    mv: → not_completed | mvt: → not_completed | open_task: → needs_reschedule
  status=cancelled:
    mv: → cancelled | mvt: → not_completed | open_task: → cancelled
  status=needs_reschedule:
    mv: → needs_reschedule | mvt: → not_completed | open_task: → needs_reschedule

PHASE 5B — تسجيل النتيجة (canonical endpoint)
══════════════════════════════════════════════════════
PATCH /:visitId/tasks/:taskId/outcome  [يشترط mv.status='ended' للترقية]
  outcome=offer_presented:
    mvt: → completed | open_task: → completed
    mv: → completed (ONLY IF all tasks done AND mv.status='ended')
  outcome=device_sold:
    mvt: → completed | open_task: → completed
    mv: → completed (ONLY IF all tasks done AND mv.status='ended')
  outcome=rescheduled:
    mvt: → not_completed | old open_task: → completed
    NEW open_task: created → needs_reschedule
    mv: لا يتغير (يبقى 'ended' أو 'in_visit')
  outcome=cancelled:
    mvt: → not_completed | open_task: → cancelled
    mv: لا يتغير

══════════════════════════════════════════════════════
contact_target.status لا يتغير بعد 'booked' نهائياً
══════════════════════════════════════════════════════
```

---

## ما الذي ثبت فعلياً من DB

| الإثبات | النتيجة |
|---------|---------|
| `booked` (legacy outcome) في DB | **صفر سجل** — الكود الحالي يكتب `booked_marketing_appointment` فقط |
| `in_call_list` في contact_targets | **صفر سجل** — legacy status |
| `queued` في contact_targets | **صفر سجل** — رغم أن الكود يكتبه (لا تجارب generate-from-plan في staging) |
| `ended` في marketing_visits | **صفر سجل** — Phase 4→5 يتم مباشرة عبر legacy endpoint |
| `in_progress` في marketing_visits | **صفر سجل** — هذا status لـ field_visits table فقط |
| contact_target بعد completed visit | **يبقى 'booked'** دائماً — لا تحديث |
| rescheduled: old open_task → completed + new one created | **مؤكَّد في DB** |
