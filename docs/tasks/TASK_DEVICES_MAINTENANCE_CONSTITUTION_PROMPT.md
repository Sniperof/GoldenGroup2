# Prompt: Domain Constitution for Devices & Maintenance (الأجهزة والصيانة)

## Objective

Build the **complete, authoritative Domain Constitution** for the `device_models`, `spare_parts`, `device_discounts`, and related device lifecycle entities in Golden CRM. This domain tracks the physical products, their discounts, and their lifecycle states through delivery, installation, and maintenance.

Follow the exact same template and quality standard established by the `clients` pilot.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/devices-maintenance.md` — The full Devices & Maintenance constitution
2. Update `docs/constitution/INDEX.md` — Add devices-maintenance row
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add device tables and relationships
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-050, GAP-051, etc.

---

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
```
migrations/001_core_tables.sql              (CREATE TABLE device_models, spare_parts)
migrations/036_device_model_catalog_fields.sql  (catalog fields added)
migrations/051_marketing_visits_mvp.sql
migrations/070_visit_core_schema.sql
migrations/086_open_task_devices.sql        (open_task_devices table)
migrations/087_marketing_visit_tasks_result_fields.sql
migrations/090_add_offered_device_model.sql
migrations/117_emergency_result_enhancements.sql
migrations/122_device_discounts.sql          (CREATE TABLE device_discounts)
migrations/123_rename_is_featured.sql
migrations/124_device_bilingual.sql          (name_en, name_ar)
migrations/125_device_code.sql               (code field)
migrations/126_contract_enhancements.sql
migrations/128_drop_device_fixed_discount.sql
migrations/129_discount_constraints.sql
migrations/130_applied_device_discount_id.sql
migrations/134_pre_offer_applied_discount.sql
migrations/142_contract_device_tracking.sql   (device_status, is_installed)
migrations/143_device_delivery_results.sql   (delivery result tables)
migrations/144_delivery_task_permissions.sql
migrations/145_device_installation_results.sql
migrations/147_visit_tasks_device_demo.sql
```

Also check:
- `migrations/106_task_type_config.sql` (task types: device_delivery, device_installation, device_demo)
- `migrations/116_emergency_result_phases.sql`

### B. API Layer
```
packages/api/routes/deviceModels.ts          (10 endpoints)
packages/api/routes/spareParts.ts            (5 endpoints — check!)
packages/api/routes/contracts.ts             (for device lifecycle logic)
packages/api/routes/openTasks.ts             (for open_task_devices)
```

### C. Shared Types
```
packages/shared/types.ts
```

### D. System Configuration
Check permissions seeding for device-related operations.

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/devices-maintenance.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: الأجهزة والصيانة
- **الاسم الإنجليزي**: Devices & Maintenance
- **الجداول الرئيسية**: `device_models`, `spare_parts`, `device_discounts`
- **الجداول الفرعية**: `contract_line_items`, `open_task_devices`, `visit_task_device_delivery_results`, `visit_task_device_installation_results`, `visit_task_device_demo_results`
- **الوصف**: نظام إدارة الأجهزة (فلاتر المياه) وقطع الغيار والخصومات. يتتبع دورة حياة الجهاز من العرض → العقد → التوصيل → التركيب → التفعيل → الصيانة الدورية.
- **الجداول المرتبطة**: contracts, contract_line_items, open_tasks, field_visits, visit_tasks
- **الأهمية**: Core product catalog — كل مبيعة بتبدأ من هون.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

#### 2.1 `device_models` — موديلات الأجهزة

| الحقل | النوع | NULL? | DEFAULT | Constraints | وصف | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | | `5` |
| `name` | `VARCHAR(255)` | ❌ | — | — | اسم الجهاز | `"فلتر ٥ مراحل"` |
| `name_en` | `VARCHAR(255)` | ✅ | — | — | الاسم الإنجليزي (migration 124) | `"5-Stage Filter"` |
| `name_ar` | `VARCHAR(255)` | ✅ | — | — | الاسم العربي (migration 124) | `"فلتر ٥ مراحل"` |
| `code` | `VARCHAR(100)` | ✅ | — | | كود المنتج (migration 125) | `"WF-5S-2026"` |
| `brand` | `VARCHAR(255)` | ✅ | — | — | العلامة التجارية | `"Golden Water"` |
| `category` | `VARCHAR(50)` | ✅ | — | `CHECK ('Residential', 'Industrial', 'Commercial')` | الفئة | `"Residential"` |
| `maintenance_interval` | `VARCHAR(50)` | ✅ | — | — | فترة الصيانة | `"6_months"` |
| `base_price` | `NUMERIC` | ✅ | `0` | — | السعر الأساسي | `150000` |
| `supported_visit_types` | `JSONB` | ✅ | `'[]'` | — | أنواع الزيارات المدعومة | `["device_delivery", "device_installation", "periodic_maintenance"]` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | | |

#### 2.2 `spare_parts` — قطع الغيار

| الحقل | النوع | NULL? | DEFAULT | Constraints | وصف | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | | `12` |
| `name` | `VARCHAR(255)` | ❌ | — | | اسم القطعة | `"شمعات UV"` |
| `code` | `VARCHAR(100)` | ✅ | — | | كود القطعة | `"SP-UV-001"` |
| `base_price` | `NUMERIC` | ✅ | `0` | | السعر الأساسي | `5000` |
| `maintenance_type` | `VARCHAR(50)` | ✅ | — | `CHECK ('Periodic', 'Emergency', 'Accessory')` | نوع الصيانة | `"Periodic"` |
| `compatible_device_ids` | `JSONB` | ✅ | `'[]'` | — | الأجهزة المتوافقة | `[5, 6, 7]` |

#### 2.3 `device_discounts` — خصومات الأجهزة

| الحقل | النوع | NULL? | DEFAULT | Constraints | وصف | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | | `7` |
| `device_model_id` | `INTEGER` | ❌ | — | `FK → device_models(id) ON DELETE CASCADE` | الجهاز | `5` |
| `label` | `VARCHAR(255)` | ❌ | — | | وصف الخصم | `"تخفيض رمضان"` |
| `percentage` | `NUMERIC` | ❌ | — | `CHECK (0-100)` | نسبة الخصم | `10` |
| `start_date` | `DATE` | ❌ | — | | بداية الخصم | `"2026-03-01"` |
| `end_date` | `DATE` | ❌ | — | | نهاية الخصم | `"2026-04-30"` |
| `is_active` | `BOOLEAN` | ❌ | `TRUE` | | هل نشط؟ | `true` |
| `created_by` | `INTEGER` | ✅ | — | `FK → hr_users` | المنشئ | `7` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | | | |

#### 2.4 Device Lifecycle Fields (on contracts table)

From migration 142:
- `contracts.device_status` — CHECK ('pending_delivery', 'delivered', 'installed', 'active')
- `contract_line_items.is_installed` — BOOLEAN DEFAULT FALSE

#### 2.5 Specialized Result Tables

- `visit_task_device_delivery_results` — migration 143
- `visit_task_device_installation_results` — migration 145
- `visit_task_device_demo_results` — migration 147
- `visit_task_device_activation_results` — check if exists

Document each with their fields.

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

#### BR-1: Device Lifecycle State Machine ⭐ CRITICAL

```
[pending_delivery] → (delivery task completed) → [delivered]
   │
   └── (installation task completed) → [installed]
           │
           └── (activation/confirmation) → [active]
