# TASK: إصلاح type mismatch text = date بـ getAssignedLeadsForTeam

## المشكلة

عند محاولة "توليد جهات الاتصال" (generate contact targets) بيظهر:
```
API Error 500: Internal Server Error
```

الـ error log:
```
error: operator does not exist: text = date
at getAssignedLeadsForTeam (planningMarketingTargets.ts:1064)
```

## السبب

بـ `getAssignedLeadsForTeam` function، الـ `$2` parameter = `date` string text من JS (مثل '2026-05-23'). بس عم يتم مقارنته مع `date` type columns بدون cast:

**سطر 1115:**
```sql
AND ct.date = $2
```
`ct.date` = `date` type. `$2` = `text`. PostgreSQL ما بيسمح `text = date`.

**سطر 1126:**
```sql
AND ot.assigned_for_date = $2
```
`ot.assigned_for_date` = `date` type. `$2` = `text`. نفس المشكلة.

## الملف المستهدف

`packages/api/services/planningMarketingTargets.ts`

## التعديل المطلوب

### ١. سطر 1115:

من:
```sql
       AND ct.date         = $2
```

إلى:
```sql
       AND ct.date         = $2::date
```

### ٢. سطر 1126:

من:
```sql
        AND ot.assigned_for_date = $2
```

إلى:
```sql
        AND ot.assigned_for_date = $2::date
```

### ملاحظة

سطر 1134 عنده fix صحيح:
```sql
AND ct_excl.date::text = $2
```
هون بيحول الـ **column** لـ `text` (بعمل downgrade لـ index usability) — بس هاد OK لأنه بـ subquery.

للسطرين 1115 و 1126 الأفضل نحط `::date` على الـ **parameter** (مش الـ column) لنحافظ على index efficiency.

## Deliverables

- [ ] `ct.date = $2` → `ct.date = $2::date`
- [ ] `ot.assigned_for_date = $2` → `ot.assigned_for_date = $2::date`
- [ ] Build passed
- [ ] Test: توليد جهات الاتصال ما بيعطي 500
