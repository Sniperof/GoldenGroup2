# TASK 22: Full Review & Fix — Marketing Visit Outcome / Result Flow

## Branch
`staging`

## Context
We are getting cascading API errors when submitting visit outcomes. The most recent:
- `400: {"error":"price fields are not allowed for device_sold"}`

This is the third currency-related error after we removed the `currency` field from the frontend. Each fix has uncovered the next broken layer. A full review is needed.

## Files Involved
- `packages/api/routes/marketingVisits.ts` — outcome/result endpoints
- `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx` — new wizard
- `packages/web/src/components/marketing-visits/MarketingVisitResultModal.tsx` — legacy result modal
- `packages/shared/types.ts` — shared types

---

## Part A — Backend Review: `marketingVisits.ts`

### A1. Top-level `currency` default (around line 1326 and line 588)

**Problem:** `currency` was changed to default `'SYP'` instead of `null`. This breaks the `device_sold` validation which rejects any non-null `currency`.

**Fix:** Revert top-level `currency` to default `null`:
```typescript
const currency = typeof req.body?.currency === 'string' ? req.body.currency.trim() || null : null;
```

Then, inside the offer array validation loop (around line 1389), where individual offers are validated, add the default `'SYP'` only when an offer's `currency` is missing:
```typescript
const currentCurrency = typeof rawOffer.currency === 'string' && rawOffer.currency.trim()
  ? rawOffer.currency.trim()
  : 'SYP';
```

And for the legacy single-offer path (around line 1474), also default to 'SYP' only if needed:
```typescript
const effectiveCurrency = (currency || 'SYP');
```

### A2. `device_sold` validation (around line 1494)

**Current broken check:**
```js
if (cashOfferAmount != null || installmentAmount != null || installmentMonths != null || currency != null) {
  return res.status(400).json({ error: 'price fields are not allowed for device_sold' });
}
```

**Problem:** After A1 fix, `currency` will be null when not explicitly sent. But the check should only reject if `currency` was EXPLICITLY provided. After A1, `currency` being null is fine. No change needed here if A1 is fixed correctly.

**Also verify:** The `device_sold` flow in the wizard sends `currency: null` and no price fields. Make sure the backend accepts this.

### A3. Offer array `INSERT` — `currency` column (around line 1659)

Verify that `offer.currency` uses `currentCurrency` (which defaults to 'SYP') so DB records always have a currency value.

### A4. `marketing_visit_tasks` UPDATE — `currency` column (around line 1592)

Verify the task-level currency update uses the correct value. For `offer_presented` with offers array, use `primaryOffer?.currency ?? 'SYP'`. For legacy single-offer, use `effectiveCurrency`.

---

## Part B — Frontend Review: `MarketingVisitOutcomeModal.tsx` (Wizard)

### B1. Simple submit flow (`handleSimpleSubmit` around line 740)

Verify the payload sent for each outcome:

**`device_sold`:**
- Must NOT send `offerType`, `cashOfferAmount`, `installmentAmount`, `installmentMonths`, `currency`, `discountPercentage`
- Must send: `outcome: 'device_sold'`, `soldDeviceModelId`, `closedByEmployeeId` (optional?), `notes`
- Currently it sends `currency: null` which is correct. Verify no other price field leaks through.

**`needs_reschedule`:**
- Must send: `outcome: 'rescheduled'`, `rescheduleReasonId`, `followUpDueDate`, `notes`
- Must NOT send price fields.

**`cancelled`:**
- Must send: `outcome: 'cancelled'`, `cancellationReasonId`, `notes`
- Must NOT send price fields.

**`offer_presented`:**
- This goes through `handleOfferFlowSubmit` (around line 775), NOT `handleSimpleSubmit`. Verify the two paths don't accidentally mix.

### B2. Offer flow submit (`handleOfferFlowSubmit` around line 775)

Verify the `offers` array sent to backend. Each offer must include:
```typescript
{
  deviceModelId,
  offerType,
  quantity,
  totalAmount,
  firstPaymentAmount,
  installmentMonths,
  currency: 'SYP',  // hardcoded since we removed the UI field
  discountPercentage,
  appliedDeviceDiscountId,  // must be included if selected
  closedByEmployeeId,
  noClosingReason,
  customerResponse,
  rejectionReasonId,
  extensionReasonId,
  extensionDueDate,
  saleReferenceNumber,
}
```

**Critical:** `currency: 'SYP'` must be present on every offer object because the backend validates `offers[0].currency is required`.

### B3. `appliedDeviceDiscountId` in offer objects

Verify `appliedDeviceDiscountId` is:
1. Stored in `OfferDraft` interface
2. Set when user selects a discount from dropdown
3. Included in `nextOffer` object inside `handleSaveOffer`
4. Included in the `offers` array sent by `handleOfferFlowSubmit`
5. Cleared when device changes (to avoid stale discount IDs)

### B4. `totalAmount` auto-populate from `basePrice`

Verify:
- `openCreateOffer` pre-fills `totalAmount` with device `basePrice` (already done in Task 21)
- Device dropdown change in editor also updates `totalAmount` with new device's `basePrice`
- If `basePrice` is 0 or undefined, leave `totalAmount` empty (don't show "0")

---

## Part C — Frontend Review: `MarketingVisitResultModal.tsx` (Legacy)

This modal is still used in some flows. Verify:
1. It still sends `currency: 'SYP'` when submitting result (if it sends offers/price data)
2. It doesn't break due to shared types changes
3. If this modal is no longer used, verify it doesn't cause build errors

---

## Part D — Shared Types Review

### D1. `MarketingVisitTaskOfferInput`

Verify:
```typescript
interface MarketingVisitTaskOfferInput {
  deviceModelId: number;
  offerType: 'cash' | 'installment';
  quantity: number;
  totalAmount: number;
  firstPaymentAmount?: number | null;
  installmentMonths?: number | null;
  currency: string;  // should remain required since backend validates it
  discountPercentage?: number | null;
  appliedDeviceDiscountId?: number | null;  // verify this exists
  closedByEmployeeId?: number | null;
  noClosingReason?: string | null;
  customerResponse: 'accepted' | 'rejected' | 'extension_requested' | null;
  rejectionReasonId?: number | null;
  extensionReasonId?: number | null;
  extensionDueDate?: string | null;
  saleReferenceNumber?: string | null;
}
```

`currency` must remain `string` (not optional) because the backend validates it on every offer.

---

## Acceptance Criteria

- [ ] `device_sold` outcome submits successfully without 400 error
- [ ] `offer_presented` with offers array submits successfully
- [ ] `needs_reschedule` submits successfully
- [ ] `cancelled` submits successfully
- [ ] Each offer in the offers array includes `currency: 'SYP'`
- [ ] `appliedDeviceDiscountId` flows correctly from frontend to DB when a dropdown discount is selected
- [ ] Top-level `currency` in backend defaults to `null` (not `'SYP'`) so `device_sold` validation works
- [ ] Individual offer `currency` defaults to `'SYP'` within offer validation
- [ ] Build passes zero errors
- [ ] Staging restart succeeds

---

## Notes
- NEVER touch production.
- Do NOT remove `currency` from `MarketingVisitTaskOfferInput` shared type — backend requires it.
- Do NOT remove `currency` from the offers array sent to backend.
- The currency field should only be removed from the UI, not from the API contract.
