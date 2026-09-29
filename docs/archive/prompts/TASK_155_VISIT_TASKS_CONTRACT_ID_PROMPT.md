# TASK: إضافة contract_id لـ visit_tasks + توحيد مصدر معلومات العقد/الجهاز

## المشكلة

تاب "العقد والجهاز" (TaskContractTab) بيعرض معلومات العقد والجهاز. حالياً:

1. **المعلومات بتجي من `open_tasks.contract_snapshot`** — JSONB snapshot مخزن وقت إنشاء الـ open_task.
2. **الـ snapshot قديم (stale)** — لو تغيّر العقد (مثلاً ضيفنا رقم تسلسلي، أو تغيّر العنوان)، الـ snapshot ما بيتحدّث.
3. **المصدر موحّد** — `device_demo` بيجيب العقد من `visit_task_device_demo_results.contract_id`، بس باقي المهام (delivery/installation/activation) بيجيبوها من `open_tasks.contract_snapshot`.

## الهدف

1. **إضافة `contract_id` مباشرة لـ `visit_tasks`**
2. **توحيد مصدر معلومات العقد/الجهاز** — التاب لازم يجيب معلومات العقد **مباشرة من جدول `contracts`** (live data)، مش من snapshot قديم.
3. **جميع المهام** (device_demo, device_delivery, device_installation, device_activation, emergency_maintenance) لازم تستخدم نفس المصدر.

---

## الملفات يلي لازم تتعدّل

### 1. Migration: `migrations/155_visit_tasks_contract_id.sql`

```sql
BEGIN;

-- 1. Add contract_id to visit_tasks
ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL;

-- 2. Add contract_snapshot JSONB for audit (optional but recommended — stores a point-in-time copy)
ALTER TABLE visit_tasks
  ADD COLUMN IF NOT EXISTS contract_snapshot JSONB;

-- 3. Index for performance
CREATE INDEX IF NOT EXISTS idx_visit_tasks_contract_id
  ON visit_tasks(contract_id);

COMMIT;
```

**ملاحظة:** `contract_snapshot` هون = نسخة archive (audit trail) مش المصدر الرئيسي للـ UI. الـ UI لازم يجيب من `contracts` مباشرة.

---

### 2. `packages/api/routes/telemarketing.ts` — Bridge sync (~line 367-447)

**النص الحالي:**
```typescript
await db.query(
  `INSERT INTO visit_tasks (
     field_visit_id, source_open_task_id, task_type, task_family,
     sequence_no, status, source_legacy_type, source_legacy_id
   )
   VALUES ($1,$2,$3,$4,$5,'pending','marketing_visit_task',$6)
   ON CONFLICT ...`,
  [fieldVisitId, task.openTaskId ?? null, taskType, taskFamily, i + 1, legacyTaskId],
);
```

**المطلوب:**
- جيب `contract_id` من `open_tasks` يلي `id = task.openTaskId`
- ضيف `contract_id` للـ INSERT

**التعديل:**
```typescript
// Before the INSERT loop, fetch contract_ids for all open tasks
const openTaskIds = params.selectedTasks
  .map(t => t.openTaskId)
  .filter(id => Number.isInteger(id) && id > 0);

const { rows: otRows } = await db.query(
  `SELECT id, contract_id FROM open_tasks WHERE id = ANY($1::int[])`,
  [openTaskIds],
);
const contractIdByOpenTask = new Map<number, number | null>();
otRows.forEach((row: any) => contractIdByOpenTask.set(Number(row.id), row.contract_id ?? null));

// Inside the loop:
const contractId = task.openTaskId != null ? contractIdByOpenTask.get(task.openTaskId) ?? null : null;

await db.query(
  `INSERT INTO visit_tasks (
     field_visit_id, source_open_task_id, task_type, task_family,
     sequence_no, status, source_legacy_type, source_legacy_id, contract_id
   )
   VALUES ($1,$2,$3,$4,$5,'pending','marketing_visit_task',$6,$7)
   ON CONFLICT ...`,
  [fieldVisitId, task.openTaskId ?? null, taskType, taskFamily, i + 1, legacyTaskId, contractId],
);
```

---

### 3. `packages/api/routes/openTasks.ts` — GET /:id (~line 151)

**النص الحالي:**
```typescript
const OPEN_TASK_SELECT = `
  SELECT
    ot.*, 
    ot.client_snapshot AS "clientSnapshot",
    ot.contract_snapshot AS "contractSnapshot",
    ...
`;
```

**المشكلة:** `contractSnapshot` بيجي من `ot.contract_snapshot` — JSONB قديم.

**المطلوب:** بناء `contractSnapshot` fresh من `contracts` table.

**التعديل المقترح:**

خلي الـ `OPEN_TASK_SELECT` يجيب `ot.contract_id` بدل `ot.contract_snapshot AS "contractSnapshot"`. وبعدين بالـ `mapOpenTaskRow`، لو فيه `contract_id`، نبني `contractSnapshot` fresh.

**بس** — هاد بيعني نعمل JOIN على `contracts` + `geo_units` لكل GET. أبسط حل:

1. خلي الـ `OPEN_TASK_SELECT` يجيب `ot.contract_id` (بدل contract_snapshot)
2. بالـ `mapOpenTaskRow`، خلي `contractSnapshot: null` (build it later)
3. بالـ `GET /:id` endpoint، بعد ما نجيب الصف، نبني `contractSnapshot` fresh من `contracts` table

**أو** — أبسط: خلي الـ `GET /:id` endpoint يعمل JOIN مباشرة:

