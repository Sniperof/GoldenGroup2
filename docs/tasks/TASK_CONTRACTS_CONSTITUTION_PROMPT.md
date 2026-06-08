# Prompt: Domain Constitution for Contracts (العقود)

## Objective

Build the **complete, authoritative Domain Constitution** for the `contracts` entity and its related sub-entities in Golden CRM. Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, policies, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/contracts.md` — The full Contracts constitution (includes contract_line_items, payment_entries, installments, dues)
2. Update `docs/constitution/INDEX.md` — Add contracts row + update status
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add contracts fields, relationships, tables
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-012, GAP-013, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
Read EVERY migration file that touches contracts or related tables:

```
migrations/001_core_tables.sql              (CREATE TABLE contracts, contract_line_items, dues, device_models, spare_parts)
migrations/014_branch_id_domain_tables.sql  (contracts.branch_id)
migrations/101_contracts_installation_address.sql
migrations/115_contracts_sale_type.sql
migrations/126_contract_enhancements.sql
migrations/127_contract_payments.sql         (contract_payment_entries, contract_installments)
migrations/130_applied_device_discount_id.sql
migrations/132_contract_legal_snapshot.sql
migrations/133_contract_buyer_birth_gender.sql
migrations/138_task_offer_contract_link.sql
migrations/139_contract_type_and_sale_source.sql
migrations/140_contract_no_closing_reason.sql
migrations/141_contract_sale_subtype.sql
migrations/142_contract_device_tracking.sql  (device_status, is_installed on line_items)
migrations/155_visit_tasks_contract_id.sql
migrations/156_purchase_history_fields.sql
migrations/167_snapshot_backfill.sql
```

Also read these for related tables:
- `migrations/106_task_type_config.sql` (task_type_config for delivery/installation tasks)
- `migrations/113_task_type_config_location_basis.sql`

For each, extract:
- Columns added/modified on contracts, contract_line_items, contract_payment_entries, contract_installments, dues
- Constraints (CHECK, FK, UNIQUE, NOT NULL, DEFAULT)
- Indexes created

### B. API Layer
```
packages/api/routes/contracts.ts          (ALL endpoints — 9 endpoints)
packages/api/routes/dues.ts               (dues endpoints — GET /, PUT /:id)
packages/api/routes/deviceModels.ts       (device models + discounts)
packages/api/routes/spareParts.ts         (spare parts)
packages/api/policies/contractPolicy.ts   (if exists — check!)
packages/api/services/customerOwnership.ts (if touches contracts)
```

### C. Shared Types
```
packages/shared/types.ts                (any Contract-related interfaces)
packages/shared/types/authorization.ts  (scope enums)
```

### D. System Configuration
```
migrations/026_contracts_tasks_permissions_seeding.sql
migrations/027_contracts_tasks_departments_permissions_seeding.sql
migrations/054_permissions_allowed_scopes.sql
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/contracts.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: العقد
- **الاسم الإنجليزي**: Contract
- **اسم الجدول**: `contracts`
- **الوصف**: سجل بيع/تركيب جهاز تنقية مياه. يمثل الاتفاق التجاري بين الشركة والزبون. كل عقد = جهاز واحد + قطع + خدمات.
- **الجداول المرتبطة**: clients (customer_id), device_models, contract_line_items, contract_payment_entries, contract_installments, dues, open_tasks (delivery/installation), field_visits, emergency_tickets
- **الأهمية**: Core business entity — بدون عقد ما فيه مبيعات.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

Build the **complete field dictionary** for ALL of these tables:

#### 2.1 `contracts` — الجدول الرئيسي

Document every field. Critical fields to highlight:
- `contract_number` — UNIQUE? Format?
- `customer_id` → FK to clients.id, ON DELETE SET NULL
- `customer_name` — snapshot (denormalized) — why?
- `device_model_id` / `device_model_name` — FK + denormalized snapshot
- `serial_number` — جهاز فريد؟
- `maintenance_plan` — VARCHAR(10) — what values?
- `base_price`, `final_price` — difference? How is final_price calculated?
- `payment_type` — DEFAULT 'cash' — what other values? (check migration 127)
- `down_payment`, `installments_count`
- `delivery_date`, `installation_date` — VARCHAR(50) — date format?
- `status` — CHECK ('draft', 'active', 'completed', 'cancelled')
- `branch_id` — ⭐ CRITICAL: can DIFFER from clients.branch_id (GAP-006)
- `sale_type` — added in migration 115 — what values?
- `sale_source` — added in migration 139 — what values?
- `sale_subtype` — added in migration 141 — what values?
- `contract_type` — added in migration 139 — what values?
- `discount_id` / `applied_device_discount_id` — device discount logic
- `closing_employee_id` — who closed the sale?
- `no_closing_reason_id` — why wasn't it closed?
- `installation_geo_unit_id`, `installation_address_text`, `installation_lat`, `installation_lng` — location of device
- `buyer_mother_name`, `buyer_national_id_registry`, `buyer_national_id_issued_by`, `buyer_national_id_issue_date`, `buyer_national_id_box` — legal fields (snapshot)
- `buyer_birth_date`, `buyer_gender` — added in migration 133
- `source_visit`, `source_open_task_id`, `source_task_offer_id` — where did this contract originate?
- `device_status` — added in 142 — CHECK ('pending_delivery', 'delivered', 'installed', 'active')
- `invoice_notes` — free text
- `created_at`

