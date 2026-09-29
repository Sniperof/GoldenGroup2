# TASK: zone_id بـ contact_targets يعتمد على نوع المهمة (contract-basis vs client-basis)

> الهدف: `contact_targets.zone_id` يعكس عنوان الزيارة الفعلي — عنوان العقد لـ `device_delivery`/`device_installation`، وعنوان الزبون لـ `device_demo` وغيرها.
> الخلفية: حالياً `zone_id` دايماً بيجيب من `clients.neighborhood`، بس مهمة `device_delivery` لازم تروح لـ `contracts.installation_geo_unit_id`.

---

## ملفات التعديل (3 ملفات)

---

### 1. `packages/api/services/planningMarketingTargets.ts` — `getAssignedLeadsForTeam`

**الحالي:**
الـ SELECT بيرجّع `c.neighborhood` بس. ما في JOIN على `task_type_config` ولا `contracts`.

**المطلوب:**
أضف حساب الـ zone الصحيح لكل `lead`:

```sql
-- في نفس الـ SELECT (بعد ot.notes مثلاً):
      ttc_inner.location_basis AS "locationBasis",
      CASE
        WHEN ttc_inner.location_basis = 'contract' AND ct_loc.installation_geo_unit_id IS NOT NULL
          THEN ct_loc.installation_geo_unit_id
        ELSE
          CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
            THEN c.neighborhood::int
            ELSE NULL
          END
      END AS "effectiveZoneId"
```

وأضف الـ JOINs اللازمة:

```sql
      INNER JOIN task_type_config ttc_inner ON ttc_inner.task_type = ot.task_type
      LEFT JOIN LATERAL (
        SELECT ct.installation_geo_unit_id
        FROM contracts ct
        WHERE ct.customer_id = c.id
          AND ct.installation_geo_unit_id IS NOT NULL
        ORDER BY ct.created_at DESC
        LIMIT 1
      ) ct_loc ON ttc_inner.location_basis = 'contract'
```

**ملاحظة:** هاي نفس المنطق يلي موجود بـ `getPlanningMarketingTargets` (effective_zone). بس هون بدنا نرجّعها مع الـ lead.

---

### 2. `packages/api/routes/telemarketing.ts` — `resolveOrCreateContactTarget`

**الحالي:**
```ts
const geoUnitId = getLeadGeoUnitId(lead);
-- getLeadGeoUnitId بيجيب من lead.neighborhood دايماً
```

**المطلوب:**
استخدم `lead.effectiveZoneId` إذا موجود:

```ts
// قبل: const geoUnitId = getLeadGeoUnitId(lead);
// بعد:
const geoUnitId = Number(lead.effectiveZoneId) > 0 ? Number(lead.effectiveZoneId) : getLeadGeoUnitId(lead);
```

هيك:
- إذا `lead.effectiveZoneId` موجود (من حساب الحمل) → نستخدمه
- إذا لأي سبب مش موجود → fallback على `getLeadGeoUnitId` (المنطق القديم)

---

### 3. `packages/api/routes/contactTargets.ts` — sync query `/marketing/sync`

**الحالي:**
```sql
zone_id = CASE
  WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$' THEN c.neighborhood::int
  ELSE NULL
END
```

دايماً بياخد عنوان الزبون.

**المطلوب:**
```sql
zone_id = (
  -- 1. جيب أحدث مهمة مفتوحة للزبون
  -- 2. شوف location_basis تبعها
  -- 3. إذا 'contract' → عنوان التركيب، وإلا → عنوان الزبون
  SELECT
    CASE
      WHEN ttc.location_basis = 'contract' AND ct.installation_geo_unit_id IS NOT NULL
        THEN ct.installation_geo_unit_id
      ELSE
        CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
          THEN c.neighborhood::int
          ELSE NULL
        END
    END
  FROM open_tasks ot
  INNER JOIN task_type_config ttc ON ttc.task_type = ot.task_type
  LEFT JOIN LATERAL (
    SELECT installation_geo_unit_id
    FROM contracts
    WHERE customer_id = c.id AND installation_geo_unit_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  ) ct ON ttc.location_basis = 'contract'
  WHERE ot.client_id = c.id
    AND ot.status = ANY(ARRAY['open', 'needs_follow_up', 'assigned', 'in_scheduling']::varchar[])
  ORDER BY ot.created_at DESC
  LIMIT 1
)
```

هيك الـ sync query كمان بتاخد أحدث مهمة للزبون وبتستخدم عنوانها الصحيح.

---

## المنطق النهائي

| نوع المهمة | `location_basis` | `zone_id` يلي بيروح بـ `contact_targets` |
|-----------|------------------|----------------------------------------|
| `device_demo` | `client` | `clients.neighborhood` (عنوان الزبون) |
| `device_delivery` | `contract` | `contracts.installation_geo_unit_id` (عنوان الجهاز) |
| `device_installation` | `contract` | `contracts.installation_geo_unit_id` (عنوان الجهاز) |
| `emergency_maintenance` | `client` | `clients.neighborhood` |
| أي مهمة تانية | حسب `task_type_config` | حسب `location_basis` |

---

## التحقق

1. شغّل `/planning/marketing-targets` لزبون عنده `device_delivery` + عقد بـ Zone 5.
2. افتح PlanningContactTargets → يجب أن يظهر Zone 5 (مش عنوان الزبون).
3. جرّب `device_demo` لنفس الزبون → يجب أن يظهر عنوان الزبون الأساسي.
