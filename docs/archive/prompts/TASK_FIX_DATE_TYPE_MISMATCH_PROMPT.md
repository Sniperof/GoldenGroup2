# TASK: إصلاح type mismatch بين `contact_targets.date` (DATE) و `telemarketing_task_lists.date` (VARCHAR)

> الخطأ: `operator does not exist: character varying = date`
> السبب: نفس المعامل `$4` (تاريخ كـ نص `YYYY-MM-DD`) بيُستخدم لمقارنة مع عمودين بأنواع مختلفة:
>   - `telemarketing_task_lists.date` = `character varying(50)`
>   - `contact_targets.date` = `date`
> لما ضيفنا `::date` على `contact_targets.date = $4::date`، PostgreSQL ما بيقدر يحلّل `$4` كـ VARCHAR للمقارنة الأولى وكـ DATE للمقارنة التانية بنفس الاستعلام.

---

## الملف الوحيد

`packages/api/services/planningMarketingTargets.ts`

---

## التعديلات المطلوبة (2 مواقع)

### موقع ١: `getPlanningMarketingTargets` — سطر ~604

**قبل:**
```sql
      LEFT JOIN contact_targets contact_target
        ON contact_target.branch_id = c.branch_id
       AND contact_target.target_type = 'client'
       AND contact_target.target_id = c.id
       AND contact_target.target_stage = 'lead'
       AND contact_target.visit_type = 'marketing'
       AND contact_target.source_type = 'lead'
       AND contact_target.date = $4::date
```

**بعد:**
```sql
      LEFT JOIN contact_targets contact_target
        ON contact_target.branch_id = c.branch_id
       AND contact_target.target_type = 'client'
       AND contact_target.target_id = c.id
       AND contact_target.target_stage = 'lead'
       AND contact_target.visit_type = 'marketing'
       AND contact_target.source_type = 'lead'
       AND contact_target.date = $4
```

**التغيير:** حذف `::date` من `contact_target.date = $4`.

---

### موقع ٢: `getAssignedLeadsForTeam` — سطر ~1039

**قبل:**
```sql
      LEFT JOIN contact_targets ct
        ON ct.branch_id    = c.branch_id
       AND ct.target_type  = 'client'
       AND ct.target_id    = c.id
       AND ct.target_stage = 'lead'
       AND ct.visit_type   = 'marketing'
       AND ct.source_type  = 'lead'
       AND ct.date         = $2::date
```

**بعد:**
```sql
      LEFT JOIN contact_targets ct
        ON ct.branch_id    = c.branch_id
       AND ct.target_type  = 'client'
       AND ct.target_id    = c.id
       AND ct.target_stage = 'lead'
       AND ct.visit_type   = 'marketing'
       AND ct.source_type  = 'lead'
       AND ct.date         = $2
```

**التغيير:** حذف `::date` من `ct.date = $2`.

---

## لماذا هذا الحل صحيح؟

- PostgreSQL يقارن `VARCHAR` مع `DATE` تلقائياً (implicit cast من النص لـ DATE).
- الـ `$4` هو تاريخ كـ نص (`'2026-05-22'`) — بيشتغل للاتنين:
  - `daily_tl.date = $4` ← `$4` كـ VARCHAR
  - `contact_target.date = $4` ← `$4` كـ VARCHAR بيتحول تلقائياً لـ DATE
- الـ `::date` كان بيفرض على PostgreSQL أن `$4` هو DATE، بس هو ما بيقدر يكون DATE و VARCHAR بنفس الوقت.

---

## التحقق بعد التعديل

1. أعد تشغيل السيرفر (`pm2 restart golden-crm-staging`).
2. افتح شاشة "حفظ نطاق العمل وحساب الحمل".
3. اضغط "حساب الحمل" → يجب أن ينجح بدون `operator does not exist`.
