# TASK: جهة الاتصال = يوم واحد — إصلاح AP-G006

> الهدف: منع إعادة استخدام `contact_target` القديمة المغلقة، وضمان أن كل يوم = جهة اتصال واحدة فقط للزبون.
> النتيجة: مهمة جديدة إما تنضاف لجهة اليوم المفتوحة، أو تُرفض لأن جهة اليوم مغلقة.

---

## الخلفية

`contact_targets` حالياً فيه `UNIQUE constraint` بدون `date`:
```sql
UNIQUE (branch_id, target_type, target_id, visit_type, source_type)
```

معناه: كل زبون = جهة اتصال **واحدة للأبد**.

المشكلة (`AP-G006`): إذا الزبون عنده `contact_target` قديمة مغلقة من حملة أمس/الشهر الماضي، `getAssignedLeadsForTeam` بيرجّعها للمهمة الجديدة → `generate-from-plan` بيستخدمها → `telemarketing.ts` بيلاقي `closed` → 409.

---

## ملفات التعديل (5 ملفات)

### 1. Migration جديد: `migrations/XXX_contact_targets_add_date.sql`

```sql
-- Step 1: Add date column (nullable initially)
ALTER TABLE contact_targets ADD COLUMN IF NOT EXISTS date DATE;

-- Step 2: Backfill existing rows with created_at::date
UPDATE contact_targets SET date = DATE(created_at) WHERE date IS NULL;

-- Step 3: Drop old constraint
ALTER TABLE contact_targets DROP CONSTRAINT IF EXISTS uq_contact_targets_dedupe;

-- Step 4: Add new per-day constraint
ALTER TABLE contact_targets
  ADD CONSTRAINT uq_contact_targets_per_day
  UNIQUE (branch_id, target_type, target_id, visit_type, source_type, date);

-- Step 5: Index for performance
CREATE INDEX IF NOT EXISTS idx_contact_targets_date_status
  ON contact_targets(date, status);
```

**IMPORTANT:** Migration number يكون تسلسلي بعد آخر migration موجود (`SELECT max(id) FROM migrations` + 1).

---

### 2. `packages/api/services/planningMarketingTargets.ts`

#### تعديل A: `getAssignedLeadsForTeam` (سطر ~966)

الـ LEFT JOIN الحالي لـ `contact_targets`:
```sql
LEFT JOIN contact_targets ct
  ON ct.branch_id    = c.branch_id
 AND ct.target_type  = 'client'
 AND ct.target_id    = c.id
 AND ct.target_stage = 'lead'
 AND ct.visit_type   = 'marketing'
 AND ct.source_type  = 'lead'
```

**بدّلها لـ:**
```sql
LEFT JOIN contact_targets ct
  ON ct.branch_id    = c.branch_id
 AND ct.target_type  = 'client'
 AND ct.target_id    = c.id
 AND ct.target_stage = 'lead'
 AND ct.visit_type   = 'marketing'
 AND ct.source_type  = 'lead'
 AND ct.date         = $2::date   -- ← NEW: فقط جهة اليوم
```

**النتيجة:** إذا ما في جهة اليوم → `contactTargetId = null` → بتنشئ جديدة.

#### تعديل B: `getPlanningMarketingTargets` — الـ LEFT JOIN نفسه (4 مواضع)

في استعلام `countsByZone` و `leadRows` — ضيف نفس الشرط:
```sql
AND ct.date = $4::date
```

---

### 3. `packages/api/routes/telemarketing.ts`

#### تعديل A: `resolveOrCreateContactTarget` (سطر ~150)

**الكود الحالي:**
```ts
async function resolveOrCreateContactTarget(
  client: any,
  lead: any,
  branchId: number,
  supervisorHrUserId: number | null,
): Promise<number | null> {
  const contactTargetId = Number(lead.contactTargetId);
  if (Number.isInteger(contactTargetId) && contactTargetId > 0) {
    return contactTargetId;  // ← بيرجّع أي شي، حتى لو مغلق!
  }
  // ... INSERT ... ON CONFLICT
```

**الكود الجديد:**
```ts
async function resolveOrCreateContactTarget(
  client: any,
  lead: any,
  branchId: number,
  supervisorHrUserId: number | null,
  date: string,  // ← NEW parameter
): Promise<number | null> {
  const contactTargetId = Number(lead.contactTargetId);
  if (Number.isInteger(contactTargetId) && contactTargetId > 0) {
    // Verify the contact target is OPEN, not closed
    const { rows: ctRows } = await client.query(
      `SELECT status FROM contact_targets WHERE id = $1`,
      [contactTargetId]
    );
    const ctStatus = ctRows[0]?.status;
    if (ctStatus === 'closed') {
      // Closed target = reject for today
      return null;
    }
    return contactTargetId;
  }

  const entityId = Number(lead.id);
  if (!Number.isInteger(entityId) || entityId <= 0) return null;

  const geoUnitId = getLeadGeoUnitId(lead);

  try {
    const { rows } = await client.query(
      `
      INSERT INTO contact_targets (
        branch_id, target_type, target_id, target_stage, visit_type,
        source_type, source_id, supervisor_hr_user_id, zone_id, status, date
      )
      VALUES ($1, 'client', $2, 'lead', 'marketing', 'lead', $2, $3, $4, 'new', $5::date)
      ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type, date)
      DO UPDATE SET
        supervisor_hr_user_id = EXCLUDED.supervisor_hr_user_id,
        zone_id = EXCLUDED.zone_id,
        source_id = EXCLUDED.source_id,
        updated_at = NOW()
      RETURNING id
      `,
      [branchId, entityId, supervisorHrUserId || null, geoUnitId, date],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}
```

