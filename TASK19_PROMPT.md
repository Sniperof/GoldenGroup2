# TASK 19: Restructure DeviceOfferModal — Separate Device Selection from Pre-Offers

## Branch
`staging`

## Goal
Restructure the `DeviceOfferModal` so that device selection is a mandatory top section completely separate from the optional pre-offers section. Each pre-offer must reference a device from the selected-devices list. Remove the currency field. Rename "total amount" to "unit price". Use a device-specific discount dropdown (like ContractForm does). Add a "closing employee" dropdown filtered by `sales.can_close` permission, and a "no closing reason" dropdown from system_lists. Each pre-offer must have either a closing employee OR a no-closing reason.

## Files to modify
- `packages/web/src/components/clients/DeviceOfferModal.tsx`
- `packages/api/routes/openTasks.ts` (create endpoint — store `applied_device_discount_id`)
- `packages/api/routes/employees.ts` (add closers filter)
- `migrations/092_open_task_pre_offers.sql` (add `applied_device_discount_id`)
- `migrations/___seed_no_closing_reasons.sql` (new seed migration)
- `packages/shared/types.ts` (add `appliedDeviceDiscountId` to PreOffer types if missing)

---

## Part A — Frontend: DeviceOfferModal.tsx

### 1. Top Section: "الأجهزة المراد عرضها" (Selected Devices) — MANDATORY

Add a new top section above the pre-offers section:

- **Device dropdown**: list from `api.deviceModels.list()`
- **Quantity input**: number, min 1, default 1
- **"إضافة للقائمة"** button
- **Selected devices table**: columns = # | Device name | Quantity | Actions (delete)
- Selected devices are stored in local state `selectedDevices: Array<{deviceModelId: number, quantity: number, deviceName: string}>`
- Validation: user cannot submit the form if `selectedDevices.length === 0`. Show error: "يجب اختيار جهاز واحد على الأقل"
- These map to `devices` payload on submit: `Array<{deviceModelId, quantity}>`
- The old hardcoded `normalizedDevices` (always quantity=1) must be replaced by this selection.

### 2. Bottom Section: "العروض المسبقة" (Pre-Offers) — OPTIONAL

The existing pre-offers section is kept but heavily modified:

#### PreOfferDraft changes
```ts
type PreOfferDraft = {
  deviceModelId: string;           // MUST be from selectedDevices only
  offerType: '' | 'cash' | 'installment';
  quantity: string;
  unitPrice: string;               // RENAMED from totalAmount
  firstPaymentAmount: string;
  installmentMonths: string;
  // currency REMOVED — implicitly SYP everywhere
  discountPercentage: string;
  appliedDeviceDiscountId: string; // FK to device_discounts
  closedByEmployeeId: string;      // FK to employee with sales.can_close
  noClosingReason: string;         // from system_lists category 'no_closing_reasons'
};
```

#### Device field in draft
- The device dropdown for a pre-offer MUST only show devices that are already in `selectedDevices`
- If no devices are selected yet, show placeholder text: "اختر جهازاً من القائمة أولاً"
- When a device is selected in the draft:
  - Auto-populate `unitPrice` with `device_models.base_price` of that device (fetch from `deviceModels` state)
  - Clear `discountPercentage` and `appliedDeviceDiscountId`
  - Load `deviceDiscounts` for that device via `api.deviceModels.getDiscounts(deviceId)`

#### Currency removal
- Remove the currency text input completely from UI and from ReceiptModal HTML
- All displayed amounts are implicitly SYP. Do NOT show "SYP" label next to every amount.
- In the `normalizedOffers` payload, still send `currency: 'SYP'` for backward compatibility.

#### Rename "totalAmount" → "unitPrice"
- In UI labels: "سعر الوحدة" becomes "السعر الإفرادي"
- In calculations (receipt, table, summary): this is the per-unit price, NOT total
- Total line-item amount = unitPrice × quantity (shown in table/receipt for info only)

