# TASK: إضافة zone_id للـ UNIQUE constraint تبع contact_targets + تعديل Planning

## المشكلة

جهة الاتصال (contact_target) لازم تكون = زبون + تاريخ + zone (عنوان). 
حالياً:

1. الـ UNIQUE constraint عندنا:
```
UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date)
```
→ نفس الزبون + نفس اليوم = جهة اتصال واحدة فقط، حتى لو عنده مهام بـ zones مختلفة.

2. `planningMarketingTargets.ts` بيعمل `SELECT DISTINCT ON (c.id)` → الزبون بيرجّع مرة واحدة بس بالplanning، حتى لو عنده أكتر من مهمة بمناطق مختلفة (مثلاً: عرض جهاز بعنوان الزبون zone 5 + صيانة جهاز 1 بعنوان العقد zone 12).

3. الـ zone filter بالplanning بيختار "أحدث" مهمة (`ORDER BY ot_inner.created_at DESC LIMIT 1`) → المهام التانية بـ zones مختلفة بتضيع.

## الهدف

- كل zone مختلف = جهة اتصال منفصلة (حتى لو نفس الزبون، نفس اليوم).
- Planning لازم يحسب load وحدة لكل zone/contact_target، مش لكل زبون.
- Telemarketer Workspace لازم تقدر تحجز أكتر من زيارة ميدانية لنفس الزبون بيوم واحد (بzones مختلفة).

---

## الملفات يلي لازم تتعدّل

### 1. Migration جديد: `migrations/154_contact_targets_zone_unique.sql`

**المطلوب:**
```sql
BEGIN;

-- 1. Drop old per-day constraint (without zone_id)
ALTER TABLE contact_targets DROP CONSTRAINT IF EXISTS uq_contact_targets_per_day;

-- 2. Add new per-day-per-zone constraint
ALTER TABLE contact_targets
  ADD CONSTRAINT uq_contact_targets_per_day_zone
  UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date, zone_id);

-- 3. Ensure zone_id is indexed for performance
CREATE INDEX IF NOT EXISTS idx_contact_targets_zone_date
  ON contact_targets(zone_id, date);

COMMIT;
```

**ملاحظة:** لا تعمل backfill لـ zone_id — الـ code الحالي بيعبيه عند الإنشاء.

---

### 2. `packages/api/routes/telemarketing.ts`

**السطر:** ~line 181
**النص الحالي:**
```sql
ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type, date)
```
**النص الجديد:**
```sql
ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type, date, zone_id)
```

**التأكد:** الـ `DO UPDATE SET` موجود:
```sql
DO UPDATE SET
  supervisor_hr_user_id = EXCLUDED.supervisor_hr_user_id,
  zone_id = EXCLUDED.zone_id,
  source_id = EXCLUDED.source_id,
  updated_at = NOW()
```
→ هاد صح، بس لما يصير zone_id جزء من الـ ON CONFLICT، كل zone رح يصير له UPSERT مستقل.

---

### 3. `packages/api/services/planningMarketingTargets.ts`

**هاد أعقد تعديل. بدنا نغيّر 3 أشياء:**

#### أ) `countsByZone` query (حوالي line 433)

**النص الحالي:**
```sql
SELECT DISTINCT ON (c.id)
  CASE
    WHEN ttc_eff.location_basis = 'contract' AND ct_loc.installation_geo_unit_id IS NOT NULL
      THEN ct_loc.installation_geo_unit_id
    ELSE
      CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
        THEN c.neighborhood::int
        ELSE NULL
      END
  END AS effective_zone
```

**المشكلة:** `DISTINCT ON (c.id)` بيخفي tasks إضافية لنفس الزبون بzones مختلفة.

**النص الجديد:**
```sql
SELECT DISTINCT ON (c.id, effective_zone)
  CASE
    WHEN ttc_eff.location_basis = 'contract' AND ct_loc.installation_geo_unit_id IS NOT NULL
      THEN ct_loc.installation_geo_unit_id
    ELSE
      CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
        THEN c.neighborhood::int
        ELSE NULL
      END
  END AS effective_zone
```

**ومع الـ `ORDER BY` لازم يصير:**
```sql
ORDER BY c.id, effective_zone, ot_inner.created_at DESC
```
→ هاد بيخلي الزبون يظهر مرة لكل zone مختلف.

**بس فيه مشكلة:** `effective_zone` هو calculated expression، ما فينا نستخدمه جوه `DISTINCT ON` و `ORDER BY` مباشرة لأنه expression مش alias بالـ same level.

**الحل:** نحط الـ `effective_zone` calculation جوه `ORDER BY` كمان:
```sql
ORDER BY c.id,
  CASE
    WHEN ttc_eff.location_basis = 'contract' AND ct_loc.installation_geo_unit_id IS NOT NULL
      THEN ct_loc.installation_geo_unit_id
    ELSE
      CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
        THEN c.neighborhood::int
        ELSE NULL
      END
  END,
  ot_inner.created_at DESC
```

#### ب) Lead data query (حوالي line 689-710)

