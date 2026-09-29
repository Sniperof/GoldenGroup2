# خطة تنفيذ مرحلة `assigned` — دورة التخطيط المُحكمة

> **الحالة:** خطة معتمدة، **مؤجلة التنفيذ** — تنتظر تثبيت حالات جهة الاتصال أولاً
> **تاريخ الإنشاء:** 2026-05-17
> **المصدر:** نقاش مباشر مع صاحب المنتج Ibrahim Obaid
> **يخدم:** `G-PL-02` (مرحلة assigned غير مُفعّلة) — `tasks.md §3.2` — `planning-contact-targets.md §4.6`
> **سابقها (يجب إنجازه أولاً):** تثبيت حالات `contact_targets` (`G-PL-01`: booked → closed)

---

## 0) الفكرة الجوهرية

`assigned` هي **بوابة التخطيط الفعلية**:
- بين `قيد الانتظار` (المهمة موجودة)
- و `قيد الجدولة` (التلمارك يعمل عليها)

تعطي **مدير الفرع** فرصة المراجعة والتنقيح قبل دفع المهام للتلمارك. تجعل كل انتقال في دورة الحياة قراراً بشرياً واضحاً، لا حدثاً تلقائياً مخفياً.

---

## 1) السلوك التشغيلي المُعتمد

### 1.1 الكتابة التلقائية لـ `assigned` عند حفظ النطاق

عند كل `PUT /route-assignments/:key` يجري النظام **reconcile** في نفس الـ transaction:

```
Step 1: حساب المهام المؤهلة الآن
  • branch_id يطابق
  • status IN ('open', 'needs_follow_up')        ← قيد الانتظار
  • client.neighborhood ∈ new_zone_ids
  • تطابق eligibility من task_type_config (pattern + N window)
  • تطابق ownership (supervisor/technician/company)
  • NOT excluded_for_date = today
  • NOT assigned لفريق آخر اليوم

Step 2: حساب المهام المُسندة حالياً
  • status = 'assigned'
  • assigned_team_key = teamKey
  • assigned_for_date = date

Step 3: الـ diff
  • newly_eligible (موجودة في Step1 وليست في Step2):
      UPDATE status='assigned',
             last_waiting_status=current_status,  ← يحفظ open أو needs_follow_up
             assigned_team_key, assigned_for_date, assigned_at

  • no_longer_eligible (موجودة في Step2 وليست في Step1):
      UPDATE status=last_waiting_status,         ← يستعيد الحالة الأصلية
             assigned_team_key=NULL,
             assigned_for_date=NULL,
             assigned_at=NULL

  • مستقرة: لا تغيير

Step 4: تسجيل كل تغيير في task_activity_log
```

### 1.2 الاستثناء على مستوى المهمة الفردية

عبر `POST /open-tasks/:id/exclude`:
- إذا المهمة `assigned`: تعود لحالتها الأصلية المحفوظة في `last_waiting_status` (open أو needs_follow_up)
- `excluded_for_date = today`
- `excluded_reason = body.reason` (اختياري)
- يُمسح `assigned_team_key, assigned_for_date, assigned_at`
- نوع الحدث في الـ log: `'excluded_by_manager'`

عبر `POST /open-tasks/:id/restore`:
- يُمسح `excluded_for_date` و `excluded_reason`
- المهمة تصبح مؤهلة للـ reconcile التالي (ستعود `assigned` تلقائياً)
- نوع الحدث في الـ log: `'restored_by_manager'`

### 1.3 الاستثناء الجماعي (Batch)

عبر `POST /open-tasks/bulk-exclude`:
- Body: `{ taskIds: number[], reason?: string }`
- يطبق الاستثناء لكل المهام دفعة واحدة

عبر `POST /open-tasks/bulk-restore`:
- Body: `{ taskIds: number[] }`

### 1.4 توليد قائمة الاتصال — السلوك الجديد

`POST /telemarketing/task-lists/generate-from-plan`:
- يأخذ **فقط** المهام في حالة `assigned` لـ (teamKey, date)
- يتجاهل المستثناة (`excluded_for_date IS NOT NULL` لأنها بالفعل عادت لـ open)
- ينقلها: `assigned → in_scheduling`
- ينشئ `telemarketing_task_list_items`

**خاصية مهمة — Idempotent + Incremental:**
- يمكن استدعاؤه عدة مرات في نفس اليوم
- في كل مرة يأخذ المهام `assigned` الجديدة فقط ويضيفها للقائمة الموجودة
- لا يلمس ما هو `in_scheduling` بالفعل
- يدعم سيناريو "المدير أضاف منطقة بعد التوليد الأول"

### 1.5 نهاية اليوم — استعادة طبيعية

