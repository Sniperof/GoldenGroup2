# TASK: حذف داتا الاختبار بالكامل — cleanup safe & precise

> الهدف: مسح كل البيانات التجريبية (test data) وإبقاء بيانات النظام الأساسية (core system config + clients + contracts) سليمة.
> الخطورة عالية — أي خطأ هون بيضيع بيانات حقيقية. بدقة تامة.

---

## ❌ جداول ممنوع لمسها أبداً (CORE SYSTEM)

| الجدول | السبب |
|--------|-------|
| `branches` | الفروع الأساسية |
| `clients` | بيانات الزبائن (ما نعرف ايش حقيقي وايش test) |
| `contracts` | العقود (لا تلمس!) |
| `geo_units` | المناطق الجغرافية |
| `routes` / `route_points` | المسارات |
| `hr_users` / `employees` | الموظفين |
| `roles` / `permissions` / `role_permissions` | الصلاحيات |
| `task_type_config` | أنواع المهام |
| `device_models` / `device_model_prices` | أجهزة وأسعار |
| `system_lists` / `system_list_items` | القوائم النظامية |
| `migrations` | تاريخ المايقريشن |
| `client_assignments` | إسناد الزبائن |

> **قاعدة ذهبية:** إذا الجدول اسمه مفرد وأساسي (clients, contracts, branches...) → **لا تلمس**.

---

## ✅ جداول يلي نقدر ننضفها (TEST DATA)

هي كلها بيانات "أحداث" و"زيارات" و"نتائج" يلي اجت من الاختبار:

### A — Legacy Visit Layer (كامل)
```sql
DELETE FROM marketing_visit_task_offers;   -- عروض العروض التجريبية
DELETE FROM marketing_visit_tasks;           -- مهام الزيارات القديمة
DELETE FROM marketing_visits;                -- الزيارات التسويقية القديمة
```

### B — Unified Visit Core (الزيارات الموحدة — إذا كانت test)
```sql
DELETE FROM visit_task_device_activation_results;
DELETE FROM visit_task_device_installation_results;
DELETE FROM visit_task_device_delivery_results;
DELETE FROM visit_task_results;
DELETE FROM visit_tasks;
DELETE FROM field_visits;
```

> **ملاحظة:** `field_visits` و `visit_tasks` هنّي الجداول الجديدة. إذا فيهم بيانات حقيقية (زيارات فعلية من الأسبوع الماضي) → ما نلمسن. بس إذا كلشي test → نمسح.

### C — Legacy Open Task Results (النتائج القديمة)
```sql
DELETE FROM open_task_device_activation_results;
DELETE FROM open_task_device_installation_results;
DELETE FROM open_task_device_delivery_results;
```

### D — Telemarketing Daily Data
```sql
DELETE FROM telemarketing_call_logs;
DELETE FROM telemarketing_appointments;
DELETE FROM telemarketing_task_list_items;
DELETE FROM telemarketing_task_lists;
```

### E — Contact Targets (جهات الاتصال)
```sql
DELETE FROM contact_targets;
```

> ملاحظة: `contact_targets` صار فيه `date` — إذا بدّك تحتفظ ببيانات حقيقية، حذف بس يلي `date < '2026-05-23'` (تاريخ اليوم). إذا كلشي test → `DELETE FROM contact_targets;` كامل.

### F — Activity Log (اختياري — للنظافة)
```sql
DELETE FROM task_activity_log WHERE created_at < NOW() - INTERVAL '7 days';
-- أو كامل إذا كلشي test:
-- DELETE FROM task_activity_log;
```

### G — Open Tasks (بنتبّه هون)
```sql
-- فقط المهام يلي status = 'completed' أو 'closed' أو 'cancelled' (تجريبية)
-- وما مرتبطة بعقد حديث
DELETE FROM open_tasks
WHERE status IN ('completed', 'closed', 'cancelled')
  AND created_at < '2026-05-20';  -- تاريخ قبل الاختبار

-- مهام قيد الانتظار يلي هي test — احذر قبل ما تمسح:
-- SELECT task_type, COUNT(*) FROM open_tasks WHERE status IN ('open', 'needs_follow_up') GROUP BY task_type;
-- إذا كلها test → DELETE FROM open_tasks WHERE status IN ('open', 'needs_follow_up');
```

