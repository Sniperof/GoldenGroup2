# TASK 19 FIX: Disable "no closing reason" when closing employee is selected

## File
`packages/web/src/components/clients/DeviceOfferModal.tsx`

## Change
In the pre-offers draft form, the **"سبب عدم التسكير"** (no closing reason) dropdown must be **disabled** when a closing employee is already selected.

## Exact location
Around line ~746, find the `<select>` for `noClosingReason` inside the pre-offers draft grid:

```tsx
<select
  value={draftOffer.noClosingReason}
  onChange={(event) => updateDraftOffer('noClosingReason', event.target.value)}
  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
>
```

Add: `disabled={!!draftOffer.closedByEmployeeId}`

Also add a visual cue: when disabled, the field should show placeholder text "—" (or empty string) and have `opacity-50` class to indicate it's inactive.

## Also apply same rule for the table rows
Each pre-offer row in the table (around the rendered `<tr>` loop) should display "—" for the no-closing-reason cell when `closedByEmployeeId` is present, instead of showing the label.

## Build
After change: `pnpm --filter @golden-crm/web build` — must be zero errors.