#### تعديل B: `generate-from-plan` (سطر ~1083)

**الكود الحالي:**
```ts
let contactTargetId = await resolveOrCreateContactTarget(pgClient, lead, branchId, supervisorHrUserId);
```

**الكود الجديد:**
```ts
let contactTargetId = await resolveOrCreateContactTarget(pgClient, lead, branchId, supervisorHrUserId, date);
```

#### تعديل C: `generate-from-plan` — handle closed contact_target

بعد الاستدعاء:
```ts
if (contactTargetId == null) {
  skipped.push({
    entityType: 'client',
    entityId,
    reason: 'contact_target_closed_today',
  });
  continue;
}
```

---

### 4. `packages/api/routes/contactTargets.ts`

#### تعديل A: `GET /marketing` sync query

**الكود الحالي:**
```sql
INSERT INTO contact_targets (
  branch_id, target_type, target_id, target_stage, visit_type,
  source_type, source_id, supervisor_hr_user_id, zone_id, status
)
VALUES (..., 'new')
ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type)
DO UPDATE SET ...
```

**الكود الجديد:**
```sql
INSERT INTO contact_targets (
  branch_id, target_type, target_id, target_stage, visit_type,
  source_type, source_id, supervisor_hr_user_id, zone_id, status, date
)
SELECT
  c.branch_id,
  'client',
  c.id,
  'lead',
  'marketing',
  'lead',
  c.id,
  assignment.hr_user_id,
  CASE WHEN NULLIF(c.neighborhood, '') ~ '^[0-9]+$' THEN c.neighborhood::int ELSE NULL END,
  'new',
  CURRENT_DATE  -- ← NEW
FROM clients c
...
ON CONFLICT (branch_id, target_type, target_id, visit_type, source_type, date)
DO UPDATE SET
  supervisor_hr_user_id = EXCLUDED.supervisor_hr_user_id,
  zone_id = EXCLUDED.zone_id,
  source_id = EXCLUDED.source_id,
  updated_at = NOW()
```

#### تعديل B: `GET /marketing` SELECT query

ضيف `AND ct.date = CURRENT_DATE` لشرط الـ WHERE.

---

## التحقق من التنفيذ

بعد التعديل:

1. **نفّذ الميجريشن**
2. **أعد تشغيل السيرفر**
3. **اختبر السيناريوهات التلاتة:**

### سيناريو ١: جهة جديدة
```
زبون أحمد — ما عنده contact_target اليوم
→ syncAssignedTasks → assigned
→ generate-from-plan → resolveOrCreateContactTarget(date=today)
→ ينشئ contact_target #1 (date=today, status=new)
→ task_list_item مربوطة بـ #1
```

### سيناريو ٢: مهمة جديدة لنفس اليوم
```
أحمد — عنده contact_target #1 (date=today, status=new)
→ syncAssignedTasks → assigned (مهمة تانية)
→ getAssignedLeadsForTeam → ct.date = today → بيلاقي #1
→ generate-from-plan → contactTargetId = 1 → status != closed → ✅
→ task_list_item تانية مربوطة بـ نفس #1
→ contact_target ما بتتكرر
```

### سيناريو ٣: جهة مقفلة + مهمة جديدة
```
أحمد — عنده contact_target #1 (date=today, status=closed)
→ syncAssignedTasks → assigned
→ getAssignedLeadsForTeam → ct.date = today → بيلاقي #1 (بس status=closed)
→ generate-from-plan → resolveOrCreateContactTarget → ctStatus === 'closed' → return null
→ skipped: { reason: 'contact_target_closed_today' }
→ المهمة ما بتنحسب بالحمل → لازم تتأجل لبكرة
```

---

## قيود وتحذيرات

- **لا تعدّل أي ملف تاني** غير الـ 5 المذكورين.
- **لا تمسح بيانات قديمة** — الـ backfill بيحط `date = created_at::date` للقديم.
- **لا تغيّر حالات contact_targets القديمة** — هنّي تاريخ، ما إلن علاقة باليوم.
- **testing على staging** قبل أي شيء.