لا حاجة لـ cron job:
- الاستعلامات تفلتر بـ `assigned_for_date = today`
- المهام `assigned` من أمس "تختفي" من السياق التشغيلي اليومي
- عند `reconcile` في اليوم التالي: تُعاد لحالتها الأصلية (`last_waiting_status`) ضمن نفس الـ diff

**اختياري (lazy cleanup):** middleware يُنظف المهام `assigned` القديمة من أيام سابقة عند أول `reconcile` يومي.

---

## 2) Migration 107 — التغييرات على `open_tasks`

```sql
ALTER TABLE open_tasks
  ADD COLUMN assigned_team_key VARCHAR(20),
  ADD COLUMN assigned_for_date DATE,
  ADD COLUMN assigned_at TIMESTAMPTZ,
  ADD COLUMN excluded_for_date DATE,
  ADD COLUMN excluded_reason TEXT;

CREATE INDEX open_tasks_assigned_idx
  ON open_tasks (assigned_team_key, assigned_for_date, status)
  WHERE status = 'assigned';

CREATE INDEX open_tasks_excluded_idx
  ON open_tasks (excluded_for_date)
  WHERE excluded_for_date IS NOT NULL;

-- توسعة CHECK constraint للـ status (إذا لم يكن assigned مضافاً)
ALTER TABLE open_tasks
  DROP CONSTRAINT IF EXISTS open_tasks_status_check;

ALTER TABLE open_tasks
  ADD CONSTRAINT open_tasks_status_check
  CHECK (status IN (
    'open', 'needs_follow_up',
    'assigned', 'in_scheduling', 'scheduled',
    'waiting_execution', 'in_execution', 'ended',
    'completed', 'closed', 'cancelled'
  ));
```

---

## 3) الواجهة — صفحة `PlanningContactTargets` الموسّعة

### 3.1 الفكرة المحورية

الوحدة المرئية = **جهة اتصال** (زبون)، الوحدة التشغيلية = **مهمة**.
- المدير يفكر بـ "زبائن"، النظام يخزن "مهام"
- التجميع يحدث في الـ Query والـ UI، لا في DB

### 3.2 الترتيب

جهات الاتصال **مرتبة من الأكثر مهامًا إلى الأقل**:
- يساعد المدير على رؤية الحالات الأهم أولاً
- يكشف الزبائن الذين يحتاجون اهتماماً خاصاً (تراكم مهام)

### 3.3 التخطيط البصري

```
┌──────────────────────────────────────────────────────────────────┐
│ جهات الاتصال المُسندة لفريق_0 - 17 مايو                          │
│ مرتبة من الأكثر مهامًا إلى الأقل                                 │
└──────────────────────────────────────────────────────────────────┘

☑ □ │ 👤 أحمد محمد        | 4 مهام (3 مسندة، 1 مستثناة)      [▼]
☑ □ │ 👤 خالد علي         | 3 مهام (3 مسندة)                  [▼]
☑ □ │ 👤 فاطمة حسن        | 2 مهام (0 مسندة، 2 مستثناة)      [▼]
☑ □ │ 👤 محمود إبراهيم    | 1 مهمة (1 مسندة)                  [▼]
...

[ زر: توليد قائمة الاتصال للتلمارك ]
   ← يأخذ فقط الجهات التي فيها مهمة مسندة واحدة على الأقل
   ← فاطمة (كلها مستثناة) لن تدخل، تبقى مرئية كتوثيق
```

### 3.4 Modal المهام لجهة اتصال

عند الضغط على صف جهة اتصال:

```
┌──────────────────────────────────────────────────┐
│ مهام أحمد محمد                                   │
│ ☑ استثناء كل المهام / إعادتها (toggle جماعي)   │
├──────────────────────────────────────────────────┤
│ ☑ عرض جهاز - device_demo                         │
│ ☑ تشييك جهاز - device_checkup                    │
│ ☑ تحصيل قسط - installment_collection             │
│ ☐ صيانة طارئة - emergency_maintenance ← مستثناة │
└──────────────────────────────────────────────────┘
                 [ حفظ التغييرات ]
```

### 3.5 الشفافية الكاملة

- كل جهات الاتصال (المسندة + المستثناة) تبقى مرئية
- المدير يرى دائماً قراره الكامل
- ألوان توضيحية:
  - 🟢 كل المهام مسندة
  - 🟡 جزء مسندة، جزء مستثناة
  - 🔴 كل المهام مستثناة

### 3.6 بعد التوليد

```
┌───────────────────────────────────────────────────────────────┐
│ ✅ تم توليد قائمة الاتصال - 47 مهمة (31 جهة اتصال)            │
│ التلمارك يستلمها الآن في مساحته                                │
└───────────────────────────────────────────────────────────────┘

📋 ملخص اليوم:
   • 47 مهمة انتقلت إلى "قيد الجدولة" (التلمارك)
   • 3 مهام مستثناة (عادت لقيد الانتظار)
   • 32 جهة اتصال إجماليّاً

[ زر: عرض حالة التلمارك ]
```

