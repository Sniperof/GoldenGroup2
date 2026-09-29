# TASK: إصلاح Forward Reference لـ contact_target بالـ planningMarketingTargets.ts

## المشكلة

عند فتح "تحديد نطاق عمل الفريق" مع وجود مهمة `device_delivery` (أو أي مهمة بـ `location_basis = 'contract'`)، بيظهر خطأ:

```
error: missing FROM-clause entry for table "ot"
```

السبب: الـ `contact_target` LEFT JOIN بسطر ~622 بيستخدم `ot.location_basis` و `ct_zone.installation_geo_unit_id` بـ `ON` clause، بس `ot` معرّف عند سطر ~674 و `ct_zone` عند سطر ~699.

بالـ SQL، الـ `ON` clause ما بيقدر يعمل forward reference لجدول معرّف لاحقاً بـ `FROM` clause.

## الملف المستهدف

`packages/api/services/planningMarketingTargets.ts`

## التعديل المطلوب

**أنقل بلوك `contact_target` LEFT JOIN من مكانه الحالي (بعد `buildCustomerOwnershipSql`) لبعد بلوك `ct_zone` LATERAL.**

### الترتيب الحالي (خاطئ):

```
FROM clients c
LEFT JOIN branches b ON ...
${buildCustomerOwnershipSql(...)}
LEFT JOIN contact_targets contact_target ON ...  -- ← هون بيستخدم ot و ct_zone!
LEFT JOIN LATERAL (...) latest_appointment ON TRUE
LEFT JOIN telemarketing_task_lists daily_tl ON ...
LEFT JOIN telemarketing_task_list_items daily_item ON ...
LEFT JOIN LATERAL (...) other_queued ON TRUE
LEFT JOIN LATERAL (...) ot ON TRUE                -- ← ot معرّف هون
LEFT JOIN LATERAL (...) ct_zone ON ...            -- ← ct_zone معرّف هون
LEFT JOIN LATERAL (...) unfinished_visit ON TRUE
```

### الترتيب الجديد (صح):

```
FROM clients c
LEFT JOIN branches b ON ...
${buildCustomerOwnershipSql(...)}
LEFT JOIN LATERAL (...) latest_appointment ON TRUE
LEFT JOIN telemarketing_task_lists daily_tl ON ...
LEFT JOIN telemarketing_task_list_items daily_item ON ...
LEFT JOIN LATERAL (...) other_queued ON TRUE
LEFT JOIN LATERAL (...) ot ON TRUE                -- ← ot
LEFT JOIN LATERAL (...) ct_zone ON ...            -- ← ct_zone
LEFT JOIN contact_targets contact_target ON ...     -- ← هلأ صار ماشي، ot و ct_zone معرّفين
LEFT JOIN LATERAL (...) unfinished_visit ON TRUE
```

### التفاصيل الدقيقة

**المقطع الحالي لازم يننقل بالكامل (الأسطر ~621-640):**

```sql
      LEFT JOIN contact_targets contact_target
        ON contact_target.branch_id = c.branch_id
       AND contact_target.target_type = 'client'
       AND contact_target.target_id = c.id
       AND contact_target.target_stage = 'lead'
       AND contact_target.visit_type = 'marketing'
       AND contact_target.source_type = 'lead'
       AND contact_target.date = $4::date
       AND contact_target.zone_id = (
         CASE
           WHEN ot.location_basis = 'contract' AND ct_zone.installation_geo_unit_id IS NOT NULL
             THEN ct_zone.installation_geo_unit_id
           ELSE
             CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
               THEN c.neighborhood::int
               ELSE NULL
             END
         END
       )
```

**أنقل هالبلوك لبعد:**

```sql
      ) ct_zone ON ot.location_basis = 'contract'
```

**وبقبل:**

```sql
      LEFT JOIN LATERAL (
        SELECT 1 AS has_unfinished_visit
```

### ملاحظات مهمة

1. **ما تعدّل شي بمحتوى الـ `ON` clause** — بس نقل المكان.
2. **الـ `NOT EXISTS` subqueries بالـ WHERE clause** ما لازم تتعدّل — هنّي subqueries بالـ WHERE وبيقدرو يعملوا reference لأي جدول بالـ FROM clause بغض النظر عن الترتيب.
3. **التأكد من build:** npm run build بعد التعديل.
4. **التأكد من TypeScript:** ما في أخطاء جديدة (نفس الـ 5 أخطاء القديمة مسموح).

## السبب التقني

PostgreSQL بيسمح للـ `ON` clause بـ JOIN إنه يستخدم جداول ظاهرة **بس قبل الجدول الحالي** بـ `FROM` clause. 

Subqueries بالـ `WHERE` clause (مثل `NOT EXISTS`) بيقدرو يعملوا reference لأي جدول بالـ query level لأنّهن بيتقيّمو بعد ما كل الـ joins تكتمل.

## Deliverables

- [ ] نقل `contact_target` LEFT JOIN لبعد `ct_zone` LATERAL join
- [ ] Build passed
- [ ] Test: افتح "تحديد نطاق عمل الفريق" → ما بيظهر "تعذر الحساب"