**الـ zone filter الحالي (lines 704-710):**
```sql
AND (
  (ot.location_basis = 'contract' AND ct_zone.installation_geo_unit_id = ANY($2::int[]))
  OR
  (COALESCE(ot.location_basis, 'client') = 'client'
    AND NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
    AND c.neighborhood::int = ANY($2::int[]))
)
```
→ هاد صح، بس بيرتبط بـ `ot` (أحدث task) بس. لما نغيّر الـ logic، لازم نتأكد إن كل task بـ zone تبعو بتظهر.

**الـ exclusion الحالي (lines 695-702):**
```sql
AND NOT EXISTS (
  SELECT 1 FROM contact_targets ct_excl
  WHERE ct_excl.target_id   = c.id
    AND ct_excl.target_type = 'client'
    AND ct_excl.branch_id   = $1
    AND ct_excl.date = $4::date
    AND ct_excl.status      = 'closed'
)
```

**المشكلة:** هاد بيمنع الزبون بالكامل لو أي contact_target مقفلة.

**الحل المطلوب:** غيّر الـ exclusion ليصبح per-zone. يعني: مانع الزبون **من zone معين** إذا contact_target يلي بذات الـ zone مقفلة.

**بس هاد صعب لأنه بيتطلب ربط `effective_zone` مع `contact_targets.zone_id`.**

**اقتراح أبسط:** بدل ما نمنع الزبون من الظهور بالكامل، نخلي الـ planning تظهر الزبون لكل zones، ونترك الـ frontend يحدد إي contact_target مفتوحة. بس هاد بيعني نحذف الـ exclusion الحالي ونستبدله بشي تاني.

**القرار النهائي يلي بدنا ياه:**
- countsByZone: يحسب الزبون لكل zone منفصلة (`DISTINCT ON (c.id, effective_zone)`).
- Lead query: يعرض الزبون لكل zone منفصلة.
- Exclusion: يمنع الزبون من **zone معين** إذا contact_target يلي بذات الـ zone مقفلة.

**التعديل المقترح للـ exclusion:**
```sql
-- PC-4.7: exclude per-zone closed contact_targets
AND NOT EXISTS (
  SELECT 1 FROM contact_targets ct_excl
  WHERE ct_excl.target_id   = c.id
    AND ct_excl.target_type = 'client'
    AND ct_excl.branch_id   = $1
    AND ct_excl.date        = $4::date
    AND ct_excl.status      = 'closed'
    AND ct_excl.zone_id = (
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
)
```
→ هاد بيمنع الزبون من zone معين إذا contact_target يلي بنفس الـ zone مقفلة.

**بس فيه مشكلة تانية:** الـ `contact_target` JOIN (lines 606-613) بيعمل:
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
→ ما فيه `zone_id` condition. يعني لو الزبون عنده 2 contact_targets، الـ JOIN رح يرجّع صفين (Cartesian product). لازم نضيف `zone_id` condition للـ JOIN.

**التعديل المطلوب للـ contact_target JOIN:**
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

**ومع هيك، الـ `DISTINCT ON (c.id)` ممكن يضل موجود لأنه كل صف بيصير unique حسب (client + zone).**

---

## ملاحظات مهمة

1. **zone_id nullable:** هلق الـ `zone_id` nullable بـ `contact_targets`. الـ UNIQUE constraint بـ PostgreSQL: `NULL != NULL`، يعني rows with NULL zone_id ما بيتعارضوا مع بعض. بس الـ code الحالي بيعبي `zone_id` دايماً (من `lead.effectiveZoneId` أو `getLeadGeoUnitId`). التأكد إن ما في contact_targets بـ `zone_id = NULL`.

2. **Frontend impact:** `PlanningLead` interface بيحتوي `contactTargetId` وحدة. هلق لما الزبون بيرجّع لكل zones، `contactTargetId` رح يختلف حسب الـ zone. الـ frontend لازم يتعامل مع هالشي. بس هاد خارج scope هالتاسك — هاد backend fix بس.

3. **Testing:** بعد التعديل:
   - إنشاء زبون بـ zone 5 (عنوان الزبون).
   - إنشاء contact_target لـ zone 5.
   - إنشاء contact_target لـ zone 12 (عنوان عقد مختلف) لنفس الزبون بنفس اليوم.
   - التأكد إنه contact_target التانية ما بتكتب فوق الأولى.
   - Planning: التأكد إن countsByZone بيحسب zone 5 و zone 12 منفصلين.

4. **Order of execution:**
   1. Migration 154
   2. telemarketing.ts (ON CONFLICT)
   3. planningMarketingTargets.ts (queries)
   4. build + restart

---

## Deliverables

- [ ] Migration `154_contact_targets_zone_unique.sql`
- [ ] `telemarketing.ts` updated ON CONFLICT
- [ ] `planningMarketingTargets.ts` updated DISTINCT ON + zone filter + exclusion + contact_target JOIN
- [ ] `pnpm run migrate` passed
- [ ] Build passed
- [ ] Test: two contact_targets for same client, same day, different zones
