# P1 Fix — GET /contact-targets/marketing: Missing $2 Parameter

## المشكلة

في `packages/api/routes/contactTargets.ts`، الـ `GET /marketing` handler كان يستدعي:

```typescript
pool.query(marketingTargetSelect, [branchId])
```

بينما SQL الـ `marketingTargetSelect` يستخدم **معاملين**:
- `$1` = `branchId`
- `$2` = `ACTIVE_OPEN_TASK_STATUSES` (مصفوفة حالات المهام النشطة)

```sql
AND EXISTS (
  SELECT 1 FROM open_tasks ot
  WHERE ot.client_id = c.id
    AND ot.status = ANY($2::varchar[])   -- ← $2 غير مُمرَّر!
)
```

### نتيجة البـ bug

PostgreSQL يرفع خطأً فورياً:
```
ERROR: there is no parameter $2
routine: pg_analyze_and_rewrite_varparams
```

أي أن **`GET /api/contact-targets/marketing` كانت تُعيد 500** في كل طلب — لا نتائج أبداً.

الخطأ كان موثّقاً في السجلات:
```
/var/log/golden-crm/staging/staging-error.log
routine: pg_analyze_and_rewrite_varparams
```

---

## ما الذي عُدِّل

تعديل واحد في سطر واحد داخل `GET /marketing` handler:

```typescript
// قبل (مكسور)
const { rows } = await pool.query(marketingTargetSelect, [branchId]);

// بعد (صحيح)
const { rows } = await pool.query(marketingTargetSelect, [branchId, ACTIVE_OPEN_TASK_STATUSES]);
```

---

## النتيجة

- `GET /contact-targets/marketing` تعمل بدون خطأ
- تُعيد فقط الزبائن الذين لديهم `open_tasks` بحالات نشطة (6 سجلات في staging)
- متوافقة مع `POST /marketing/sync` التي كانت تمرّر `$2` بشكل صحيح أصلاً

---

## السياق الأوسع

السبب الجذري: تعديل سابق أضاف `$2` إلى SQL وأصلح `POST /sync` لكن نسي تعديل `GET`. هذا نمط كلاسيكي لـ partial fix.

لا يوجد أي مشكلة في `POST /marketing/sync` — كانت تمرّر `ACTIVE_OPEN_TASK_STATUSES` بشكل صحيح في السطر 203.

---

## ملاحظة دستورية

الـ INSERT query داخل `POST /marketing/sync` تحتوي على نفس قائمة الحالات **مكتوبة كـ literal** وليس كـ parameter:

```sql
AND ot.status = ANY(ARRAY['open', 'assigned', 'scheduled', 'in_visit', 'in_contact_list', 'needs_reschedule']::varchar[])
```

هذا ليس bug (القيم تطابق الـ constant)، لكن إذا تغيّرت `ACTIVE_OPEN_TASK_STATUSES` مستقبلاً، يجب تحديث هذا الـ literal يدوياً. **موثَّق كـ maintenance risk — ليس P1.**
