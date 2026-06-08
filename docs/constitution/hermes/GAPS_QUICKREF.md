# ثغرات سريعة — Gaps Quick Reference

> **15 ثغرة فقط — الأهم بالأولوية.**
> الباقي في `GAPS-TRACKER.md` الكامل.

---

## 🔴 عالية (High Priority)

### GAP-001: bulk-delete hard-delete bypass
- **الكيان:** clients
- **الموقع:** `routes/clients.ts:989`
- **المشكلة:** `POST /api/clients/bulk-delete` بيعمل hard-delete مباشرة — بيتجاوز soft-delete
- **الحل:** روحه لـ soft-delete: فحص العقود → إلغاء المهام → soft-delete

### GAP-002: ASSIGNED scope blocked بالـ DB
- **الكيان:** clients + permissions
- **الموقع:** `migrations/054_permissions_allowed_scopes.sql`
- **المشكلة:** `clients.view` ممنوع من `ASSIGNED` — `clientPolicy.ts` جاهز لـ ASSIGNED بس الـ DB ما بيسمح
- **الحل:** ALTER `allowed_scopes` يضيف `ASSIGNED` لـ `clients.view`, `clients.view_list`, `clients.edit`

### GAP-006: Client cross-branch lookup missing
- **الكيان:** clients + contracts
- **الموقع:** `routes/clients.ts` (GET /api/clients)
- **المشكلة:** فرع حمص ما بيقدر يخدم "زبون دمشق" — البحث بيفلتر بس `branch_id`
- **الحل:** إضافة `?crossBranch=true` + permission `clients.cross_branch_lookup`

### GAP-017/027: تضارب اسماء صلاحيات `marketing_visits`
- **الكيان:** field-visits + permissions
- **الموقع:** `routes/fieldVisits.ts` + `routes/workScopes.ts` + `routes/emergencyResult.ts`
- **المشكلة:** بعض الـ routes لساتها بتستعمل `marketing_visits.view` مش `field_visits.view`
- **الحل:** تحديث الصلاحيات لـ `field_visits.*` بعد مراجعة كاملة

---

## 🟡 متوسطة (Medium Priority)

### GAP-004: Stale `assigned_hr_user_id` column
- **الكيان:** clients
- **الحل:** `ALTER TABLE clients DROP COLUMN assigned_hr_user_id`

### GAP-005: Missing CHECK constraints on enum-like fields
- **الكيان:** clients
- **الموقع:** `gender`, `data_quality` — `VARCHAR` مفتوح بدون CHECK
- **الحل:** `ADD CHECK (gender IN ('Male', 'Female'))` + `CHECK (data_quality IN ('Complete', 'Partial', 'Minimal'))`

### GAP-007: Candidate detail view endpoint missing
- **الكيان:** candidates
- **الموقع:** `routes/candidates.ts` — missing `GET /api/candidates/:id`
- **الحل:** إضافة endpoint + ربطه بـ `canViewCandidate`

### GAP-013: dues.status values mismatch
- **الكيان:** contracts
- **المشكلة:** `Pending/Partial/Paid/Overdue` (capitalized) vs `contract_installments` (lowercase)
- **الحل:** اتفاق تسمية واحدة

### GAP-020: Missing `created_by` on contracts
- **الكيان:** contracts
- **الحل:** `ALTER TABLE contracts ADD created_by FK→hr_users`

---

## 🟢 منخفضة (Low Priority)

### GAP-003: Geo fields stored as VARCHAR → INTEGER
- **الحالة:** ✅ **محلول** — migration 170

### GAP-034: `employees.residence` text column
- **الحالة:** ✅ **محلول** — migration 171

### GAP-035: `geo_units.level` missing CHECK
- **الحالة:** ✅ **محلول** — migration 168

### GAP-036: Missing hierarchical check in POST geo-units
- **الحالة:** ✅ **محلول** — `routes/geoUnits.ts` صار فحص `parent.level = child.level - 1`

### GAP-038: `covered_geo_ids` JSONB → junction table
- **الحالة:** ✅ **محلول** — migration 169

### GAP-048: `roles.team_slot_type` nullable
- **الحالة:** ⏳ مؤجل — مدير الفرع ما بيقدر يختار TeamSlot/EmergencySlot

---

## 🚨 الثغرة العميقة (The Hidden Gap)

### `location_basis` = `contract` vs `device`
- **ليست بـ GAPS-TRACKER بـ رقم** — هي drift مكتشفة بالمحادثة
- **المشكلة:** `task_type_config` CHECK بيقول `contract` — القرار `device` — `planningMarketingTargets.ts` بيقرأ `installed_devices` عبر `customer_id` مش `device_id`
- **الحل المطلوب:** 6 خطوات (انظر MASTER.md أولويات هذا الأسبوع)