#### Discount dropdown (like ContractForm)
- If `deviceDiscounts.length > 0` for the selected device:
  - Show a `<select>` dropdown: options = device discounts for that device
  - Label format: `{label} ({percentage}%)`
  - On select: auto-fill `discountPercentage` from the discount row
  - Also store `appliedDeviceDiscountId` as the FK
  - Show validity note: "صالح حتى {endDate}"
- If no device discounts: show manual percentage input (free text, 0-100)

#### Closing employee dropdown
- Call a new endpoint `GET /employees/closers` (or add query param `?canClose=true` to existing list)
- Dropdown label: "موظف التسكير"
- Options = employees returned from that endpoint
- First option = "اختياري" with value=""

#### No closing reason dropdown
- Call `api.systemLists.getItemsByCode('no_closing_reasons')`
- Dropdown label: "سبب عدم التسكير"
- First option = "بدون سبب" with value=""

#### Validation per pre-offer
Each pre-offer in the table must pass this before being added:
```
IF closedByEmployeeId is empty AND noClosingReason is empty:
  ERROR = "كل عرض يجب أن يحتوي إما على موظف تسكير أو سبب عدم التسكير"
```

### 3. ReceiptModal changes
- Remove currency display everywhere
- Rename "سعر الوحدة" → "السعر الإفرادي"
- Keep total calculation = unitPrice × quantity (for display only)
- Remove the `currency` parameter from `buildReceiptHtml`

### 4. Submit payload changes

The `api.openTasks.create` payload stays structurally similar but sourced from the new sections:

```ts
{
  clientId: client.id,
  branchId: client.branchId,
  dueDate,
  reason,
  priority: priority || null,
  notes: notes.trim() || null,
  devices: selectedDevices.map(d => ({
    deviceModelId: d.deviceModelId,
    quantity: d.quantity,
  })),
  preOffers: preOffers.map(o => ({
    deviceModelId: Number(o.deviceModelId),
    offerType: o.offerType,
    quantity: parsePositiveInteger(o.quantity) ?? 1,
    totalAmount: parsePositiveNumber(o.unitPrice) ?? 0,   // BACKEND field name stays totalAmount
    firstPaymentAmount: o.firstPaymentAmount ? parsePositiveNumber(o.firstPaymentAmount) : null,
    installmentMonths: o.installmentMonths ? parsePositiveInteger(o.installmentMonths) : null,
    currency: 'SYP',                                       // hardcoded, hidden
    discountPercentage: o.discountPercentage ? Number(o.discountPercentage) : null,
    appliedDeviceDiscountId: o.appliedDeviceDiscountId ? Number(o.appliedDeviceDiscountId) : null,
    closedByEmployeeId: o.closedByEmployeeId ? Number(o.closedByEmployeeId) : null,
    noClosingReason: o.noClosingReason.trim() || null,
  })),
}
```

### 5. Build verification
After changes, run:
```bash
pnpm --filter @golden-crm/web build
```
Must be zero errors.

---

## Part B — Backend: openTasks.ts

### Store `applied_device_discount_id`

In the `POST /open-tasks` create handler (around line 442), the INSERT into `open_task_pre_offers` currently does NOT include `applied_device_discount_id`. Add it:

```sql
INSERT INTO open_task_pre_offers (
   open_task_id, device_model_id, offer_type, quantity, total_amount,
   first_payment_amount, installment_months, currency,
   discount_percentage, applied_device_discount_id, closed_by_employee_id, no_closing_reason
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
```

Bind values accordingly from the payload.

In the SELECT query that returns preOffers (around line 520), add:
```sql
'appliedDeviceDiscountId', otpo.applied_device_discount_id
```

In the `GET /:id` detail query (around line 898), add to the SELECT:
```sql
otpo.applied_device_discount_id AS "appliedDeviceDiscountId"
```