---

## 4) السيناريو الكامل — اختبار end-to-end

```
9:00ص  - مدير الفرع يحفظ نطاق فريق_0 (مناطق A, B, C)
         ⚙️ النظام: 50 مهمة (35 open + 15 needs_follow_up) → assigned
         💾 last_waiting_status محفوظة لكل واحدة
         🟢 32 جهة اتصال

9:15ص  - المدير يضيف منطقة D
         ⚙️ النظام: + 12 مهمة جديدة من D → assigned
         🟢 الإجمالي: 62 مهمة assigned، 38 جهة اتصال

9:30ص  - المدير يفتح PlanningContactTargets
         👀 يرى 38 جهة اتصال مرتبة من الأكثر مهامًا

9:35ص  - يفحص أحمد (4 مهام)
         🔍 modal → يستثني "صيانة طارئة" (تم حلها يدوياً البارحة)
         ⚙️ 1 مهمة لأحمد تعود لـ open، 3 تبقى assigned

9:40ص  - يستثني فاطمة بالكامل (toggle خارجي = استثنِ الكل)
         ⚙️ مهام فاطمة الـ2 تعود لـ needs_follow_up
         🔴 فاطمة تبقى مرئية بـ "0 مسندة، 2 مستثناة"

9:45ص  - يضغط "توليد قائمة الاتصال"
         ⚙️ يأخذ 37 جهة اتصال (38 - فاطمة المستثناة كاملاً)
         ⚙️ يأخذ 59 مهمة assigned (62 - 1 لأحمد - 2 لفاطمة)
         ⚙️ UPDATE: 59 مهمة → in_scheduling
         ⚙️ INSERT في telemarketing_task_list_items

12:00ظ - المدير يكتشف منطقة E منسية
         ⚙️ يحدّث النطاق → reconcile جديد
         ⚙️ 8 مهام جديدة من E → assigned

12:05ظ - المدير يفتح PlanningContactTargets
         👀 يرى الـ 8 مهام الجديدة + مهام اليوم (متوزعة على حالات مختلفة)

12:10ظ - يضغط "توليد قائمة الاتصال" مرة أخرى
         ⚙️ الـ 8 الجديدة فقط → in_scheduling
         ⚙️ تُضاف لـ task_list الموجودة (لا تستبدلها)

اليوم التالي (8:00ص):
         ⚙️ المدير يحفظ نطاق جديد لفريق_0
         ⚙️ reconcile: مهام assigned من أمس (إن وُجدت) → تُستعاد لحالتها الأصلية
         ⚙️ المستثناة (excluded_for_date = أمس) تصبح مؤهلة مرة أخرى
         ⚙️ حساب جديد كامل
```

---

## 5) قائمة المهام التفصيلية

### Backend
1. **Migration 107** — حقول `open_tasks`:
   - `assigned_team_key VARCHAR(20)`
   - `assigned_for_date DATE`
   - `assigned_at TIMESTAMPTZ`
   - `excluded_for_date DATE`
   - `excluded_reason TEXT`
   - Indexes + CHECK constraint توسعة

2. **Service: `assignedTaskReconciler.ts`** — دالة `reconcileAssignedTasks(date, teamKey, branchId, pgClient)`:
   - تحسب الـ diff (newly_eligible vs no_longer_eligible)
   - تطبق التحديثات في batches
   - تسجل في `task_activity_log`
   - تستخدم `buildOpenTaskEligibilityPredicate` الموجود

3. **دمج في `PUT /route-assignments/:key`**:
   - بعد حفظ الـ assignment، يجري `reconcileAssignedTasks` في نفس transaction
   - rollback شامل عند فشل أي خطوة

4. **تعديل `POST /telemarketing/task-lists/generate-from-plan`**:
   - بدل البحث عن `status = 'open'`، يبحث عن `status = 'assigned' AND assigned_team_key = $teamKey AND assigned_for_date = $date`
   - يحوّل `assigned → in_scheduling`
   - يبقى idempotent + incremental

5. **Endpoints جديدة**:
   - `POST /open-tasks/:id/exclude` — استثناء فردي
   - `POST /open-tasks/:id/restore` — إعادة فردية
   - `POST /open-tasks/bulk-exclude` — استثناء جماعي
   - `POST /open-tasks/bulk-restore` — إعادة جماعية
   - كلها تتطلب صلاحية `planning.manage` أو مدير الفرع