```typescript
router.get('/:id', requirePermission('field_visits.view'), async (req, res) => {
  // ... existing code ...
  const { rows } = await db.query(`${OPEN_TASK_SELECT} WHERE ot.id = $1`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'المهمة غير موجودة' });
  
  const task = mapOpenTaskRow(rows[0]);
  
  // Build fresh contract snapshot if contract_id exists
  if (task.contractId) {
    task.contractSnapshot = await buildContractSnapshot(db, task.contractId);
  }
  
  res.json(task);
});
```

**وحتى نتجنب N+1 queries** — بنعمل function `buildContractSnapshot` مشابهة لـ `buildOpenTaskSnapshots` بس بترجّع بس الـ contract part.

```typescript
async function buildContractSnapshot(db: Queryable, contractId: number) {
  const { rows } = await db.query(
    `SELECT
      c.id, c.contract_number, c.contract_date,
      c.device_model_id, c.device_model_name, c.serial_number, c.maintenance_plan,
      c.installation_geo_unit_id, c.installation_address_text,
      c.installation_lat, c.installation_lng,
      c.payment_type, c.final_price, c.down_payment, c.installments_count,
      c.status,
      gu.name AS installation_geo_unit_name
     FROM contracts c
     LEFT JOIN geo_units gu ON gu.id = c.installation_geo_unit_id
     WHERE c.id = $1`,
    [contractId],
  );
  
  if (!rows[0]) return null;
  const cr = rows[0];
  return {
    contractId: cr.id,
    contractNumber: cr.contract_number ?? '',
    contractDate: cr.contract_date ?? '',
    device: {
      modelId: cr.device_model_id ?? null,
      modelName: cr.device_model_name ?? '',
      serialNumber: cr.serial_number ?? '',
      maintenancePlan: cr.maintenance_plan ?? '',
    },
    installationAddress: {
      geoUnitId: cr.installation_geo_unit_id ?? null,
      geoUnitName: cr.installation_geo_unit_name ?? null,
      addressText: cr.installation_address_text ?? null,
      lat: cr.installation_lat ? Number(cr.installation_lat) : null,
      lng: cr.installation_lng ? Number(cr.installation_lng) : null,
    },
    financials: {
      paymentType: cr.payment_type ?? '',
      finalPrice: Number(cr.final_price) || 0,
      downPayment: Number(cr.down_payment) || 0,
      installmentsCount: cr.installments_count || 0,
      currency: 'SYP',
    },
    status: cr.status ?? '',
  };
}
```

**مهم:** الـ `contract_snapshot` column الموجود بـ `open_tasks` **ما نحذفو** — نخلي موجود كـ archive/audit trail. بس الـ API رح يبني `contractSnapshot` fresh ويرجّعو.

---

### 4. `packages/api/routes/fieldVisits.ts` — GET /:id (~line 399)

**النص الحالي:** الـ tasks بيرجّعوا من query:
```sql
SELECT vt.*, vtr.id AS result_id, ...
FROM visit_tasks vt
LEFT JOIN visit_task_results vtr ON vtr.visit_task_id = vt.id
LEFT JOIN visit_task_device_demo_results vtddr ON vtddr.visit_task_result_id = vtr.id
...
```

**المطلوب:** نضيف `contract_id` ونبني `contractSnapshot` لكل task.

**بس** — هاد بيعني نعمل JOIN مع `contracts` لكل task، أو نبني الـ snapshot بـ JavaScript بعد ما نجيب النتائج.

**اقتراح:** نضيف `contract_id` للـ SELECT، ونترك الـ frontend يجيب العقد لما يحتاجو (عبر `api.contracts.get`).

**أو** — أحسن: نبني `contractSnapshot` fresh بالـ API ونرجّعو مع كل task.

**التعديل المقترح:**
```sql
SELECT 
  vt.*,
  vt.contract_id AS "contractId",
  ...
```

وبعدين بالـ JavaScript:
```typescript
const contractIds = tasksRes.rows
  .map(t => t.contract_id)
  .filter(id => Number.isInteger(id) && id > 0);

const contractSnapshots = new Map<number, any>();
if (contractIds.length > 0) {
  // Build all contract snapshots in one query
  const { rows: contractRows } = await pool.query(
    `SELECT ... FROM contracts WHERE id = ANY($1::int[])`,
    [contractIds],
  );
  // ... build snapshots and store in Map
}

const tasks = tasksRes.rows.map((t: any) => {
  // ... existing mapping ...
  const contractSnapshot = contractSnapshots.get(t.contract_id) ?? null;
  return {
    ...rest,
    contractId: t.contract_id ?? null,
    contractSnapshot,
    // ...
  };
});
```

---

### 5. `packages/web/src/components/tasks/tabs/TaskContractTab.tsx`

**النص الحالي:**
```typescript
const contract = task.contractSnapshot;
```

**ما لازم يتغيّر** — التاب بيشتغل صح. المطلوب بس إن `task.contractSnapshot` يكون دايماً fresh وموحّد.

---

## Deliverables

- [ ] Migration `155_visit_tasks_contract_id.sql`
- [ ] `telemarketing.ts` — bridge sync يعبّي `contract_id`
- [ ] `openTasks.ts` — GET /:id يبني `contractSnapshot` fresh من `contracts`
- [ ] `fieldVisits.ts` — GET /:id يرجّع `contractSnapshot` fresh مع كل task
- [ ] `pnpm run migrate` passed
- [ ] Build passed
- [ ] Test: open task detail → Contract tab → تأكد إن العقد fresh (جرب تعدّل serial_number من DB وتحدّث الصفحة)
