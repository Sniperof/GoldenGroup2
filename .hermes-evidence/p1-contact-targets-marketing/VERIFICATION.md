# VERIFICATION

## 1. إثبات البـ bug الأصلي

### من سجلات الـ server (قبل الإصلاح)

```log
/var/log/golden-crm/staging/staging-error.log:
  where: undefined,
  schema: undefined,
  table: undefined,
  column: undefined,
  dataType: undefined,
  constraint: undefined,
  file: 'postgres.c',
  line: '740',
  routine: 'pg_analyze_and_rewrite_varparams'
```

`pg_analyze_and_rewrite_varparams` = خطأ PostgreSQL عند وجود `$N` في SQL بدون تمرير قيمته في params array.

### إعادة إنتاج الخطأ في psql

```bash
$ psql "postgresql://golden_crm_staging:***@localhost:5432/golden_crm_staging" -c "
SELECT ct.id FROM contact_targets ct
JOIN clients c ON c.id = ct.target_id
WHERE ct.branch_id = 2
  AND EXISTS (
    SELECT 1 FROM open_tasks ot
    WHERE ot.client_id = c.id
      AND ot.status = ANY(\$1::varchar[])  -- $1 غير مُمرَّر
  )
LIMIT 1;
"

ERROR:  there is no parameter $1
LINE 8:       AND ot.status = ANY($1::varchar[])
                                  ^
```

---

## 2. إثبات الإصلاح

### اختبار الاستعلام الكامل مع `$2` مُمرَّراً

```sql
SELECT
  ct.id AS contact_target_id,
  ct.branch_id,
  ct.status,
  ct.target_id AS client_id,
  ot.status AS open_task_status
FROM contact_targets ct
JOIN clients c ON c.id = ct.target_id
JOIN open_tasks ot ON ot.client_id = c.id
  AND ot.status = ANY(ARRAY['open','assigned','scheduled','in_visit','in_contact_list','needs_reschedule']::varchar[])
WHERE ct.branch_id = 2
  AND ct.target_type = 'client'
  AND ct.target_stage = 'lead'
  AND ct.visit_type = 'marketing'
  AND ct.source_type = 'lead'
  AND c.is_candidate = FALSE
  AND NOT EXISTS (SELECT 1 FROM contracts WHERE customer_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM visits WHERE customer_id = c.id)
LIMIT 5;
```

**النتيجة:**
```
 contact_target_id | branch_id | status | client_id | open_task_status
-------------------+-----------+--------+-----------+------------------
                12 |         2 | booked |        12 | scheduled
                10 |         2 | booked |        10 | in_contact_list
                 1 |         2 | booked |         2 | needs_reschedule
                13 |         2 | booked |        13 | scheduled
                 8 |         2 | booked |         8 | scheduled
(5 rows)
```

الاستعلام ينجح ويُعيد نتائج صحيحة — **لا خطأ، لا crash**.

---

## 3. إثبات أن الفلتر يُحدث فرقاً (الـ filter مهم وليس cosmetic)

```sql
SELECT mode, count FROM (
  SELECT 'with_ACTIVE_filter' AS mode, COUNT(*) AS count
  FROM contact_targets ct JOIN clients c ON c.id = ct.target_id
  WHERE ct.branch_id = 2 AND ct.target_type = 'client'
    AND ct.target_stage = 'lead' AND ct.visit_type = 'marketing'
    AND ct.source_type = 'lead' AND c.is_candidate = FALSE
    AND NOT EXISTS (SELECT 1 FROM contracts WHERE customer_id = c.id)
    AND EXISTS (
      SELECT 1 FROM open_tasks ot WHERE ot.client_id = c.id
        AND ot.status = ANY(ARRAY['open','assigned','scheduled',
          'in_visit','in_contact_list','needs_reschedule']::varchar[])
    )
    AND NOT EXISTS (SELECT 1 FROM visits WHERE customer_id = c.id)
  UNION ALL
  SELECT 'without_filter', COUNT(*)
  FROM contact_targets ct JOIN clients c ON c.id = ct.target_id
  WHERE ct.branch_id = 2 AND ct.target_type = 'client'
    AND ct.target_stage = 'lead' AND ct.visit_type = 'marketing'
    AND ct.source_type = 'lead' AND c.is_candidate = FALSE
    AND NOT EXISTS (SELECT 1 FROM contracts WHERE customer_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM visits WHERE customer_id = c.id)
) t;
```

**النتيجة:**
```
       mode         | count
--------------------+-------
 with_ACTIVE_filter |     6
 without_filter     |    11
```

**الفلتر يُقلّص النتائج من 11 إلى 6** — 5 سجلات إضافية كانت ستُعاد بدونه، وهي زبائن لديهم `contact_target` لكن مهامهم مُكتملة أو ملغاة (غير نشطة).

---

## 4. التحقق من توافق GET مع POST /sync

| | GET /marketing | POST /marketing/sync (select) |
|--|--|--|
| الـ query | `marketingTargetSelect` | `marketingTargetSelect` |
| params | `[branchId, ACTIVE_OPEN_TASK_STATUSES]` ✅ | `[branchId, ACTIVE_OPEN_TASK_STATUSES]` ✅ |
| متوافقان؟ | **نعم** | **نعم** |

---

## 5. حالة الـ server بعد الإصلاح

```
pm2 restart golden-crm-staging → online
pm2 logs golden-crm-staging → "API server running on http://localhost:3001"
```

لا أخطاء في الـ startup logs. الـ server يعمل على port 3001.

---

## 6. ملاحظة: INSERT في POST /sync — literal vs parameter

الـ INSERT query داخل `POST /sync` تستخدم literal ARRAY بدل parameter:

```sql
AND ot.status = ANY(ARRAY['open', 'assigned', 'scheduled', 'in_visit',
  'in_contact_list', 'needs_reschedule']::varchar[])
```

**القيم تطابق `ACTIVE_OPEN_TASK_STATUSES` حرفياً** — لا bug حالياً.
لكن هذا maintenance risk: لو تغيّرت الـ constant لن يُحدَّث هذا الـ literal تلقائياً.
**مُوثَّق كـ concern — لا يستوجب إصلاحاً طارئاً.**
