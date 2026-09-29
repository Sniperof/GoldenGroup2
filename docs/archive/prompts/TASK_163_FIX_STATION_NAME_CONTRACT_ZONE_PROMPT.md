# TASK: إصلاح عرض اسم المحطة لمهام بـ location_basis = 'contract'

## المشكلة

بالداشبورد جهات الاتصال (`/planning/contact-targets`)، عمود "المحطة" بيظهر **الحميدية** (zone 47 = neighborhood الزبون) بدل **حي المساكن** (zone 267 = عنوان التركيب بالعقد).

هاد بيصير للمهام يلي `location_basis = 'contract'` (مثل `device_delivery` و `device_installation`) — لأنّهن بيعتمدن عنوان العقد مش عنوان الزبون.

## الملف المستهدف

`packages/api/routes/planning.ts`

## التعديل المطلوب

### الخطوة ٢ من `/assigned-tasks` (client meta query — الأسطر ~133-156):

الـ query الحالي:
```sql
SELECT c.id, c.name, c.mobile, c.contacts,
       c.candidate_status AS "candidateStatus",
       gu.name AS "stationName",
       ...
FROM clients c
LEFT JOIN geo_units gu ON gu.id = NULLIF(c.neighborhood, '')::int
LEFT JOIN contact_targets ct ON ...
WHERE c.id = ANY($1::int[])
```

**المشكلة:** `gu.name` دائماً من `clients.neighborhood` — ما بياخد بعين الاعتبار `location_basis`.

### الـ query الجديد:

بدّل الـ `LEFT JOIN geo_units` البسيط بالـ effective zone calculation:

```sql
SELECT c.id, c.name, c.mobile, c.contacts,
       c.candidate_status AS "candidateStatus",
       COALESCE(eff_zone.name, gu.name) AS "stationName",
       ct.id AS "contactTargetId",
       ct.status AS "contactTargetStatus",
       ct.latest_call_outcome AS "contactTargetOutcome"
FROM clients c
LEFT JOIN geo_units gu ON gu.id = NULLIF(c.neighborhood, '')::int
LEFT JOIN LATERAL (
  SELECT gu_eff.name
  FROM open_tasks ot_eff
  INNER JOIN task_type_config ttc_eff ON ttc_eff.task_type = ot_eff.task_type
  LEFT JOIN LATERAL (
    SELECT ct2.installation_geo_unit_id
    FROM contracts ct2
    WHERE ct2.customer_id = c.id
      AND ct2.installation_geo_unit_id IS NOT NULL
    ORDER BY ct2.created_at DESC
    LIMIT 1
  ) ct_loc ON ttc_eff.location_basis = 'contract'
  LEFT JOIN geo_units gu_eff ON gu_eff.id = CASE
    WHEN ttc_eff.location_basis = 'contract' AND ct_loc.installation_geo_unit_id IS NOT NULL
      THEN ct_loc.installation_geo_unit_id
    ELSE NULLIF(c.neighborhood, '')::int
  END
  WHERE ot_eff.client_id = c.id
    AND ot_eff.status = 'assigned'
    AND ot_eff.assigned_team_key = $2
    AND ot_eff.assigned_for_date = $3::date
  ORDER BY ot_eff.created_at DESC
  LIMIT 1
) eff_zone ON TRUE
LEFT JOIN contact_targets ct
  ON ct.branch_id = c.branch_id
 AND ct.target_type = 'client'
 AND ct.target_id = c.id
 AND ct.target_stage = 'lead'
 AND ct.visit_type = 'marketing'
 AND ct.source_type = 'lead'
WHERE c.id = ANY($1::int[])
```

**وتعديل الـ parameters:**

من:
```ts
[clientIds],
```

إلى:
```ts
[clientIds, teamKey, date],
```

## التفسير

- `eff_zone` LATERAL: بيجيب آخر مهمة مُسندة للزبون ضمن الفريق والتاريخ، وبينزل لـ geo_units حسب `location_basis`.
- `COALESCE(eff_zone.name, gu.name)`: إذا في effective zone → استخدمها. إذا لا → رجع لـ `clients.neighborhood`.
- لمهمة `device_delivery` بـ `location_basis = 'contract'` → بيعطي **حي المساكن** (zone 267).
- لمهمة `device_demo` بـ `location_basis = 'client'` → بيعطي **الحميدية** (zone 47).

## Deliverables

- [ ] تعديل client meta query بـ `/assigned-tasks` لحساب effective zone
- [ ] تعديل الـ parameters [$1] → [$1, $2, $3]
- [ ] Build passed
- [ ] Test: مهمة `device_delivery` → المحطة = "حي المساكن" مش "الحميدية"