#### 2.2 `contract_line_items` — بنود العقد

- `contract_id` → FK
- `item_type` — what values? ('device', 'part', 'accessory', 'service'?)
- `item_id` — references device_model or spare_part?
- `quantity`, `unit_price`, `total_price`
- `is_installed` — BOOLEAN, added in 142

#### 2.3 `contract_payment_entries` — دفعات العقد

- `contract_id` → FK
- `amount`, `payment_date`, `payment_method`
- `notes`

#### 2.4 `contract_installments` — أقساط العقد

- `contract_id` → FK
- `installment_number`, `amount`, `due_date`
- `status` — what values? ('Pending', 'Confirmed'?)
- `confirmed_at`

#### 2.5 `dues` — المستحقات

- `contract_id` → FK, ON DELETE CASCADE
- `type` — what values?
- `scheduled_date`, `adjusted_date`
- `original_amount`, `remaining_balance`
- `status` — CHECK ('Pending', 'Partial', 'Paid', 'Overdue')
- `escalated` — BOOLEAN

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

Document at minimum:

#### BR-1: Device Lifecycle (أبرز قاعدة)
```
contracts.device_status:
  'pending_delivery' → (delivery task created) → 'delivered' → (installation task) → 'installed' → 'active'
```
What triggers each transition? Which tasks are auto-created? What happens if cancelled?

#### BR-2: Price Calculation
```
base_price = sum of line items
final_price = base_price - discount + (installments interest?) 
```
How is final_price calculated? Is it editable after creation?

#### BR-3: Payment Types (من migration 127)
```
'cash', 'installments', 'mixed' — what does each mean?
```
- Cash: down_payment = final_price, installments_count = 0
- Installments: down_payment < final_price, installments_count > 0
- Mixed: ?

