# TASK: إصلاح فلتر status بـ eff_zone LATERAL

## المشكلة

بعد تطبيق الـ eff_zone LATERAL، عمود "المحطة" لسّا بيظهر "الحميدية" بدل "حي المساكن".

السبب: الـ eff_zone LATERAL بيفلتر `ot_eff.status = 'assigned'` (سطر 165)، بس المهمة الفعلية حالتها **`scheduled`** (لأنه تم حجز موعد لها). فـ `eff_zone` بيرجع NULL → fallback لـ `gu.name` = neighborhood.

## الملف المستهدف

`packages/api/routes/planning.ts`

## التعديل المطلوب

### السطر ~165 (بـ eff_zone LATERAL):

من:
```sql
         WHERE ot_eff.client_id = c.id
           AND ot_eff.status = 'assigned'
           AND ot_eff.assigned_team_key = $2
           AND ot_eff.assigned_for_date = $3::date
```

إلى:
```sql
         WHERE ot_eff.client_id = c.id
           AND ot_eff.assigned_team_key = $2
           AND ot_eff.assigned_for_date = $3::date
```

## التفسيل

الـ `assigned_team_key` + `assigned_for_date` كفاية لتحديد المهمة الصحيحة. حالة المهمة (`assigned` أو `scheduled` أو غيره) ما لازم توقف حساب الـ effective zone. المهمة نفسها بنفس العنوان — بغض النظر عن حالتها الحالية.

## Deliverables

- [ ] حذف `AND ot_eff.status = 'assigned'` من eff_zone LATERAL
- [ ] Build passed
- [ ] Test: المحطة = "حي المساكن" (zone 267) للمهمة scheduled
