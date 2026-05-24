# المرجع المتقاطع — Golden CRM Cross-Reference

> هاد الملف بيخليّك تفهم: "هيدا الحقل وين بيستخدم؟" و "هيدا الجدول مع مين مرتبط؟"
> **مفيد للـ:** debugging, refactoring, impact analysis, onboarding developers.

---

## 1. الحقول المشتركة بين الجداول (Shared Fields)

> **القاعدة:** أي حقل بيظهر بأكتر من جدول — نسجله هون.

### 1.1 `client_id` / `customer_id` (معرف الزبون)

| الجدول | اسم الحقل | نوع العلاقة | ON DELETE | وصف |
|---|---|---|---|---|
| `clients` | `id` | PK | — | المصدر |
| `contracts` | `customer_id` | FK | SET NULL | العقود تبع الزبون |
| `visits` | `customer_id` | FK | — | الزيارات للزبون |
| `field_visits` | `client_id` | FK | — | الزيارات الميدانية |
| `open_tasks` | `client_id` | FK | — | المهام المفتوحة |
| `customer_call_logs` | `client_id` | FK | — | سجل الاتصالات |
| `emergency_tickets` | `client_id` | FK | — | بلاغات الطوارئ |
| `maintenance_requests` | `customer_id` | FK | — | طلبات الصيانة |
| `contact_targets` | `target_id` | FK | — | أهداف الاتصال |
| `visit_name_collections` | `client_id` | FK | — | جمع أسماء |
| `direct_suggestions` | `client_id` | FK | — | ترشيحات مباشرة |

**⚠️ ملاحظة مهمة:** `customer_id` = `client_id` بنفس المعنى — تسمية مختلفة حسب السياق (Sales vs CRM).

### 1.2 `branch_id` (معرف الفرع)

| الجدول | NULL? | DEFAULT | وصف |
|---|---|---|---|
| `clients` | ✅ | — | فرع تسجيل الزبون |
| `contracts` | ✅ | — | **فرع العقد — ممكن يختلف عن فرع الزبون** |
| `employees` | ✅ | — | فرع الموظف |
| `candidates` | ✅ | — | فرع المرشح |
| `field_visits` | ✅ | — | فرع الزيارة |
| `open_tasks` | ✅ | — | فرع المهمة |
| `visits` | ❌ | — | فرع الزيارة |
| `tasks` | ❌ | — | فرع المهمة |
| `maintenance_requests` | ❌ | — | فرع طلب الصيانة |
| `emergency_tickets` | ❌ | — | فرع بلاغ الطوارئ |
| `telemarketing_task_lists` | ❌ | — | فرع كشف التسويق |
| `day_schedules` | ❌ | — | جدول الفرق |

