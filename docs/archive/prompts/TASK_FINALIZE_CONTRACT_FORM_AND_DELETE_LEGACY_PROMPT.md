# TASK: نهائي — نهigrate ContractForm + حذف marketingVisits.ts backend + حذف الباقي

> السياق: مراحل 6-8 منفذة. باقي بس:
>   1. ContractForm.tsx بيستخدم api.marketingVisits.get() + api.marketingVisits.linkOfferContract()
>   2. marketingVisits.ts backend لسا موجود
>   3. 2 methods بـ api.ts (get + linkOfferContract)
>   4. بعض types بـ shared/types.ts
> الهدف: نهigrate ContractForm لـ fieldVisits، بعدين نحذف كلshي leftover legacy.

---

## المرحلة 8.5: نهigrate ContractForm.tsx (قبل الحذف النهائي)

### 8.5.1 فهم الاستخدام الحالي

**بـ ContractForm.tsx سطر 412:**
```ts
const detailed = await Promise.all(
    visitIds.map((id) => api.marketingVisits.get(id).catch(() => null))
);
```

**بـ ContractForm.tsx سطر 854:**
```ts
await api.marketingVisits.linkOfferContract(
    visitId,
    taskId,
    offerId,
    { contractId: savedContract.id }
);
```

**الاستخدام:**
- `get(id)` — بيجيب تفاصيل الزيارة (marketing visit) عشان يعرض العروض (offers) يلي الزبون قبلها
- `linkOfferContract(...)` — بيربط offer بـ contract (لما بيخلص العقد)

### 8.5.2 التعديل المطلوب

#### A — `api.fieldVisits.get` لازم يرجّع offers

**الملف:** `packages/api/routes/fieldVisits.ts` — GET `/:id`

**المطلوب:** لما الزيارة `visit_type = 'marketing'`，لازم نجيب العروض من `visit_task_device_demo_results` أو `visit_task_results.details`.

**الكود يلي لازم يضاف بـ `loadVisitById` (أو يلي بيجيب الزيارة):**
```ts
// After fetching visit + tasks:
const taskIds = visit.tasks.map(t => t.id);

// Fetch offers for device_demo tasks
const { rows: offerRows } = await db.query(
  `SELECT
     vtd.id,
     vtd.device_model_id AS "deviceModelId",
     vtd.offer_type AS "offerType",
     vtd.quantity,
     vtd.total_amount AS "totalAmount",
     vtd.first_payment_amount AS "firstPaymentAmount",
     vtd.installment_months AS "installmentMonths",
     vtd.currency,
     vtd.discount_percentage AS "discountPercentage",
     vtd.closed_by_employee_id AS "closedByEmployeeId",
     vtd.no_closing_reason AS "noClosingReason",
     vtd.customer_response AS "customerResponse",
     vtd.rejection_reason_id AS "rejectionReasonId",
     vtd.extension_reason_id AS "extensionReasonId",
     vtd.extension_due_date AS "extensionDueDate",
     vtd.sale_reference_number AS "saleReferenceNumber",
     vtd.contract_id AS "contractId"
   FROM visit_task_device_demo_results vtd
   JOIN visit_tasks vt ON vt.id = vtd.visit_task_id
   WHERE vt.field_visit_id = $1
     AND vtd.customer_response = 'accepted'`,  // or all responses, filter in UI
  [visitId]
);

// Add offers to the task(s)
visit.tasks = visit.tasks.map(t => ({
  ...t,
  offers: offerRows.filter(o => o.visitTaskId === t.id),
}));
```

#### B — `api.fieldVisits.linkOfferContract` — endpoint جديد

**الملف:** `packages/api/routes/fieldVisits.ts`

**أضف:**
```ts
// POST /field-visits/:visitId/tasks/:taskId/offers/:offerId/contract
router.post('/:visitId/tasks/:taskId/offers/:offerId/contract', 
  requirePermission('field_visits.update_result'), 
  async (req, res) => {
    const { visitId, taskId, offerId } = req.params;
    const { contractId } = req.body;
    
    // Verify the task belongs to this visit
    const { rows: taskRows } = await pool.query(
      'SELECT id FROM visit_tasks WHERE id = $1 AND field_visit_id = $2',
      [taskId, visitId]
    );
    if (taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found in this visit' });
    }
    
    // Update the offer's contract_id
    await pool.query(
      `UPDATE visit_task_device_demo_results
       SET contract_id = $1, updated_at = NOW()
       WHERE id = $2 AND visit_task_id = $3`,
      [contractId, offerId, taskId]
    );
    
    res.json({ success: true });
  }
);
```

