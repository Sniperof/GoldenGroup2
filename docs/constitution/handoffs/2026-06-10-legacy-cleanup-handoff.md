# Handoff — تنظيف Legacy + هجرة telemarketing_appointments (2026-06-10)

> **الجلسة:** 2026-06-10 (ليلة 21:30 — 23:30 UTC)
> **صاحب المنتج:** Ibrahim Obaid
> **الـ owner:** Claude Opus 4.7
> **الـ commits:** `59aa8ad`, `dc1b2f6`, `be52055` على `main` (5 commits متقدمة على `origin/main`)

---

## 1. السياق

بدأت الجلسة بإصلاح مشاكل اعتماد العقد (TypeError في `/approve`، أخطاء constraint، خطأ "لا يمكن اعتماد العقد بدون سبب") ثم توسّعت لجلسة تنظيف legacy منهجية بناءً على [CROSS-REFERENCE.md §6](../CROSS-REFERENCE.md#6-الجداول-اللي-لساتون-legacy-أو-deprecated).

نقطة الانطلاق: 4 عناصر مُعلَّمة Legacy (`tasks`, `visits`, `marketing_visits`, `assigned_hr_user_id`) + 3 معلَّمة legacy في وثائق أخرى (`visit_name_collections`, `telemarketing_appointments`, `emergency_*`).

---

## 2. القرارات المتخذة في الجلسة

| القرار | المرجع |
|---|---|
| ❌ `emergency_*` خارج النطاق — جلسة مستقلة | تعليمات Ibrahim |
| ✅ `clients.assigned_hr_user_id` تُسقَط فوراً (0 بيانات، 0 قراءات) | حُسم بعد شرح الـ legacy |
| ✅ `tasks` + `visits` يُفصلان من الـ frontend/routes الآن، الجدول يُترك لـ soak | تشخيص: شاشات مفعَّلة لكن مخفية من Sidebar منذ 2026-06-01 |
| ✅ `visit_name_collections` workflow يُغلق (modal يتيم + 3 endpoints) | DEC-007 D40/D41 |
| ⛔ `telemarketing_appointments` لا يُلمَس فوراً — يحتاج plan كامل | "سجل audit immutable" — handoff 2026-05-12 §77 |
| ✅ بعد plan: ندخل Phase 0-2 (هجرة بيانات + إيقاف writes + هجرة reads) | قرار Ibrahim بعد قراءة الـ plan |
| 🗑️ DROP في Phase 5 ضمن النطاق (بعد أرشفة آمنة) | قرار Ibrahim |
| ❌ لا candidates في حجوزات الميدان | قرار Ibrahim — قرار منتج جديد |

---

## 3. ما تم تنفيذه (3 commits)

### Commit `59aa8ad` — إصلاحات اعتماد العقد + UX

**المشكلة:** اعتماد المسودة كان يفشل بـ TypeError ثم بأخطاء قاعدة بيانات متتالية. النموذج كان يُسمح فيه بحفظ مسودات بدون مالية، فيفشل الاعتماد لاحقاً.

**الإصلاحات:**
- `getOrBuildAuthContext` مُصدَّر من `permission.ts` ويُستدعى يدوياً في `/approve` و `/reject` (لأنهما يتخطّيان `requirePermission` لتقبل `contracts.approve OR contracts.close`)
- `collectApprovalIssues()` server-side validator يطابق `validationIssues` في الـ form
- إصلاح اسم جدول: `customers` → `clients` في فحص الحقول القانونية
- إزالة فلتر `confirmed` على `contract_payment_entries` (العمود غير موجود)
- إخفاء "قسم تسكير العقد" من النموذج — التسكير الآن حصراً عبر ContractDetail
- جعل المالية إلزامية لحفظ المسودة (سداد كاش = الإجمالي، أقساط مؤكَّدة)
- مكوّن `Section`: `overflow-hidden` يُطبَّق فقط أثناء الأنيميشن (قوائم الزبائن/الأجهزة تظهر فوق Sections التالية)
- استبدال `alert()` بـ dialog منسجم مع RTL يعرض issues و detail
- migration 268: `device_delivery` uniqueness من per-client إلى per-contract

**ملفات:** `contracts.ts`, `permission.ts`, `ContractForm.tsx`, `ContractDetail.tsx` + migration 268.

### Commit `dc1b2f6` — تنظيف Legacy (3 دفعات)

**Batch A:** DROP `clients.assigned_hr_user_id` عبر migration 269
- 0/88 صف يستخدمه، 0 dependencies DB، 0 قراءات كود
- backup مأخوذ في `db-snapshots/clients_before_269_*.sql` (محلي)

**Batch B:** فصل `tasks` + `visits` legacy
- حذف 4 شاشات: TodaysTasks, Periodic, Returns, FollowUp
- حذف Customer360Modal (يتيم بعد حذف الشاشات الـ 3)
- إزالة 4 routes من App.tsx + imports
- إزالة `api.tasks` و `api.visits` من lib/api.ts
- تعليق `app.use('/api/tasks',...)` و `app.use('/api/visits',...)` في api/index.ts
- ترحيل `TelemarketerWorkspace` timeline من `api.visits.list()` (bulk) إلى `api.fieldVisits.list({clientId})` (per-customer)
- **الجداول DB لم تُسقَط بعد** — تنتظر 14 يوم staging

**Batch C:** فصل `visit_name_collections` workflow
- حذف NameCollectionModal.tsx (يتيم)
- حذف 3 API wrappers (createNameCollection/recordNames/getNameCollection)
- 3 backend endpoints تردّ 410 Gone (handler bodies الـ 285 سطر محذوفة)
- **الجدول DB لم يُسقَط بعد** — ينتظر 14 يوم staging

### Commit `be52055` — `telemarketing_appointments` Phase 0-2

**Phase 0:** migration 270 رحَّلت 3 صفوف تاريخية إلى `field_visits`:
- IDs الجديدة في field_visits: 7, 8, 9
- `source_legacy_id` يربط بـ UUID الأصلي
- `status='cancelled'` (مرّت 17 يوم بدون تنفيذ)
- `team_snapshot = {teamKey:'team_0'}` (مختلف عن الـ shape الحديث الذي يحوي employee IDs)
- visit_tasks مرتبطة بـ `source_open_task_id`

**Phase 1:** إيقاف الكتابة
- `useTelemarketingStore.ts:138-148`: فرع candidates يرفع error واضح
- `api.telemarketing.createAppointment` محذوف
- `POST /api/telemarketing/appointments` → 410 (315 سطر handler محذوف)
- `clients.ts:1689`: UPDATE ميت محذوف (العمود `status` غير موجود)

**Phase 2:** ترحيل القراءات
- `contactTargets.ts:101` LATERAL يقرأ field_visits بدل telemarketing_appointments
- `planningMarketingTargets.ts:644` نفس النمط
- `openTasks.ts:3583` fallback chain مُختصَر (open_task_devices: 24/24 reliability)
- `telemarketing.ts:866` snapshot: الـ legacy query + merge dedupe محذوفان

**الـ Plan:** [`plans/2026-06-10-telemarketing-appointments-migration.md`](../plans/2026-06-10-telemarketing-appointments-migration.md) محدَّث بقرارات Ibrahim ونتائج الفحوصات الفنية.

---

## 4. ⚠️ ما يجب العمل عليه لاحقاً (Action Items)

### 🔴 P0 — مهم: Soak Window

| العنصر | تاريخ بدء soak | تاريخ السماح بـ DROP | المالك |
|---|---|---|---|
| `tasks` + `visits` tables | 2026-06-10 | **2026-06-24** | جلسة Claude |
| `visit_name_collections` table | 2026-06-10 | **2026-06-24** | جلسة Claude |
| `telemarketing_appointments` Phase 3 → 4 | 2026-06-10 | **2026-06-24** | جلسة Claude |

### 🔴 P0 — مراقبة Soak

استعلام للمراقبة الدورية (يُرجَى تشغيله 1× أسبوعياً):

```sql
SELECT relname, n_live_tup, n_tup_ins, n_tup_upd, n_tup_del,
       seq_scan, idx_scan, last_vacuum, last_analyze
FROM pg_stat_user_tables
WHERE relname IN ('tasks', 'visits', 'visit_name_collections', 'telemarketing_appointments')
ORDER BY relname;
```

**Baselines المتوقعة (يجب ألا تتقدم):**
- `tasks`: n_live_tup=0, آخر n_tup_ins تاريخي
- `visits`: n_live_tup=0, آخر n_tup_ins تاريخي
- `visit_name_collections`: n_live_tup=0
- `telemarketing_appointments`: n_live_tup=3, n_tup_ins=28, n_tup_upd=0, n_tup_del=6, idx_scan=7128, seq_scan=145

أي تقدّم في `n_tup_ins` أو `idx_scan` يكشف مرجعاً مفقوداً في الكود.

### 🟡 P1 — Phase 4: تجميد `telemarketing_appointments`

بعد 2026-06-24 إذا نجح soak. الـ migration المقترَحة:

```sql
-- migrations/273_freeze_telemarketing_appointments_readonly.sql

CREATE OR REPLACE FUNCTION reject_legacy_telemarketing_appointments_writes()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'telemarketing_appointments is frozen read-only (2026-06-10 plan §Phase 4). '
                   'Use POST /api/telemarketing/book-visit instead (DEC-003 D2).';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_telemarketing_appointments_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON telemarketing_appointments
  FOR EACH ROW EXECUTE FUNCTION reject_legacy_telemarketing_appointments_writes();

COMMENT ON TABLE telemarketing_appointments IS
  'READ-ONLY AUDIT — frozen 2026-06-24. New bookings use field_visits '
  '(origin_type=telemarketing). See plans/2026-06-10-telemarketing-appointments-migration.md';
```

### 🟡 P1 — Migrations 271, 272 (DROP الـ 4 جداول الأخرى)

```sql
-- migrations/271_drop_legacy_tasks_and_visits.sql
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS visits;
DELETE FROM permissions WHERE key IN
  ('tasks.view_list', 'tasks.create', 'tasks.edit', 'tasks.delete');
-- ملاحظة: tasks.activation.*, tasks.delivery.*, tasks.installation.*
-- و marketing_visits.view و marketing_visits.update_result تبقى
-- (مُستخدَمة من open_tasks و emergencyResult.ts على التوالي)

-- migrations/272_drop_visit_name_collections.sql
DROP TABLE IF EXISTS visit_name_collections;
-- تنظيف الستوبس الـ 3 في routes/fieldVisits.ts (3 endpoints 410) — اختياري
-- يمكن إبقاؤها لأن any caller يحصل على 410 واضح
```

كذلك حذف ملفي `routes/tasks.ts` و `routes/visits.ts` من القرص (لم يكونا mounted بعد commit dc1b2f6).

### 🟢 P2 — Phase 5: DROP `telemarketing_appointments` (شهر بعد Phase 4)

```sql
-- migrations/274_drop_telemarketing_appointments.sql
-- شرط: 30 يوم بعد migration 273
-- backup مسبق: pg_dump --table=telemarketing_appointments → archive
DROP TABLE telemarketing_appointments;
DROP TRIGGER IF EXISTS trg_telemarketing_appointments_frozen ON telemarketing_appointments;
DROP FUNCTION IF EXISTS reject_legacy_telemarketing_appointments_writes();
```

### 🟢 P2 — تحديث الدستور بعد كل DROP

| ملف | التغيير |
|---|---|
| `CROSS-REFERENCE.md §6` | تحديث الحالة من 🟡 إلى ✅ DROPped |
| `domains/telemarketing.md §2.4` | إضافة فقرة "Migration history" + إزالة schema |
| `domains/clients.md` | إزالة سطر `tasks` legacy + visits legacy إن وُجدا |
| `handoffs/2026-05-12-p1-p4-findings-handoff.md` | السطر 77: تغيير "legacy prefix يبقى تقنياً" إلى "archived 2026-XX-XX" |

---

## 5. blockers مكتشفة في الجلسة ومحلولة

| Blocker | الحالة | الحل |
|---|---|---|
| `customer_snapshot` يفقد `occupation/waterSource`؟ | ✅ محلول تلقائياً | `lib/snapshots.ts:127-128` يكتبهما؛ DB أكدت 6/6 صفوف بهما |
| متى يُسلَك المسار القديم في `useTelemarketingStore.ts:138`؟ | ✅ محلول | `entityType==='candidate'` حصراً — اتُّخذ قرار رفضه |
| `open_task_devices` يتعبأ دائماً؟ | ✅ محلول | 24/24 device_demo tasks لها صف device. 0 orphans |
| الـ 3 صفوف الحيّة — تُهاجَر؟ | ✅ محلول | تم ترحيلها كـ field_visits cancelled |
| `team_snapshot` shape مختلف بين الجدول القديم والحديث | ⚠️ ملحوظ | `team_snapshot->>'teamKey'` يرجع NULL للزيارات الحديثة، لكن `latestAppointment` غير مستهلَك في الـ frontend — لا أثر مرئي |

---

## 6. أرقام المراجع

### Commits
- `59aa8ad fix(contracts): approval flow + form UX + per-contract delivery uniqueness`
- `dc1b2f6 chore(legacy): retire assigned_hr_user_id column, tasks/visits, name-collection`
- `be52055 refactor(telemarketing): migrate telemarketing_appointments — Phase 0-2`

### Migrations المُطبَّقة
- `268_allow_per_contract_device_delivery_tasks.sql`
- `269_drop_clients_legacy_assigned_hr_user_id.sql`
- `270_migrate_historic_telemarketing_appointments.sql`

### الـ Plans والـ Handoffs المُحدَّثة/المُنشأة
- ✏️ `CROSS-REFERENCE.md §6` (مُحدَّث)
- 🆕 `plans/2026-06-10-telemarketing-appointments-migration.md`
- 🆕 `handoffs/2026-06-10-legacy-cleanup-handoff.md` (هذا الملف)

### Backups محلية (غير مدفوعة لـ git)
- `db-snapshots/clients_before_269_20260610_215252.sql` (123KB)
- `db-snapshots/golden_crm_staging_pre_legacy_cleanup_20260610_220638.dump` (641KB، 1225 كائن)

---

## 7. نقاط للجلسة التالية

عند فتح جلسة بعد 2026-06-24:

1. تشغيل استعلام soak في §4 — إذا كانت الأرقام ثابتة، نتابع
2. تنفيذ migration 271 + 272 + 273 (3 migrations منفصلة، كل واحدة في commit مستقل)
3. حذف ملفات `routes/tasks.ts` و `routes/visits.ts`
4. تحديث CROSS-REFERENCE.md §6 (🟡 → ✅)
5. الانتظار 30 يوم إضافياً قبل migration 274 (Phase 5 DROP telemarketing_appointments)

عند الـ commit الموازي لـ migration 273-274 يجب إجراء `pg_dump --table` خاص لـ telemarketing_appointments وحفظه في archive خارجي (S3 / مجلد separate)، **ليس** في الـ repo.
