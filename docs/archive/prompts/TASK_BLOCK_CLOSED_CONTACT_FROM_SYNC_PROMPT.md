# TASK: منع إسناد المهام لزبون عنده contact_target مقفلة اليوم

> السياق: جهة الاتصال (`contact_target`) صارت كيان يومي. إذا جهة اليوم مقفلة (`status = 'closed`)، لا يجوز إسناد أي مهمة جديدة لهذا الزبون بهذا اليوم. المهمة تبقى `open`/`needs_follow_up` حتى يأتي يوم جديد.
>
> المشكلة الحالية: `syncAssignedTasks` (عبر `getPlanningWorkScope`) تُسند المهام إلى `assigned` بدون فحص `contact_targets.status` لليوم. النتيجة: مهمة `assigned` معلقة بالهواء — التيلماركتر ما بيشوفها لأن `generate-from-plan` بيستبعدها (`contact_target_closed_today`).
>
> الحل: نمنع دخول الزبون لـ `assigned` من الأساس إذا `contact_target` مقفلة اليوم.

---

## ملفات التعديل (ملف واحد)

`packages/api/services/planningMarketingTargets.ts`

---

## التعديل المطلوب

### أ) `getPlanningWorkScope` — استبعاد الزبائن اللي `contact_target` مقفل اليوم

**المنطق:** قبل ما نحسب أي task "eligible" لنطاق العمل، نستبعد الزبائن اللي عندهم `contact_target` مقفل بنفس التاريخ.

**التعديل:** في استعلام `getPlanningWorkScope` (اللي بيجيب الـ `tasks`)، ضيف شرط `WHERE` استبعادي:

**قبل:**
```sql
-- في getPlanningWorkScope (الاستعلام يلي بيجيب tasks):
WHERE ot.client_id = c.id
  AND ot.status IN (...)
  AND ot.branch_id = $1
  -- ... rest of conditions
```

**بعد:**
```sql
-- في getPlanningWorkScope (الاستعلام يلي بيجيب tasks):
WHERE ot.client_id = c.id
  AND ot.status IN (...)
  AND ot.branch_id = $1
  -- منع إسناد إذا جهة الاتصال مقفلة اليوم (PC-4.7)
  AND NOT EXISTS (
    SELECT 1
    FROM contact_targets ct_excl
    WHERE ct_excl.target_id = c.id
      AND ct_excl.target_type = 'client'
      AND ct_excl.branch_id = $1
      AND ct_excl.date = $2::date
      AND ct_excl.status = 'closed'
  )
  -- ... rest of conditions
```

**التفسير:**
- `$1` = branchId
- `$2` = date (من params)
- إذا الزبون عنده `contact_target` مقفل (`status = 'closed'`) لنفس اليوم → كل مهامو بتُستبعد من نطاق العمل → ما بتتسند

---

### ب) `getAssignedLeadsForTeam` — استبعاد نفس الشي

**المنطق:** `generate-from-plan` بيستخدم `getAssignedLeadsForTeam` مش `getPlanningWorkScope`. لازم نضيف نفس الفحص هون كمان.

**التعديل:** في استعلام `getAssignedLeadsForTeam`:

**قبل:**
```sql
WHERE ot.status = 'assigned'
  AND ot.assigned_team_key = $1
  AND ot.assigned_for_date = $2
  AND ot.branch_id = $3
```

**بعد:**
```sql
WHERE ot.status = 'assigned'
  AND ot.assigned_team_key = $1
  AND ot.assigned_for_date = $2
  AND ot.branch_id = $3
  -- منع إسناد إذا جهة الاتصال مقفلة اليوم (PC-4.7)
  AND NOT EXISTS (
    SELECT 1
    FROM contact_targets ct_excl
    WHERE ct_excl.target_id = ot.client_id
      AND ct_excl.target_type = 'client'
      AND ct_excl.branch_id = ot.branch_id
      AND ct_excl.date = ot.assigned_for_date::date
      AND ct_excl.status = 'closed'
  )
```

**ملاحظة:** هون `assigned_for_date` هو تاريخ `date` يلي اجا من `$2`، فممكن نستخدم `$2::date` مباشرة.

---

### ج) `getPlanningMarketingTargets` — الـ counts كمان (اختياري بس مفضل)

**المنطق:** الـ zone counts بـ `getPlanningMarketingTargets` كمان لازم تستبعد الزبائن اللي `contact_target` مقفل، لأن العداد بيضل غلط إذا حسبنا زبون ما رح يدخل بالقائمة.

**التعديل:** في استعلام `countsByZone` و `leadRows` — ضيف نفس `NOT EXISTS`.

---

## النتيجة المتوقعة

### سيناريو: ماهر — جهة مقفلة + مهمة تركيب جديدة

| الخطوة | قبل التعديل | بعد التعديل |
|--------|-------------|-------------|
| syncAssignedTasks | مهمة التركيب → `assigned` ❌ | مهمة التركيب بتضل `open` ✅ |
| getPlanningWorkScope | بيلاقي المهمة → بيحسبها بالحمل ❌ | بيستبعدها → ما بحسبها ❌ |
| generate-from-plan | resolveOrCreate → null → skipped ❌ | مش رح تشغل أصلاً لأن المهمة ما تسندت ✅ |
| التيلماركتر | ما بيشوف المهمة (معلقة) | ما بيشوفها — بس سبب صح: المهمة لساتها `open` |
| بكرة | sync بتعمل assigned جديد + contact_target جديد | نفس الشي — المهمة بتدخل عادي |

---

## التحقق بعد التعديل

1. تأكد إن `contact_target` لماهر مغلقة ليوم ٢٣/٥.
2. شغّل "حفظ نطاق العمل وحساب الحمل" ليوم ٢٣/٥.
3. افتح `PlanningContactTargets` → ماهر **ما يظهر**.
4. افتح `/planning/assigned-tasks` → ماهر **ما يظهر** (أو يظهر بس tasks القديمة).
5. تحقق من `open_tasks` — مهمة التركيب لازم تضل `open` أو `needs_follow_up`.
6. بكرة ٢٤/٥: شغّل sync → ماهر بيظهر عادي + contact_target جديدة.

---

## ملاحظة تقنية

- الـ `assigned_for_date` بـ `open_tasks` نوعو `character varying(50)` (مش DATE).
- لما نقارن مع `contact_targets.date` (DATE)، PostgreSQL بيحول `varchar` → `date` تلقائياً.
- إذا طلع مشكلة types — استخدم `$2::date` (parameter) أو `ot.assigned_for_date::date`.