**⚠️ ثغرة معروفة:** انظر [GAPS-TRACKER.md#GAP-006](GAPS-TRACKER.md#GAP-006)

### 1.3 `status` (الحالة)

| الجدول | النوع | القيم المسموحة | CHECK constraint? |
|---|---|---|---|
| `clients` | `VARCHAR(50)` | `active` / `deleted` (via `deleted_at`) | ❌ لا |
| `contracts` | `VARCHAR(50)` | `draft`, `active`, `completed`, `cancelled` | ✅ نعم |
| `tasks` | `VARCHAR(50)` | `pending`, `in-progress`, `completed` | ✅ نعم |
| `visits` | `VARCHAR(50)` | `Pending`, `Completed`, `Cancelled` | ✅ نعم |
| `emergency_tickets` | `VARCHAR(50)` | `New`, `Assigned`, `In Progress`, `Completed`, `Cancelled` | ✅ نعم |
| `candidates` | `VARCHAR(50)` | `New`, `Suggested`, `FollowUp`, `Contacted`, `Qualified`, `Junk` | ✅ نعم |
| `referral_sheets` | `VARCHAR(50)` | `New`, `In-Progress`, `Completed`, `Archived` | ✅ نعم |

**⚠️ ملاحظة:** `status` كل جدول enum مختلف — لا خلط!

### 1.4 `created_at` / `created_by` (التدقيق والأرشيف)

| الجدول | `created_at` | `created_by` | `updated_at` | `deleted_at` | Soft-delete? |
|---|---|---|---|---|---|
| `clients` | ✅ TIMESTAMPTZ | ✅ FK → hr_users | ❌ | ✅ | ✅ نعم |
| `contracts` | ✅ TIMESTAMPTZ | — | — | — | ❌ لا |
| `employees` | ✅ TIMESTAMPTZ | — | — | — | ❌ لا |
| `candidates` | ✅ TIMESTAMPTZ | ✅ FK → hr_users | — | — | ❌ لا |
| `referral_sheets` | ✅ TIMESTAMPTZ | ✅ FK → hr_users | — | — | ❌ لا |
| `tasks` | — | — | — | — | ❌ لا |
| `visits` | — | — | — | — | ❌ لا |

---

## 2. العلاقات بين الجداول (Entity Relationships)

### 2.1 النظرة العامة

```
clients (1) ────────► (N) contracts
    │                       │
    │                       ▼
    │                  (N) contract_line_items
    │                       │
    │                       ▼
    │                  (N) contract_payment_entries
    │
    ├───────► (N) field_visits
    │            │
    │            ▼
    │       (N) visit_tasks
    │            │
    │            ▼
    │       (N) visit_task_results
    │
    ├───────► (N) open_tasks
    │            │
    │            ▼
    │       (N) open_task_delivery_results
    │       (N) open_task_installation_results
    │
    ├───────► (N) customer_call_logs
    │
    ├───────► (N) client_assignments (M2M bridge)
    │            │
    │            ▼
    │       (N) hr_users
    │
    └───────► (N) emergency_tickets
                 │
                 ▼
            (1) emergency_results
                 │
                 ▼
            (N) emergency_maintenance_actions
            (N) emergency_payment_entries
            (N) emergency_installments

```

### 2.1.2 علاقات المرشحين (Candidates)

```
referral_sheets (1) ──────► (N) candidates
                                 │
                                 ├───────► (1) clients (via converted_to_lead_id)
                                 │
                                 ├───────► (N) candidate_assignments (M2M bridge)
                                 │            │
                                 │            ▼
                                 │       (N) hr_users
                                 │
                                 └───────► (1) branches
```

### 2.2 الجداول الربطية (Junction Tables)

| الجدول الربطي | يربط | مع | الغرض |
|---|---|---|---|
| `client_assignments` | `clients` | `hr_users` | تخصيص موظفين لزبون |
| `candidate_assignments` | `candidates` | `hr_users` | تخصيص موظفين لمرشح |
| `contract_line_items` | `contracts` | `device_models` + `spare_parts` | بنود العقد |
| `contract_payment_entries` | `contracts` | — | دفعات العقد |
| `visit_tasks` | `field_visits` | `task_type_config` | مهام الزيارة |
| `role_permission_grants` | `roles` | `permissions` | صلاحيات الدور |
| `user_branch_assignments` | `hr_users` | `branches` | فروع الموظف |

---

## 3. القيود المشتركة (Shared Constraints)

### 3.1 Soft-Delete Pattern

| الجدول | الحقول | الفهرس الجزئي |
|---|---|---|
| `clients` | `deleted_at`, `deleted_by`, `is_active` | `idx_clients_active` |
| أي جدول آخر | ❌ لا يوجد | — |

**الخلاصة:** بس `clients` عنده soft-delete — باقي الجداول hard-delete.

### 3.2 JSONB Fields (حقول مرنة)

| الجدول | الحقل | الاستخدام |
|---|---|---|
| `clients` | `contacts` | أرقام إضافية |
| `clients` | `gps_coordinates` | إحداثيات |
| `clients` | `referrers` | قائمة الوسطاء |
| `contracts` | — | — |
| `employees` | — | — |
| `branches` | `covered_geo_ids` | مناطق التغطية |
| `branches` | `contact_info` | معلومات التواصل |
| `device_models` | `supported_visit_types` | أنواع الزيارات |
| `spare_parts` | `compatible_device_ids` | الأجهزة المتوافقة |
| `emergency_tickets` | `attachments` | مرفقات |
| `maintenance_requests` | `technical_report` | تقرير فني |

### 3.3 CHECK Constraints (قيم محددة)

| الجدول | الحقل | القيم | موجود بالـ DB? |
|---|---|---|---|
| `clients` | `gender` | `Male`, `Female` | ❌ لا (GAP-005) |
| `clients` | `data_quality` | `Complete`, `Partial`, `Minimal` | ❌ لا (GAP-005) |
| `clients` | `rating` | `Committed`, `NotCommitted`, `Undefined` | ❌ لا |
| `employees` | `role` | `supervisor`, `technician`, `telemarketer`, `trainee` | ✅ نعم |
| `employees` | `status` | `active`, `leave`, `inactive` | ✅ نعم |
| `contracts` | `status` | `draft`, `active`, `completed`, `cancelled` | ✅ نعم |
| `tasks` | `type` | `emergency`, `dues`, `periodic`, `returns`, `followup` | ✅ نعم |
| `tasks` | `status` | `pending`, `in-progress`, `completed` | ✅ نعم |
| `tasks` | `priority` | `high`, `medium`, `low` | ✅ نعم |
| `device_models` | `category` | `Residential`, `Industrial`, `Commercial` | ✅ نعم |
| `spare_parts` | `maintenance_type` | `Periodic`, `Emergency`, `Accessory` | ✅ نعم |

---

## 4. الـ APIs المتقاطعة (Shared API Patterns)

### 4.1 Query Parameters المشتركة

| الباراميتر | الجداول اللي بيستخدموه | النوع | وصف |
|---|---|---|---|
| `branchId` | clients, contracts, candidates, tasks, visits | integer | تصفية حسب فرع |
| `search` | clients, candidates, employees | string | بحث نصي |
| `page` | الكل | integer | ترقيم الصفحات |
| `limit` | الكل | integer | حجم الصفحة |
| `status` | contracts, tasks, visits | string | تصفية حسب حالة |
| `date` | schedules, visits, field_visits | string | تصفية حسب تاريخ |

### 4.2 Headers المشتركة

| Header | الجداول المطلوب فيها | وصف |
|---|---|---|
| `X-Branch-Id` | tasks, visits, field_visits, schedules, routeAssignments, planning, contactTargets, telemarketing, openTasks, workScopes, maintenanceRequests, emergencyTickets, dues | branch-only routes |
| `Authorization: Bearer JWT` | الكل عدا public routes | التحقق من الهوية |

---

## 5. الجداول التشغيلية الكاملة (72 Table Inventory)

> قائمة بكل الجداول بالنظام — للتأكد إن ما فيه جدول منسي.

### 5.1 الكيانات الأساسية (Core)

| # | الجدول | PK | FKs | Soft-delete | CHECK |
|---|---|---|---|---|---|
| 1 | `geo_units` | `id` | `parent_id` → geo_units | ❌ | ❌ |
| 2 | `branches` | `id` | `location_geo_id` → geo_units | ❌ | ✅ |
| 3 | `employees` | `id` | — | ❌ | ✅ |
| 4 | `hr_users` | `id` | `employee_id` → employees | ❌ | — |
| 5 | `clients` | `id` | `branch_id`, `referral_sheet_id`, `created_by` | ✅ | ❌ |
| 6 | `candidates` | `id` | `referral_sheet_id` | ❌ | ✅ |
| 7 | `referral_sheets` | `id` | `owner_user_id`, `created_by` | ❌ | ✅ |

### 5.2 العمليات (Operations)

| # | الجدول | PK | FKs | وصف |
|---|---|---|---|---|
| 8 | `contracts` | `id` | `customer_id`, `device_model_id` | العقود |
| 9 | `contract_line_items` | `id` | `contract_id` | بنود العقد |
| 10 | `contract_payment_entries` | `id` | `contract_id` | دفعات العقد |
| 11 | `contract_installments` | `id` | `contract_id` | أقساط العقد |
| 12 | `dues` | `id` | `contract_id` | المستحقات |
| 13 | `device_models` | `id` | — | موديلات الأجهزة |
| 14 | `spare_parts` | `id` | — | قطع الغيار |
| 15 | `device_discounts` | `id` | `device_model_id` | خصومات الأجهزة |
| 16 | `device_technical_states` | `id` | — | الحالات التقنية |

### 5.3 الزيارات والمهام (Visits & Tasks)

| # | الجدول | PK | FKs | وصف |
|---|---|---|---|---|
| 17 | `visits` | `id` | `customer_id`, `employee_id` | الزيارات القديمة |
| 18 | `field_visits` | `id` | `client_id`, `route_id` | الزيارات الميدانية |
| 19 | `visit_tasks` | `id` | `field_visit_id` | مهام الزيارة |
| 20 | `visit_task_results` | `id` | `visit_task_id` | نتائج مهام الزيارة |
| 21 | `visit_name_collections` | `id` | `client_id`, `field_visit_id` | جمع أسماء |
| 22 | `direct_suggestions` | `id` | `client_id` | ترشيحات مباشرة |
| 23 | `tasks` | `id` | — | المهام القديمة |
| 24 | `open_tasks` | `id` | `client_id`, `contract_id` | المهام المفتوحة |
| 25 | `task_type_config` | `id` | — | إعدادات أنواع المهام |
| 26 | `schedules` | `date` | — | جداول الفرق |
| 27 | `route_assignments` | `key` | — | تخصيص المسارات |
| 28 | `routes` | `id` | — | المسارات الجغرافية |
| 29 | `route_points` | `id` | `route_id` | نقاط المسار |
| 30 | `workScopes` | `id` | — | نطاقات العمل |
| 31 | `day_schedules` | `date` | — | الجداول اليومية |
| 32 | `maintenance_requests` | `id` | `customer_id`, `contract_id` | طلبات الصيانة |
| 33 | `emergency_tickets` | `id` | `client_id`, `contract_id` | بلاغات الطوارئ |
| 34 | `emergency_action_types` | `id` | — | أنواع إجراءات الطوارئ |
| 35 | `emergency_result_parts` | `id` | — | قطع طوارئ |
| 36 | `emergency_result_costs` | `id` | — | تكاليف طوارئ |
| 37 | `emergency_maintenance_actions` | `id` | — | إجراءات صيانة طوارئ |
| 38 | `emergency_payment_entries` | `id` | — | دفعات طوارئ |
| 39 | `emergency_installments` | `id` | — | أقساط طوارئ |
| 40 | `visit_task_device_delivery_results` | `id` | — | نتائج توصيل |
| 41 | `visit_task_device_installation_results` | `id` | — | نتائج تركيب |
| 42 | `visit_task_device_demo_results` | `id` | — | نتائج عرض |
| 43 | `visit_task_device_activation_results` | `id` | — | نتائج تفعيل |
| 44 | `visit_task_emergency_technical_states` | `id` | — | حالات تقنية طوارئ |
| 45 | `visit_task_emergency_parts_used` | `id` | — | قطع مستخدمة |
| 46 | `visit_task_emergency_financials` | `id` | — | أمور مالية |
| 47 | `open_task_delivery_results` | `id` | — | نتائج توصيل مفتوحة |
| 48 | `open_task_installation_results` | `id` | — | نتائج تركيب مفتوحة |
| 49 | `open_task_pre_offers` | `id` | — | عروض مسبقة |
| 50 | `marketing_visit_tasks` | `id` | — | مهام زيارة تسويق |
| 51 | `marketing_visit_task_offers` | `id` | — | عروض زيارة تسويق |
| 52 | `marketing_visits` | `id` | — | زيارات تسويق (legacy) |

### 5.4 التسويق (Telemarketing)

| # | الجدول | PK | FKs | وصف |
|---|---|---|---|---|
| 53 | `telemarketing_task_lists` | `id` | — | كشوف التسويق |
| 54 | `telemarketing_task_list_items` | `id` | `task_list_id` | بنود الكشف |
| 55 | `telemarketing_call_logs` | `id` | `task_list_id` | سجل المكالمات |
| 56 | `telemarketing_appointments` | `id` | — | مواعيد التسويق |
| 57 | `contact_targets` | `id` | — | أهداف الاتصال |

### 5.5 التوظيف (HR)

| # | الجدول | PK | FKs | وصف |
|---|---|---|---|---|
| 58 | `job_vacancies` | `id` | — | الشواغر |
| 59 | `job_applications` | `id` | `vacancy_id` | طلبات التوظيف |
| 60 | `applicants` | `id` | — | المتقدمون |
| 61 | `interviews` | `id` | `application_id` | المقابلات |
| 62 | `training_courses` | `id` | — | الدورات التدريبية |
| 63 | `training_course_trainees` | `id` | `course_id` | المتدربون |
| 64 | `training_attendance` | `id` | `course_id` | الحضور |
| 65 | `departments` | `id` | — | الأقسام |

### 5.6 الصلاحيات والأمان (Auth & Permissions)

| # | الجدول | PK | FKs | وصف |
|---|---|---|---|---|
| 66 | `roles` | `id` | — | الأدوار |
| 67 | `permissions` | `id` | — | الصلاحيات |
| 68 | `role_permissions` | `id` | `role_id`, `permission_id` | صلاحيات الدور |
| 69 | `role_permission_grants` | `id` | `role_id`, `permission_id` | منح الصلاحيات |
| 70 | `role_job_tasks` | `id` | `role_id` | مهام الدور |
| 71 | `user_branch_assignments` | `id` | `user_id`, `branch_id` | فروع المستخدم |

### 5.7 النظام والمساعدة (System)

| # | الجدول | PK | FKs | وصف |
|---|---|---|---|---|
| 72 | `system_lists` | `id` | — | قوائم النظام |
| 73 | `audit_logs` | `id` | — | سجل التدقيق |
| 74 | `client_audit_log` | `id` | `client_id` | تغييرات الزبون |
| 75 | `referrers` | `id` | — | الوسطاء |
| 76 | `customer_call_logs` | `id` | `client_id` | سجل اتصال الزبائن |

---

## 6. الجداول اللي لساتون Legacy أو Deprecated

| الجدول | البديل | الحالة |
|---|---|---|
| `tasks` | `open_tasks` + `visit_tasks` | ⚠️ قديم — بده migration |
| `visits` | `field_visits` | ⚠️ قديم — بده migration |
| `marketing_visits` | `field_visits` | ⚠️ قديم — migration جارية |
| `assigned_hr_user_id` (clients) | `client_assignments` | ⚠️ deprecated — لازم يُحذف |
