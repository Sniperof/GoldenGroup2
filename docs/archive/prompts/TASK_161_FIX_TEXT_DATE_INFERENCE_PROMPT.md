# TASK: إصلاح type inference conflict بـ prepared statement

## المشكلة

بعد تطبيق `$2::date` على `ct.date` و `ot.assigned_for_date`، لسّا في error:
```
error: operator does not exist: text = date
```

السبب: **PostgreSQL prepared statement type inference**. كل الـ `$2` بنفس الـ query بيشاركوا نفس النوع المستنتج. لما PostgreSQL بيشوف `$2::date` بمكان تاني بالـ query، بيستنتج إن `$2` نوعه `date`. فـ `ct_excl.date::text = $2` بيصير فعلياً `text = date`.

## الملف المستهدف

`packages/api/services/planningMarketingTargets.ts`

## التعديل المطلوب

### السطر 1134 (بـ `getAssignedLeadsForTeam`):

من:
```sql
            AND ct_excl.date::text  = $2
```

إلى:
```sql
            AND ct_excl.date = $2::date
```

## التفسير التقني

بـ PostgreSQL prepared statements، لو نفس الـ `$N` ظاهر بأكتر من مكان بالـ query، PostgreSQL بيستنتج نوعه من أي explicit cast موجود. هون:
- `$2::date` عند `ct.date = $2::date` (سطر 1115)
- `$2::date` عند `ot.assigned_for_date = $2::date` (سطر 1126)

هاد بيعلّم PostgreSQL إن `$2` = `date`. فـ لما بيوصل لـ `ct_excl.date::text = $2` بيعتبره `text = date` → error.

الحل: نخلي كل المقارنات بـ `$2` تستخدم نفس النوع (`date = date`) بدل مزيج (`text = date`).

## Deliverables

- [ ] `ct_excl.date::text = $2` → `ct_excl.date = $2::date`
- [ ] Build passed
- [ ] Test: توليد جهات الاتصال ما بيعطي 500
