# شيرت الكيانات — Entity Cheat Sheet

> **لكل كيان: اسمه، جدوله، الحقول المهمة بس.**

---

## الزبائن Clients

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `first_name` | VARCHAR(255) | ❌ | الاسم بالـ UI = first + father + last |
| `mobile` | VARCHAR(50) | ❌ | Western numerals فقط |
| `governorate/district/neighborhood` | INTEGER FK→geo_units | ✅ | تحولت لـ INTEGER بـ migration 170 |
| `branch_id` | INTEGER FK→branches | ✅ | RESTRICT — فرع التسجيل |
| `contacts` | JSONB | ✅ | `{label, number, isPrimary, hasWhatsApp, status}` |
| `referrers` | JSONB | ✅ | source of truth — legacy fields deprecated |
| `data_quality` | VARCHAR | ✅ | `Complete/Partial/Minimal` — لون الـ Avatar |
| `gender` | VARCHAR | ✅ | `Male/Female` — أيقونة الـ Avatar |
| `deleted_at` | TIMESTAMPTZ | ✅ | soft-delete وحيده بالنظام |
| `created_by` | FK→hr_users | ✅ | — |
| `assigned_hr_user_id` | INTEGER | ✅ | ⚠️ LEGACY — استخدم `client_assignments` M2M |

---

## العقود Contracts

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `customer_id` | FK→clients | ❌ | الـ DB بيقول `customer_id` بس هوي `client_id` |
| `branch_id` | FK→branches | ✅ | RESTRICT |
| `status` | VARCHAR(50) | ❌ | CHECK: draft/active/completed/cancelled |
| `sale_type` | VARCHAR | ✅ | cash/installment |
| `sale_subtype` | VARCHAR | ✅ | new/renewal/upgrade/transfer |
| `code` | VARCHAR | ✅ | auto-generated |
| `installed_device_id` | FK | ✅ | Phase 2A — ربط عكسي بعد الفصل |
| `installation_geo_unit_id` | FK→geo_units | ✅ | ⚠️ قديم — الآن بـ `installed_devices` |
| `created_at` | TIMESTAMPTZ | ❌ | — |
| `created_by` | FK→hr_users | ✅ | ⏳ MISSING — مش مضاف |

---

## الأجهزة المركبة Installed Devices

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `contract_id` | FK→contracts | ❌ | UNIQUE — جهاز واحد لكل عقد |
| `customer_id` | FK→clients | ❌ | قابل للتغيير (نقل ملكية) |
| `device_model_id` | FK | ✅ | — |
| `serial_number` | VARCHAR | ✅ | — |
| `status` | VARCHAR | ❌ | pending_delivery→delivered→installed→active→decommissioned |
| `installation_geo_unit_id` | FK→geo_units | ✅ | ⭐ **هوي الموقع الحقيقي للجهاز** |
| `installation_address_text` | TEXT | ✅ | العنوان التفصيلي |
| `is_golden_warranty` | BOOLEAN | ❌ | DEFAULT FALSE |
| `golden_warranty_end_date` | DATE | ✅ | — |
| `contract_warranty_end_date` | DATE | ✅ | — |

---

## المهام المفتوحة Open Tasks

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `client_id` | FK→clients | ❌ | — |
| `contract_id` | FK→contracts | ✅ | — |
| `device_id` | FK | ✅ | ⭐ **الجديد — لما لم يستغلم كـ grain لـ location** |
| `branch_id` | FK→branches | ❌ | RESTRICT |
| `task_type` | VARCHAR | ❌ | FK→task_type_config |
| `status` | VARCHAR | ❌ | CHECK 11 قيمة (open→needs_follow_up→assigned→...)→completed |
| `reason` | VARCHAR | ❌ | new_lead/follow_up/renewal/service_request/other |
| `priority` | VARCHAR | ✅ | high/medium/low |
| `task_family` | VARCHAR | ❌ | CHECK: marketing/service/maintenance/emergency/delivery/sales/collection/warranty |
| `expected_date` | DATE | ✅ | وعد الزبون |
| `expected_time` | VARCHAR | ✅ | الوقت المتوقع |
| `due_date` | DATE | ✅ | مسمّى → `required_date` |
| `creation_origin` | VARCHAR | ✅ | branch_plan/service_request_call/telemarketing_inline_booking/cascading_during_visit/manual_creation/emergency_request/system_trigger |
| `assigned_by` | FK | ✅ | من أسند |
| `assigned_at` | TIMESTAMPTZ | ✅ | — |
| `assigned_via` | VARCHAR | ✅ | planning_calculation/telemarketing_booking/manual_override/cascading |
| `excluded_for_date` | DATE | ✅ | الـ CRON بيرجعها |
| `client_snapshot` | JSONB | ✅ | Mini ClientSnapshot |
| `contract_snapshot` | JSONB | ✅ | — |
| `team_snapshot` | JSONB | ✅ | — |

---