> **⚠️ تحذير أحمر:** `open_tasks` ممكن يكون فيه مهام حقيقية. شيك قبل الحذف.

---

## 🔐 خطوات السلامة (لازم تتبع قبل أي حذف)

### الخطوة ١: Backup
```bash
# قبل أي شيء — خذ dump
pg_dump "postgresql://golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging" > /tmp/golden_crm_staging_backup_$(date +%F_%H-%M).sql
```

### الخطوة ٢: Transaction + Rollback test
```sql
BEGIN;

-- نفذ كل DELETE statements هون
-- (انسخهم كلن من فوق)

-- بعدين شيك العدادات:
SELECT COUNT(*) FROM marketing_visits;
SELECT COUNT(*) FROM field_visits;
SELECT COUNT(*) FROM open_tasks;

-- إذا كلشي تمام:
-- COMMIT;

-- إذا في خطأ:
-- ROLLBACK;
```

### الخطوة ٣: Reset sequences (اختياري)
```sql
-- بعد الحذف الناجح:
SELECT setval('marketing_visits_id_seq', 1, false);
SELECT setval('marketing_visit_tasks_id_seq', 1, false);
SELECT setval('field_visits_id_seq', 1, false);
SELECT setval('visit_tasks_id_seq', 1, false);
SELECT setval('contact_targets_id_seq', 1, false);
-- إلخ...
```

---

## 🔍 Verification بعد الحذف

```sql
-- لازم هدول يكونوا 0:
SELECT 'marketing_visits' as table_name, COUNT(*) as cnt FROM marketing_visits
UNION ALL SELECT 'marketing_visit_tasks', COUNT(*) FROM marketing_visit_tasks
UNION ALL SELECT 'field_visits', COUNT(*) FROM field_visits
UNION ALL SELECT 'visit_tasks', COUNT(*) FROM visit_tasks
UNION ALL SELECT 'contact_targets', COUNT(*) FROM contact_targets
UNION ALL SELECT 'telemarketing_appointments', COUNT(*) FROM telemarketing_appointments
UNION ALL SELECT 'telemarketing_task_lists', COUNT(*) FROM telemarketing_task_lists;

-- لازم هدول يضلّوا > 0 (core system):
SELECT 'clients' as table_name, COUNT(*) as cnt FROM clients
UNION ALL SELECT 'contracts', COUNT(*) FROM contracts
UNION ALL SELECT 'branches', COUNT(*) FROM branches
UNION ALL SELECT 'hr_users', COUNT(*) FROM hr_users
UNION ALL SELECT 'task_type_config', COUNT(*) FROM task_type_config;
```

---

## 🎯 ملخص سريع (للـ Claude/Code)

**حذف:**
1. `marketing_visit_task_offers` → `marketing_visit_tasks` → `marketing_visits`
2. `visit_task_*_results` → `visit_task_results` → `visit_tasks` → `field_visits`
3. `open_task_device_*_results`
4. `telemarketing_call_logs` → `telemarketing_appointments` → `telemarketing_task_list_items` → `telemarketing_task_lists`
5. `contact_targets`
6. `task_activity_log` (اختياري)
7. `open_tasks` (بحذر — فقط يلي confirmed test)

**لا تلمس:**
`clients`, `contracts`, `branches`, `geo_units`, `routes`, `route_points`, `hr_users`, `employees`, `roles`, `permissions`, `task_type_config`, `device_models`, `system_lists`, `client_assignments`.

**قبل الحذف:**
Backup + BEGIN transaction + SELECT counts + COMMIT فقط بعد التأكد.
