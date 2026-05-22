# TASK 20: Fix MarketingVisitOutcomeModal — Load devices + unify closing experience

## Branch
`staging`

## Goal
Fix two issues in the new wizard (`MarketingVisitOutcomeModal`):
1. When a task is created with devices but NO pre-offers, the wizard still shows "لا يوجد أجهزة محددة". The backend must load `open_task_devices` into `visit.devices`.
2. Unify the "closing employee" and "no-closing reason" fields to match the new Task 19 pattern: use `/employees/closers`, use `system_lists` for reasons, remove `currency`.

## Files to modify
- `packages/api/routes/marketingVisits.ts` — `loadVisitById`
- `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx`

---

## Part A — Backend: marketingVisits.ts

### Location
Function `loadVisitById(req, visitId)` — after the `preOfferRows` query block (around line ~415), before `return visit`.

### Change
Add a query to load `open_task_devices` via the task's `source_open_task_id`:

```typescript
// Load linked open_task_devices (for cases where devices were selected but no pre-offers created)
const sourceOpenTaskId = visit?.task?.sourceOpenTaskId ?? null;
if (sourceOpenTaskId != null) {
  const { rows: deviceRows } = await pool.query(
    `SELECT
       device_model_id AS "deviceModelId",
       device_name_snapshot AS "deviceModelName",
       quantity
     FROM open_task_devices
     WHERE task_id = $1`,
    [sourceOpenTaskId],
  );
  if (deviceRows.length > 0) {
    (visit as any).devices = deviceRows.map((row) => ({
      deviceModelId: row.deviceModelId != null ? Number(row.deviceModelId) : null,
      deviceModelName: row.deviceModelName ?? null,
      quantity: row.quantity != null ? Number(row.quantity) : 1,
    }));
  }
}
```

### Why
`buildDeviceOfferGroups` in the frontend checks `visit.devices` first. If no pre-offers exist but devices were selected in Task 19, `visit.devices` is currently empty, causing the "لا يوجد أجهزة محددة" error.

---

## Part B — Frontend: MarketingVisitOutcomeModal.tsx

### B1. Remove `currency` from the offer editor

**In `OfferDraft` interface (around line ~75):**
- Remove `currency: string;`

**In `DeviceOffer` interface (around line ~44):**
- Remove `currency: string;`

**In `createEmptyDraft()` (around line ~229):**
- Remove `currency: 'SYP',`

**In `openEditOffer()` and `openCreateOffer()`:**
- Remove currency field handling

**In `handleSaveOffer()` (around line ~505):**
- Remove validation: `if (!offerEditor.draft.currency)`
- In `nextOffer` object: remove `currency` property

**In `handleOfferFlowSubmit()` (around line ~775):**
- In the `offers` mapping: remove `currency: offer.currency,`

**In the offer editor UI (around the draft form grid):**
- Remove the `<select>` for currency (the one with `CURRENCY_OPTIONS`)
- Remove currency from `formatOfferAmountDetails` calls and display

**In `CURRENCY_OPTIONS` constant:**
- Remove or leave unused (it will be cleaned up naturally)

**In `formatOfferAmountDetails()` (around line ~254):**
- Remove `currency` parameter usage — all amounts displayed without currency label
- Signature becomes: `function formatOfferAmountDetails(offer: DeviceOffer): string`
- Replace all `formatAmount(..., offer.currency)` with just `new Intl.NumberFormat('en-US').format(amount)` (no currency suffix)

### B2. Rename "totalAmount" label to "السعر الإفرادي"

**In `handleSaveOffer()` validation:**
- Change error text: `'يرجى إدخال المبلغ الكامل'` → `'يرجى إدخال السعر الإفرادي'`

**In the offer editor draft form UI (around the totalAmount input):**
- Change `<label>` text: `"المبلغ الكامل"` or `"قيمة العرض"` → `"السعر الإفرادي"`

**In the offer summary/receipt display:**
- Any label showing "المبلغ" or "القيمة" for the per-unit price → `"السعر الإفرادي"`

### B3. Use `/employees/closers` for closing employee dropdown