6. **تعديل `planningMarketingTargets.ts`**:
   - الـ Query يُرجع البيانات **مجمّعة حسب الزبون**
   - لكل زبون: قائمة المهام، assigned_count، excluded_count
   - مرتبة بـ `assigned_count + excluded_count DESC`

### Frontend
7. **توسعة `PlanningContactTargets.tsx`**:
   - عرض جدول جهات الاتصال مع counts
   - Checkbox خارجي لكل صف (toggle جماعي)
   - زر [▼] يفتح modal بمهام الجهة
   - Modal: checkbox لكل مهمة + زر حفظ
   - ألوان: 🟢🟡🔴 حسب نسبة المسندة/المستثناة
   - زر "توليد" يُعطّل إذا لا توجد مهام assigned

8. **تحديث `api.ts`**:
   - `api.openTasks.exclude(id, reason)`
   - `api.openTasks.restore(id)`
   - `api.openTasks.bulkExclude(ids, reason)`
   - `api.openTasks.bulkRestore(ids)`

### اختبار + توثيق
9. **اختبار end-to-end** للسيناريو في §4 على staging
10. **تحديث الدستور**:
    - `tasks.md §3.2` — تفعيل `assigned` رسمياً
    - `planning-contact-targets.md` — توثيق صفحة الاستثناء
    - `route-assignment.md` — توثيق reconcile

---

## 6) القرارات الجوهرية المُثبّتة

| # | القرار | الحالة |
|:-:|--------|--------|
| D1 | `assigned` تُكتب لحظة حفظ النطاق (في نفس transaction) | ✅ مُعتمد |
| D2 | الاستثناء = إعادة لـ `last_waiting_status` + `excluded_for_date = today` | ✅ مُعتمد |
| D3 | نهاية اليوم: استعادة طبيعية عبر فلترة `assigned_for_date` + lazy cleanup | ✅ مُعتمد |
| D4 | الواجهة في `PlanningContactTargets` الموجودة، توسعتها بـ modal لكل جهة | ✅ مُعتمد |
| D5 | التجميع حسب جهة الاتصال، الترتيب بعدد المهام نزولاً | ✅ مُعتمد |
| D6 | التوليد يبقى idempotent + incremental — يمكن استدعاؤه عدة مرات | ✅ مُعتمد |
| D7 | لا حاجة لـ cron — استعادة طبيعية + lazy على أول reconcile | ✅ مُعتمد |

---

## 7) المخاوف والقيود التي يجب أخذها بعين الاعتبار

### ⚠️ 7.1 Race conditions عند تعديل النطاق + توليد القائمة
- حل: lock صف على `route_assignments(key)` أثناء reconcile وأثناء generate
- أو advisory lock على `(branch_id, date, team_key)`

### ⚠️ 7.2 عبء الحفظ مع آلاف المهام
- حل: batch UPDATE واحد بـ JOIN على temp table بدل loop
- استعمال `WHERE id = ANY($1::int[])` لأقصى كفاءة

### ⚠️ 7.3 UX الاستثناء عندما يكون عدد المهام كبير
- مرحلة لاحقة: فلاتر داخل modal (حسب النوع، حسب آخر اتصال، إلخ)
- لا حاجة لها في الـ MVP

### ⚠️ 7.4 ماذا لو كان المدير يعمل بينما التلمارك يولّد القائمة؟
- لا تعارض فعلياً: التلمارك يأخذ المهام `assigned` الحالية فقط
- إذا أضاف المدير مهام جديدة في نفس اللحظة، تدخل في الـ generate التالي

---

## 8) ربط مع الدستور

| الفجوة | الحالة قبل التنفيذ | الحالة بعد |
|--------|--------------------|------------|
| `G-PL-02` (assigned غير مُفعّلة) | 🔴 مفتوحة | ✅ مُغلقة |
| `tasks.md §3.2` (المنطق غير مفعل) | ⚠️ مذكور كفجوة | ✅ مُنفّذ |
| `planning-contact-targets.md §4.6.أ` | ⚠️ نظري | ✅ تشغيلي |

---

## 9) الترتيب المُتفق عليه

**تنفيذ هذه الخطة مؤجل حتى:**
1. ✅ تثبيت حالات `contact_targets` (`G-PL-01`: booked → closed)
2. ✅ تثبيت قواعد `PC-G004` (إغلاق جهة الاتصال بسبب الحجز)

**عند البدء بالتنفيذ:**
- نتبع الترتيب: Migration → Reconciler → Integration → Generate → Endpoints → Query → UI → Test → Docs
- Backend + UI سوياً (دفعة واحدة لتجربة كاملة)

---

## 10) جاهز للاستئناف

عند الرغبة باستئناف هذه الخطة، يكفي قول: **"نفّذ خطة `assigned`"** ونبدأ من المهمة الأولى في §5.