## التسويق الهاتفي Telemarketing / Contact Targets

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `branch_id` | FK→branches | ❌ | RESTRICT |
| `target_id` | INTEGER | ❌ | client_id فعلياً |
| `target_type` | VARCHAR | ❌ | CHECK: `client` فقط (قديم candidate بس مغيّب) |
| `visit_type` | VARCHAR | ❌ | marketing/service/collection/mixed |
| `date` | DATE | ✅ | يوم الهدف |
| `status` | VARCHAR | ❌ | new/queued/in_call_list/contacted/booked/closed/cancelled |
| `work_location_geo_unit_id` | FK→geo_units | ✅ | ⭐ **grain جديد — مازال ما بيستغلم بالـ DB** |
| `team_key` | VARCHAR | ✅ | الفريق المسند |
| `latest_visit_id` | FK→field_visits | ✅ | قديم `latest_appointment_id` |
| `closing_reason` | VARCHAR | ✅ | booked/manual_telemarketer/manual_supervisor/auto_closed_by_cron/cooldown_set |
| `zone_id` | INTEGER | ✅ | ⚠️ LEGACY — يُستبدل بـ `work_location_geo_unit_id` |

---

## المهام الميدانية Field Visits

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `client_id` | FK→clients | ❌ | — |
| `branch_id` | FK→branches | ❌ | RESTRICT |
| `scheduled_date` | DATE | ❌ | — |
| `scheduled_time` | VARCHAR | ✅ | — |
| `team_key` | VARCHAR | ✅ | — |
| `status` | VARCHAR | ❌ | CHECK 7 قيم: scheduled/in_progress/ended/completed/not_completed/cancelled |
| `origin_type` | VARCHAR | ✅ | telemarketing/expected_followup/manual/emergency_request/system |
| `customer_snapshot` | JSONB | ✅ | Standard Snapshot level 2 |
| `cancellation_reason_id` | FK | ✅ | D18 — إلغاء بسبب |
| `booked_by_telemarketer_id` | FK | ✅ | من حجز |
| `answered_by` | VARCHAR | ✅ | من رد على المكالمة |

---

## الـ Geo Units

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | INTEGER PK | ❌ | — |
| `name` | VARCHAR(255) | ❌ | — |
| `level` | INTEGER | ❌ | CHECK: 1/2/3/4 (محافظة/منطقة/ناحية/حي) |
| `parent_id` | FK→geo_units | ✅ | RESTRICT — احذف الأبناء أولاً |
| `status` | VARCHAR(10) | ❌ | active/inactive |

---

## task_type_config

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `task_type` | VARCHAR PK | ❌ | — |
| `task_family` | VARCHAR | ❌ | marketing/service/maintenance/emergency/delivery/sales/collection/warranty |
| `location_basis` | VARCHAR | ❌ | ⭐ CHECK: `client` / `contract` — مفقود: `device` (مش `contract`) |
| `scheduling_pattern` | VARCHAR | ❌ | immediate/short_window/long_window/expected_window |
| `window_basis` | VARCHAR | ❌ | none/due_date/expected_date |
| `planning_window_days` | INTEGER | ✅ | lead_window (الـ N) |
| `contract_required` | BOOLEAN | ❌ | DEFAULT true |
| `contact_target_visit_type` | VARCHAR | ✅ | marketing/service/collection |

---

## الفروع Branches

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `name` | VARCHAR | ❌ | — |
| `location_geo_id` | FK→geo_units | ✅ | موقع الفرع |
| `covered_geo_ids` | JSONB | ✅ | ⚠️ DEPRECATED — انتقلت لـ `branch_geo_coverage` |
| `status` | VARCHAR | ✅ | active/inactive |

---

## الموظفون Employees

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `name` | VARCHAR | ❌ | — |
| `role` | VARCHAR | ❌ | CHECK: supervisor/technician/telemarketer/trainee |
| `status` | VARCHAR | ❌ | CHECK: active/leave/inactive |
| `branch_id` | FK→branches | ✅ | RESTRICT |
| `residence_governorate_id` | FK→geo_units | ✅ | — |
| `residence_region_id` | FK→geo_units | ✅ | — |
| `residence_sub_area_id` | FK→geo_units | ✅ | — |
| `residence_neighborhood_id` | FK→geo_units | ✅ | — |

---

## الصلاحيات Permissions

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `key` | VARCHAR | ❌ | `entity.action` — مثل `clients.view` |
| `allowed_scopes` | VARCHAR[] | ✅ | GLOBAL/BRANCH/ASSIGNED |
| `description` | TEXT | ✅ | — |

---

## الأدوار Roles

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `id` | SERIAL PK | ❌ | — |
| `name` | VARCHAR | ❌ | — |
| `branch_id` | FK→branches | ✅ | CASCADE |
| `team_slot_type` | VARCHAR | ✅ | TeamSlot/EmergencySlot |

---

## user_branch_assignments (Junction)

| الحقل | النوع | NULL? | ملاحظات |
|--------|--------|-------|--------|
| `user_id` | FK→hr_users | ❌ | CASCADE |
| `branch_id` | FK→branches | ❌ | CASCADE |
| `is_primary` | BOOLEAN | ✅ | الفرع الرئيسي |