---

## Part C — Backend: employees.ts

Add a new endpoint:

```
GET /employees/closers
```

Logic:
1. Check the current user's branch context (`getBranchId`)
2. Query `hr_users` joined with `roles` joined with `role_permissions` joined with `permissions`
3. Filter: `permissions.code = 'sales.can_close'` AND `role_permissions.scope IN ('GLOBAL', 'BRANCH')`
4. If user is non-global, also filter by branch (employee branch or permission scope GLOBAL)
5. Return: `[{id, name, roleDisplayName}]`

If the permission `sales.can_close` does not exist yet, the endpoint should gracefully return an empty array (do not crash).

---

## Part D — Database Migration

### D1. Alter `open_task_pre_offers`

New migration file (e.g., `134_pre_offer_applied_discount.sql`):

```sql
-- Add applied_device_discount_id to open_task_pre_offers
ALTER TABLE open_task_pre_offers
  ADD COLUMN IF NOT EXISTS applied_device_discount_id INTEGER REFERENCES device_discounts(id) ON DELETE SET NULL;
```

### D2. Seed no_closing_reasons system list

New migration (e.g., `135_seed_no_closing_reasons.sql`):

```sql
INSERT INTO system_lists (category, value, is_active, display_order)
VALUES
  ('no_closing_reasons', 'لم يتم التسكير', true, 1),
  ('no_closing_reasons', 'متابعة لاحقة', true, 2),
  ('no_closing_reasons', 'العميل مشغول', true, 3),
  ('no_closing_reasons', 'سبب سعري', true, 4),
  ('no_closing_reasons', 'أخرى', true, 5)
ON CONFLICT (category, value) DO NOTHING;
```

If your schema has a unique constraint on `(category, value)` use `ON CONFLICT`. Otherwise just plain INSERT wrapped in a check.

### D3. Seed `sales.can_close` permission

New migration (e.g., `136_seed_sales_can_close.sql`):

```sql
INSERT INTO permissions (code, description, category)
VALUES ('sales.can_close', 'القدرة على تسكير العروض والمبيعات', 'sales')
ON CONFLICT (code) DO NOTHING;
```

(Use `ON CONFLICT` only if `permissions.code` is unique; otherwise skip or wrap in EXISTS check.)

---

## Part E — Shared types.ts

Ensure `MarketingVisitTaskOfferInput` and any PreOffer-related types include `appliedDeviceDiscountId` if not already present. Check line ~541 area. If missing, add:

```ts
appliedDeviceDiscountId?: number | null;
```

---

## Acceptance Criteria

- [ ] `DeviceOfferModal` shows a mandatory "الأجهزة المراد عرضها" section at top
- [ ] User cannot create a task without selecting at least one device
- [ ] Pre-offer device dropdown only shows devices from the top section
- [ ] Currency field is removed from UI entirely
- [ ] "سعر الوحدة" renamed to "السعر الإفرادي" everywhere
- [ ] Discount uses dropdown from `device_discounts` per device (like ContractForm)
- [ ] Closing employee dropdown uses `/employees/closers` endpoint
- [ ] No closing reason uses `system_lists` category `no_closing_reasons`
- [ ] Each pre-offer validates: must have closing employee OR no closing reason
- [ ] `applied_device_discount_id` is stored in DB on create
- [ ] Backend returns `appliedDeviceDiscountId` in detail/fetch responses
- [ ] Build passes zero errors
- [ ] PM2 staging restart succeeds

---

## Notes
- NEVER touch production. Work only in staging (`/opt/golden-crm/apps/staging`).
- Do NOT run `pm2 restart golden-crm` (production). Use `pm2 restart golden-crm-staging`.
- Keep all existing functionality (receipt modal, receipt HTML generation, print/share/download) working.
- The `totalAmount` backend field name is kept for API compatibility, but the UI label is "السعر الإفرادي" (unit price).