```

What triggers each transition? Which task types drive each state?
- `pending_delivery` → contract created, delivery task generated
- `delivered` → delivery task result recorded
- `installed` → installation task result recorded
- `active` → client confirms device working / first maintenance scheduled

#### BR-2: Price Calculation with Discounts

```
base_price (device_models) = 150000
applied_discount (device_discounts) = 10%
final_price (contracts) = 150000 * 0.9 = 135000
```

How is the discount applied? At contract creation? Can it be changed later?

#### BR-3: Compatible Parts System

```
spare_parts.compatible_device_ids = [5, 6, 7]
→ This part fits device models 5, 6, and 7
→ JSONB array, no FK constraint (similar to covered_geo_ids issue)
```

#### BR-4: Maintenance Interval

```
device_models.maintenance_interval = "6_months"
→ After 6 months from installation_date, auto-generate maintenance task?
→ Or is this manual?
```

#### BR-5: Category System

```
'Residential' — منزل
'Industrial' — مصنع
'Commercial' — محل تجاري
```

Does category affect pricing? Maintenance schedule? Visit type?

#### BR-6: Demo Result vs Contract

```
visit_task_device_demo_results — customer tried the device
If demo successful → may lead to contract
If demo unsuccessful → no contract
```

How is demo success tracked? What fields indicate conversion?

#### BR-7: Installation Tracking

```
contract_line_items.is_installed = TRUE
→ Physical installation completed
→ verified by technician during installation visit
```

Can a part be marked installed without the main device? (Yes, for accessories)

#### BR-8: Discount Validity

```
start_date <= today <= end_date AND is_active = TRUE
→ Discount is applicable
```

What happens if discount expires after contract is created? Is the contract price locked?

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:

```
device_models ||--o{ device_discounts : "has discounts"
device_models ||--o{ contract_line_items : "sold as"
device_models ||--o{ spare_parts : "compatible with"
device_models ||--o{ visit_task_device_demo_results : "demoed"
device_models ||--o{ visit_task_device_delivery_results : "delivered"
device_models ||--o{ visit_task_device_installation_results : "installed"
spare_parts ||--o{ contract_line_items : "sold as part/accessory"
spare_parts }o--o{ device_models : "compatible with"
```

---

### Section 5: آلة الحالات (State Machine)

#### 5.1 Device Status (on contracts)
```
[pending_delivery] ──delivery task done──► [delivered]
   │
   └──installation task done──► [installed]
           │
           └──activation──► [active]
```

#### 5.2 Discount Status
```
[is_active=true, in date range] → discount applicable
[is_active=false OR expired] → discount not applicable
```

#### 5.3 Part Installation Status (on contract_line_items)
```
[is_installed=false] → pending installation
[is_installed=true] → physically installed
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض الأجهزة | (implicit/public?) | — | GET /api/device-models عادةً public |
| عرض أجهزة للبيع | `requireAuth` | BRANCH | GET /api/device-models/for-sale |
| إدارة الأجهزة | (none?) | — | POST/PUT/DELETE device-models — check what permissions are used! |
| إدارة الخصومات | (none?) | — | device-models/:id/discounts endpoints |

**CRITICAL:** Check deviceModels.ts — some endpoints have NO `requirePermission` at all! Document this as a security gap.

---

### Section 7: عقد API (API Contract)

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/device-models` | (public?) | قائمة كل الأجهزة |
| GET | `/api/device-models/for-sale` | `requireAuth` | أجهزة متاحة للبيع |
| POST | `/api/device-models` | (none?) | إضافة جهاز |
| PUT | `/api/device-models/:id` | (none?) | تعديل جهاز |
| DELETE | `/api/device-models/:id` | (none?) | حذف جهاز |
| GET | `/api/device-models/:id/discounts` | `requireAuth` | خصومات الجهاز |
| GET | `/api/device-models/:id/discounts/all` | `requireAuth` | كل الخصومات |
| POST | `/api/device-models/:id/discounts` | `requireAuth` | إضافة خصم |
| PUT | `/api/device-models/:id/discounts/:discountId` | `requireAuth` | تعديل خصم |
| DELETE | `/api/device-models/:id/discounts/:discountId` | `requireAuth` | حذف خصم |
| GET | `/api/spare-parts` | (check) | قائمة قطع الغيار |
| POST | `/api/spare-parts` | (check) | إضافة قطعة |
| PUT | `/api/spare-parts/:id` | (check) | تعديل |
| DELETE | `/api/spare-parts/:id` | (check) | حذف |

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | عرض قائمة الأجهزة | GET /device-models | — | 200 + devices array |
| TC-02 | عرض أجهزة للبيع | GET /for-sale | branch context | 200 + filtered devices |
| TC-03 | إضافة جهاز | POST / | {name:"فلتر 7 مراحل", basePrice:200000} | 200 + device created |
| TC-04 | إضافة خصم | POST /:id/discounts | {percentage:15, startDate, endDate} | 200 + discount created |
| TC-05 | تطبيق خصم منتهي | (at contract creation) | discount expired | price without discount |
| TC-06 | تتبع device_status | GET /contracts/:id | — | shows device_status |
| TC-07 | تركيب قطعة | PUT /contracts/:id/line-items/:itemId/installation | {isInstalled:true} | 200 |
| TC-08 | توصيل جهاز | (delivery task result) | — | device_status='delivered' |
| TC-09 | تركيب الجهاز | (installation task result) | — | device_status='installed' |
| TC-10 | عرض قطع الغيار | GET /spare-parts | — | 200 + parts array |
| TC-11 | compatibility check | GET /spare-parts/:id | device_model_id | shows compatible_device_ids |
| TC-12 | حذف جهاز مع خصومات | DELETE /:id | device_id | CASCADE deletes discounts? |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

1. **No permission checks on device management** — `POST /`, `PUT /:id`, `DELETE /:id` may lack `requirePermission`. Any authenticated user (or even unauthenticated?) can manage devices.
2. **`supported_visit_types` JSONB** — No FK constraint to task_type_config. Invalid values possible.
3. **`compatible_device_ids` JSONB** — No FK constraint to device_models. Invalid IDs possible.
4. **`contracts.device_status` CHECK** — Only 4 states. No 'maintenance', 'retired', 'faulty' states?
5. **Discount percentage** — CHECK (0-100). What about fixed amount discounts? Only percentage exists.
6. **`maintenance_interval` as VARCHAR** — Not structured. "6_months", "1_year" — no validation pattern.
7. **No soft-delete** — device_models and spare_parts hard-deleted. What happens to existing contracts referencing them?
8. **device_models.name vs name_en/name_ar** — Which is authoritative? `name` is NOT NULL, `name_en`/`name_ar` are nullable.
9. **Code field uniqueness** — Is `code` UNIQUE? Check constraints.
10. **Spare parts maintenance_type** — 'Periodic', 'Emergency', 'Accessory' — what's the difference between Periodic and Emergency parts?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document device-related migrations in order.

---

## Step 3: Update Supporting Files

### INDEX.md
Add row:
```
| الأجهزة والصيانة (Devices & Maintenance) | [domains/devices-maintenance.md](domains/devices-maintenance.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add:
- `device_models`, `spare_parts`, `device_discounts` to Table Inventory
- `device_status` enum
- `category` enum values
- `maintenance_type` enum values
- JSONB arrays pattern (supported_visit_types, compatible_device_ids)

### GAPS-TRACKER.md
If new gaps found (GAP-050+), add them.

---

## Verification Checklist

- [ ] `devices-maintenance.md` contains all 10 sections
- [ ] `device_models` table: 10+ fields documented
- [ ] `spare_parts` table: 5+ fields documented
- [ ] `device_discounts` table: 9+ fields documented
- [ ] Device lifecycle state machine documented
- [ ] Discount calculation logic documented
- [ ] All 14 endpoints documented
- [ ] Missing permission checks documented as gaps
- [ ] At least 12 test cases
- [ ] At least 5 gaps identified
- [ ] INDEX.md, CROSS-REFERENCE.md, GAPS-TRACKER.md updated
- [ ] TypeScript check passes
- [ ] pm2 restart succeeds
- [ ] Git commit: `docs(constitution): complete devices-maintenance domain constitution`

---

## Notes for the Executor

1. **deviceModels.ts has WEIRD security.** Some endpoints are public, some require auth, some have NO permission check at all. Document this carefully.
2. **Device lifecycle is distributed.** Status is on `contracts`, not on a separate devices table. This is important.
3. **Discount system is time-based.** Start date, end date, is_active — all three must be checked for validity.
4. **Read migration 142 carefully.** It's the key to understanding device lifecycle tracking.
5. **Use exact SQL types** from migrations.
6. **Examples must be realistic** — Syrian pricing in SYP, realistic device names.