#### C — `api.ts` — أضف الـ method الجديد

**الملف:** `packages/web/src/lib/api.ts`

**أضف لـ `fieldVisits:` block:**
```ts
// Add inside fieldVisits: block
linkOfferContract: (visitId: string, taskId: string, offerId: string, data: { contractId: number }) =>
  request<any>(`/field-visits/${visitId}/tasks/${taskId}/offers/${offerId}/contract`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
```

#### D — `ContractForm.tsx` — غيّر الاستدعاء

**سطر 412:**
```ts
// BEFORE:
visitIds.map((id) => api.marketingVisits.get(id).catch(() => null))

// AFTER:
visitIds.map((id) => api.fieldVisits.get(Number(id)).catch(() => null))
```

**سطر 854:**
```ts
// BEFORE:
await api.marketingVisits.linkOfferContract(visitId, taskId, offerId, { contractId: savedContract.id })

// AFTER:
await api.fieldVisits.linkOfferContract(visitId, taskId, offerId, { contractId: savedContract.id })
```

**ملاحظة:** `ContractForm.tsx` بيستخدم `marketingVisitId` من `open_tasks`. هاد لازم يصير `fieldVisitId` (أو `visitId`). إذا الـ DB schema تغيّر → تأكد إن `open_tasks` بيحمل `field_visit_id`.

---

## المرحلة 9: حذف marketingVisits.ts backend

### 9.1 احذف الملف
```bash
rm /opt/golden-crm/apps/staging/packages/api/routes/marketingVisits.ts
```

### 9.2 احذف من index.ts
```bash
# In packages/api/index.ts:
# DELETE: import marketingVisitsRouter from './routes/marketingVisits.js';
# DELETE: app.use('/api/marketing-visits', ...branchOnly, marketingVisitsRouter);
```

---

## المرحلة 10: حذف آخر 2 methods من api.ts

### 10.1 احذف من `packages/web/src/lib/api.ts`

```ts
// DELETE the entire marketingVisits: block:
marketingVisits: {
  get: (id: string) => request<any>(`/marketing-visits/${id}`),
  linkOfferContract: (visitId: string, taskId: string, offerId: string, data: any) =>
    request<any>(`/marketing-visits/${visitId}/tasks/${taskId}/offers/${offerId}/contract`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
```

---

## المرحلة 11: حذف الباقي من types.ts

### 11.1 احذف من `packages/shared/types.ts`

```ts
// DELETE (if still present):
MarketingVisitStage
MarketingVisitCompletionState
MarketingVisitStatus
MarketingVisitTaskResult
MarketingVisitTaskOutcome
MarketingVisitTaskOfferInput
```

> **تأكد قبل الحذف:**
```bash
grep -r "MarketingVisitStage\|MarketingVisitCompletionState\|MarketingVisitStatus\|MarketingVisitTaskResult\|MarketingVisitTaskOutcome\|MarketingVisitTaskOfferInput" packages/ --include="*.ts" --include="*.tsx" | grep -v "shared/types.ts"
```
> إذا 0 results → احذف. إذا في results → نهigrate الملفات يلي بيستخدموهن أولاً.

---

## المرحلة 12: Verify build

```bash
cd /opt/golden-crm/apps/staging

# Type check all:
pnpm --filter @golden-crm/api exec tsc --noEmit
pnpm --filter @golden-crm/web exec tsc -p tsconfig.typecheck.json --noEmit
pnpm --filter @golden-crm/shared exec tsc --noEmit

# Build frontend:
pnpm --filter @golden-crm/web build

# Restart server:
pm2 restart golden-crm-staging
```

---

## المرحلة 13: Part B — DB Drop (refer to existing prompt)

**بعد ما كلshي فوق ينجح 100%:**

1. شغّل `grep` تأكد إن `marketing_visits` مش موجود بالكود (0 results)
2. شغّل الـ backup command
3. نفذ migration `migrations/XXX_drop_marketing_visits_legacy.sql`
4. نفذ verification checklist من `TASK_UNIFIED_VISIT_MIGRATION_PHASES_9_10_VERIFY_PROMPT.md`

---

## ملاحظات أمان

1. **لا تحذف أي type قبل ما تتأكد إنه ما حدا بيستخدمه.**
2. **بني (build) بعد كل مرحلة.**
3. **إذا build فاشل → `git checkout` لآخر commit ناجح.**
4. **لا تنفذ DB migration قبل ما الـ code يكون clean تماماً.**
