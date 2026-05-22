# TASK 21: Fix 3 remaining issues in MarketingVisitOutcomeModal

## Branch
`staging`

## File
`packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx`

## Issues

### Issue 1: "تم الإغلاق مع" in device_sold flow uses all employees, not closers

**Location:** Around line 914 (simple submit UI for outcome = 'device_sold').

**Problem:** The `<select>` for `closedByEmployeeId` in the simple submit flow uses `activeEmployees` (all active employees). It must use `closers` (employees with `sales.can_close` permission).

**Fix:** Replace `activeEmployees.map(...)` with `closers.map(...)` in the `closedByEmployeeId` `<select>` around line 914.

Also around line 736 (`handleSimpleSubmit`): `closedByEmployeeId` is already taken from state; just ensure the state is populated from the correct dropdown.

---

### Issue 2: Discount in offer editor is plain text input, not device-specific dropdown

**Location:** Around lines 1565 and 1655 (offer editor draft form grid).

**Problem:** The `discountPercentage` field is a plain `<input type="number">`. It must work like `DeviceOfferModal`: when a device is selected, load `device_discounts` for that device and show a dropdown. If no discounts exist, fall back to manual percentage input.

**Fix:**

1. Add state for device discounts:
```tsx
const [deviceDiscounts, setDeviceDiscounts] = useState<Array<{id: number; label: string; percentage: number}>>([]);
```

2. When `offerEditor.deviceModelId` changes, fetch discounts:
```tsx
useEffect(() => {
  if (!offerEditor) return;
  setDeviceDiscounts([]);
  if (!offerEditor.deviceModelId) return;
  api.deviceModels.getDiscounts(offerEditor.deviceModelId)
    .then((discounts) => setDeviceDiscounts(discounts.map(d => ({ id: d.id, label: d.label, percentage: d.percentage }))))
    .catch(() => setDeviceDiscounts([]));
}, [offerEditor?.deviceModelId]);
```

3. In the offer editor draft form, replace the plain `discountPercentage` `<input>` with conditional logic:
- If `deviceDiscounts.length > 0`: show a `<select>` with options from `deviceDiscounts`, label format = `{label} ({percentage}%)`, first option = "بدون حسم". On select: set `discountPercentage` from the chosen discount AND store `appliedDeviceDiscountId` somewhere (add it to `OfferDraft` if needed, or just store the ID in a separate state).
- If `deviceDiscounts.length === 0`: show the existing manual `<input type="number">` for percentage.

4. On save (`handleSaveOffer`), include `appliedDeviceDiscountId` in the `nextOffer` object if a discount was selected from the dropdown. This field must be sent in the `offers` mapping inside `handleOfferFlowSubmit`.

**Note:** `appliedDeviceDiscountId` is already in `MarketingVisitTaskOfferInput` (shared types) and the backend already stores it. Just ensure it flows from the wizard to the backend.

---

### Issue 3: "السعر الإفرادي" not auto-populated from device basePrice

**Location:** Around lines 1465-1470 (offer editor deviceModelId change).

**Problem:** When the user opens the offer editor and a device is already selected (or when they change the device dropdown), `totalAmount` remains empty (`''`). It should auto-populate with `device_models.basePrice` for the selected device.

**Fix:**

In the `setOfferEditor` call that handles `deviceModelId` change (around the device dropdown `onChange`), after setting the new `deviceModelId`, look up the device model and auto-fill `totalAmount`:

```tsx
onChange={(event) => {
  const newDeviceModelId = Number(event.target.value);
  const model = deviceModels.find((m) => m.id === newDeviceModelId);
  setOfferEditor((current) => {
    if (!current) return current;
    const basePrice = model?.basePrice ?? 0;
    return {
      ...current,
      deviceModelId: newDeviceModelId,
      draft: {
        ...current.draft,
        totalAmount: basePrice > 0 ? String(basePrice) : current.draft.totalAmount,
      },
    };
  });
}}
```

Also in `openCreateOffer` (around line 471): when opening the editor for a specific device, auto-fill `totalAmount` with that device's `basePrice`:

```tsx
const openCreateOffer = (deviceModelId: number) => {
  const model = deviceModels.find((m) => m.id === deviceModelId);
  const basePrice = model?.basePrice ?? 0;
  setOfferEditor({
    deviceModelId,
    offerId: null,
    draft: {
      ...createEmptyDraft(),
      totalAmount: basePrice > 0 ? String(basePrice) : '',
    },
  });
  setOfferEditorError('');
};
```

Similarly in `openEditOffer`: when editing an offer that has `totalAmount === 0`, optionally pre-fill from basePrice if the offer's totalAmount is 0. But keep the existing totalAmount if it has a real value.

---

## Acceptance Criteria

- [ ] "تم الإغلاق مع" dropdown in `device_sold` flow uses `closers` (not `activeEmployees`)
- [ ] Offer editor discount uses `device_discounts` dropdown when discounts exist for the selected device
- [ ] Offer editor discount falls back to manual percentage input when no device discounts exist
- [ ] `appliedDeviceDiscountId` is sent to backend when a dropdown discount is selected
- [ ] "السعر الإفرادي" auto-populates with `device_models.basePrice` when device is selected in offer editor
- [ ] User can still manually edit the auto-populated price
- [ ] Build passes zero errors
- [ ] Staging restart succeeds

---

## Notes
- NEVER touch production.
- The `activeEmployees` prop should stay on the component; only the `closedByEmployeeId` field in the simple submit flow switches to `closers`.
- If `basePrice` is 0 or undefined, leave `totalAmount` empty so the user must enter it.