#### BR-4: Branch Independence (GAP-006 related)
```
contracts.branch_id CAN differ from clients.branch_id
```
The contract "belongs" to the branch that created it, NOT the client's registration branch.
Document this explicitly and its implications for:
- List visibility (contracts.view_list filters by contracts.branch_id)
- Reporting (a client's contracts may appear in multiple branches)
- Cross-branch lookup requirement

#### BR-5: Contract Creation Auto-Tasks
When a contract is created, what auto-tasks are generated?
```
- Device delivery task (open_tasks with task_type = 'device_delivery')
- Device installation task (open_tasks with task_type = 'device_installation')
```
Check contracts.ts line 478 — the INSERT into open_tasks.

#### BR-6: Soft-Delete? Hard-Delete?
Does contracts support soft-delete? Check the DELETE endpoint — is it hard DELETE or soft?
What about FK constraints from dues, line_items, payment_entries?

#### BR-7: Installment Confirmation
```
POST /api/contracts/:id/installments/confirm
```
What does this do? Can installments be modified after confirmation?

#### BR-8: Line Item Installation Tracking
```
PUT /api/contracts/:id/line-items/:itemId/installation
```
Updates `is_installed` on contract_line_items. When is this called? By which task type?

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:
```
contracts ||--o{ contract_line_items : "contains"
contracts ||--o{ contract_payment_entries : "paid via"
contracts ||--o{ contract_installments : "financed by"
contracts ||--o{ dues : "generates"
contracts }o--|| clients : "for customer"
contracts }o--|| device_models : "device model"
contracts ||--o{ open_tasks : "auto-creates"
contracts ||--o{ field_visits : "via tasks"
contracts ||--o{ emergency_tickets : "emergencies"
contracts }o--|| branches : "belongs to"
```

Also document: contract_line_items → device_models / spare_parts (via item_id + item_type)

---

### Section 5: آلة الحالات (State Machine)

Document the FULL contract lifecycle:

#### 5.1 Contract Status
```
[draft] → (create/submit) → [active] → (all tasks complete + payments) → [completed]
   │                                                    │
   └── (cancel) → [cancelled]                          └── (cancel) → [cancelled]
```

#### 5.2 Device Status (sub-state machine)
```
[pending_delivery] → (delivery task completed) → [delivered]
   │
   └── (installation task completed) → [installed] → (activation/confirmation) → [active]
```

#### 5.3 Installment Status
```
[unconfirmed] → POST /installments/confirm → [confirmed]
   │
   └── individual installments: [Pending] → payment → [Paid]
```

#### 5.4 Due Status
```
[Pending] → partial payment → [Partial] → full payment → [Paid]
   │                                    │
   └── overdue date passed → [Overdue] → payment → [Paid]
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض قائمة العقود | `contracts.view_list` | GLOBAL, BRANCH | ⭐ Does it support ASSIGNED? Check! |
| عرض تفاصيل عقد | `contracts.view_list` | GLOBAL, BRANCH | (same permission used for GET /:id) |
| إنشاء عقد | `contracts.create` | GLOBAL, BRANCH | |
| تعديل عقد | `contracts.edit` | GLOBAL, BRANCH | |
| حذف عقد | `contracts.delete` | GLOBAL, BRANCH | |

**CRITICAL NOTE:** Check if `contracts.*` supports ASSIGNED scope in the DB (allowed_scopes migration). If NOT, document as a gap similar to GAP-002.

Also check: does contracts permission use `X-Branch-Id` header? Looking at contracts.ts, the GET / uses `authContext.actingBranchId` or header `x-branch-id`.

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/contracts` | `contracts.view_list` | قائمة مع pagination + filters |
| GET | `/api/contracts/:id` | `contracts.view_list` | تفاصيل عقد (rich: with line items, payments, installments, dues, client snapshot) |
| POST | `/api/contracts` | `contracts.create` | إنشاء عقد + auto-tasks |
| PUT | `/api/contracts/:id` | `contracts.edit` | تعديل |
| POST | `/api/contracts/:id/payment-entries` | `contracts.edit` | إضافة/تعديل دفعات |
| POST | `/api/contracts/:id/installments` | `contracts.edit` | إضافة/تعديل أقساط |
| POST | `/api/contracts/:id/installments/confirm` | `contracts.edit` | تأكيد الأقساط |
| DELETE | `/api/contracts/:id` | `contracts.delete` | حذف |
| PUT | `/api/contracts/:id/line-items/:itemId/installation` | `contracts.edit` | تحديث حالة التركيب |

Query parameters for GET /:
- `branchId` — filter by branch
- `customerId` — filter by customer
- `status` — draft/active/completed/cancelled
- `search` — text search on customer_name or contract_number
- `page`, `limit`

Request body for POST / (document the FULL payload):
```json
{
  "contractNumber": "C-2026-001",
  "customerId": 1024,
  "customerName": "أحمد محمد علي",
  "contractDate": "2026-05-20",
  "deviceModelId": 5,
  "deviceModelName": "فلتر 5 مراحل",
  "serialNumber": "SN123456",
  "maintenancePlan": "annual",
  "basePrice": 150000,
  "finalPrice": 135000,
  "paymentType": "installments",
  "downPayment": 35000,
  "installmentsCount": 12,
  "deliveryDate": "2026-05-25",
  "installationDate": "2026-05-28",
  "branchId": 3,
  "saleType": "direct",
  "saleSource": "telemarketing",
  "saleSubtype": "campaign_2026",
  "contractType": "first_purchase",
  "discountId": null,
  "appliedDeviceDiscountId": 7,
  "closingEmployeeId": 12,
  "invoiceNotes": "عميل VIP — توصيل مجاني",
  "buyerMotherName": "فاطمة",
  "buyerNationalIdRegistry": "دمشق",
  "buyerNationalIdIssuedBy": "الميدان",
  "buyerNationalIdIssueDate": "2015-06-20",
  "buyerNationalIdBox": "542",
  "buyerBirthDate": "1990-05-15",
  "buyerGender": "Male",
  "geoSelection": {
    "neighborhoodId": 123,
    "addressText": "المزة، بناية 5",
    "mapPosition": [33.5138, 36.2765]
  },
  "lineItems": [
    { "itemType": "device", "itemId": 5, "quantity": 1, "unitPrice": 150000 },
    { "itemType": "part", "itemId": 12, "quantity": 2, "unitPrice": 5000 }
  ],
  "paymentEntries": [
    { "amount": 35000, "paymentDate": "2026-05-20", "paymentMethod": "cash", "notes": "دفعة أولى" }
  ],
  "installments": [
    { "installmentNumber": 1, "amount": 8333, "dueDate": "2026-06-20" }
  ]
}
```

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

Include at minimum:

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | إنشاء عقد صحيح | POST / | كامل + line items | 200 + contract with auto-tasks |
| TC-02 | إنشاء عقد بدون customerId | POST / | بدون customerId | 400 |
| TC-03 | عقد بفرع مختلف عن الزبون | POST / | branchId ≠ client.branchId | 200 ✅ (allowed!) |
| TC-04 | عرض عقد من فرع آخر | GET /:id | user من فرع 2، عقد بفرع 3 | 403 (if no GLOBAL) |
| TC-05 | إضافة دفعة تتجاوز المبلغ | POST /:id/payment-entries | sum > finalPrice | 400 أو warning |
| TC-06 | تأكيد أقساط بدون أقساط | POST /:id/installments/confirm | no installments | 400 |
| TC-07 | تعديل عقد مكتمل | PUT /:id | status='completed' | 400 (locked?) |
| TC-08 | حذف عقد مع dues | DELETE /:id | contract has dues rows | CASCADE أو block? |
| TC-09 | تتبع device_status | — | delivery task completed | device_status='delivered' |
| TC-10 | line-item installation | PUT /:id/line-items/5/installation | is_installed=true | 200 + updated |
| TC-11 | بحث عبر الفروع | GET /?crossBranch=true | (if implemented) | يعيد عقود كل الفروع |
| TC-12 | تطبيق خصم على جهاز | POST / | appliedDeviceDiscountId=7 | finalPrice recalculated |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Look for and document:

1. **contracts.branch_id vs clients.branch_id** — Already documented as GAP-006. Check if contracts.ts explicitly allows cross-branch or if it happens "accidentally".
2. **device_status CHECK values** — Migration 142 defines CHECK ('pending_delivery', 'delivered', 'installed', 'active'). Is this enforced? Is there a 'cancelled' state for devices?
3. **payment_type values** — What values are valid? Is there a CHECK constraint? What does 'mixed' mean?
4. **sale_type, sale_source, sale_subtype** — What are the valid values? Any CHECK constraints? Or free text?
5. **contract_type values** — What values? ('first_purchase', 'renewal', 'upgrade'?)
6. **No GET /:id for dues** — dues.ts only has GET / (list) and PUT /:id. How does frontend show due details?
7. **contract_number UNIQUE** — Is it truly unique? What format? Auto-generated or manual?
8. **Final price vs sum of payments** — Is there validation that total payments = final_price?
9. **Soft-delete missing** — contracts has no deleted_at. Is hard-delete safe given FKs to line_items, payment_entries, installments, dues?
10. **ASSIGNED scope for contracts** — Check allowed_scopes migration. Is it blocked like clients/candidates?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document every migration that touched contracts, line_items, payment_entries, installments, dues.

---

## Step 3: Update Supporting Files

### INDEX.md
Update row:
```
| العقود (Contracts) | [domains/contracts.md](domains/contracts.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add to relevant sections:
- `contracts` to branch_id table
- `contracts` to status table
- `contract_line_items`, `contract_payment_entries`, `contract_installments`, `dues` to Table Inventory
- Relationships: contracts → line_items, payment_entries, installments, dues, open_tasks
- `device_status` states
- `payment_type` values

### GAPS-TRACKER.md
If new gaps found (GAP-012, GAP-013...), add them following the exact same format.

---

## Verification Checklist

- [ ] `contracts.md` contains all 10 sections
- [ ] `contracts` table: 30+ fields documented
- [ ] `contract_line_items` table documented
- [ ] `contract_payment_entries` table documented
- [ ] `contract_installments` table documented
- [ ] `dues` table documented
- [ ] CHECK constraints documented: status, device_status, due_status
- [ ] Auto-task creation (delivery + installation) documented
- [ ] Branch independence documented (contracts.branch_id vs clients.branch_id)
- [ ] Device lifecycle state machine documented
- [ ] At least 12 test cases
- [ ] At least 5 gaps identified
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete contracts domain constitution`

---

## Notes for the Executor

1. **contracts is the MOST COMPLEX entity so far.** It touches 5+ sub-tables. Read every migration carefully.
2. **Do NOT invent field values.** If you can't find valid values for sale_type, sale_source, etc., note "Values not documented in migrations — needs clarification" in Section 9.
3. **The contract creation endpoint is HUGE.** Read it line by line — it creates the contract, line items, payment entries, installments, dues, AND auto-tasks.
4. **Check for soft-delete.** If contracts has no deleted_at, but DELETE endpoint exists, document as gap.
5. **Branch independence is CRITICAL.** contracts.branch_id can differ from clients.branch_id. This is intentional but under-documented.
6. **Use exact SQL types** from migrations.
7. **Examples must be realistic** — Syrian context, realistic prices in SYP.