**Add state for closers:**
```tsx
const [closers, setClosers] = useState<Employee[]>([]);
```

**Fetch closers when modal opens:**
Inside the existing `useEffect` that runs when `isOpen` changes (around line ~329), add:
```tsx
api.employees.closers()
  .then(setClosers)
  .catch(() => setClosers([]));
```

**In the offer editor draft form (closedByEmployeeId select):**
- Replace `activeEmployees` with `closers`:
```tsx
<select value={offerEditor.draft.closedByEmployeeId} ...>
  <option value="">اختياري</option>
  {closers.map((employee) => (
    <option key={employee.id} value={employee.id}>{employee.name}</option>
  ))}
</select>
```

**In `getOfferCloserLabel()` (around line ~827):**
- Replace `activeEmployees.find(...)` with `closers.find(...)`

### B4. Use `system_lists` for no-closing reason

**Add state for no-closing reasons:**
```tsx
const [noClosingReasons, setNoClosingReasons] = useState<SystemList[]>([]);
```

**Fetch when modal opens:**
Inside the same `useEffect`, add:
```tsx
api.systemLists.getItemsByCode('no_closing_reasons')
  .then(setNoClosingReasons)
  .catch(() => setNoClosingReasons([]));
```

**In the offer editor draft form (noClosingReason select):**
Replace the current `<input>` or free-text with a `<select>`:
```tsx
<div className="space-y-2">
  <label className="text-sm font-bold text-slate-700">سبب عدم التسكير</label>
  <select
    value={offerEditor.draft.noClosingReason}
    onChange={(event) => updateDraftOfferField('noClosingReason', event.target.value)}
    disabled={!!offerEditor.draft.closedByEmployeeId}
    className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm ${
      offerEditor.draft.closedByEmployeeId ? 'opacity-50 cursor-not-allowed' : ''
    }`}
  >
    <option value="">بدون سبب</option>
    {noClosingReasons.map((reason) => (
      <option key={reason.id} value={reason.value}>{reason.value}</option>
    ))}
  </select>
</div>
```

**In `handleSaveOffer()` validation (around line ~565):**
Keep the same validation logic but ensure it works with the new dropdown:
```tsx
const selectedEmployeeId = parsePositiveInteger(offerEditor.draft.closedByEmployeeId);
if (selectedEmployeeId == null && !offerEditor.draft.noClosingReason.trim()) {
  setOfferEditorError('يرجى اختيار موظف أو إدخال سبب عدم التسكير');
  return;
}
```

### B5. In `nextOffer` object (handleSaveOffer)

When `selectedEmployeeId` is set, `noClosingReason` must be `null` (not empty string):
```tsx
noClosingReason: selectedEmployeeId == null ? offerEditor.draft.noClosingReason.trim() || null : null,
```
This is already present; verify it remains correct.

### B6. Remove currency from the wizard summary display

In any display/receipt/summary text inside the modal that shows currency (like `SYP` next to amounts), remove the currency label. Amounts are implicitly SYP.

---

## Acceptance Criteria

- [ ] Backend `loadVisitById` populates `visit.devices` from `open_task_devices` via `source_open_task_id`
- [ ] Wizard no longer shows "لا يوجد أجهزة محددة" when devices exist without pre-offers
- [ ] `currency` field removed from `OfferDraft`, `DeviceOffer`, validation, and UI
- [ ] Closing employee dropdown uses `/employees/closers` (not all active employees)
- [ ] No-closing reason uses `system_lists` category `no_closing_reasons` dropdown
- [ ] No-closing reason disabled when closing employee is selected
- [ ] "السعر الإفرادي" label used instead of "المبلغ الكامل" / "قيمة العرض"
- [ ] Amounts displayed without currency suffix (implicitly SYP)
- [ ] Build passes zero errors
- [ ] Staging restart succeeds

---

## Notes
- NEVER touch production.
- Do NOT change the outcome options (offer_presented, device_sold, needs_reschedule, cancelled) — they stay as-is.
- The existing `activeEmployees` prop can remain on the component for other uses; only the closing employee field switches to `closers`.
