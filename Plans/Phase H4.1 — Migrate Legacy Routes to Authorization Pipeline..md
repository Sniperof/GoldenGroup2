## التحليل

Let me verify the current state of all legacy routes first.

**تحليل:**
- **7 استخدامات متبقية** فقط في contracts (3), tasks (3), departments (1) — تأكيد مطابق
- **Permissions جديدة مطلوبة:** `contracts.view_list`, `contracts.edit`, `contracts.delete`, `tasks.view_list`, `tasks.edit`, `tasks.delete`, `departments.view_list`
- **لا policy helpers** مطلوبة — `authorize()` مباشرة في الـ handlers للـ mutations، و `authContext.actingBranchId` للـ list routes
- **Migration 027** لـ seeding كل الـ 7 permissions

Let me read the complete current state of these files:

Now I have the full picture. Let me implement all changes.

### `contracts.ts` — Full rewrite of the 3 legacy handlers

### `tasks.ts` — Full rewrite of the 3 legacy handlers

### `departments.ts` — Migrate GET /

Now check if `requireAuth` import is still needed in departments.ts:

Good — `requireAuth` is still used in `GET /:id`, so the import stays.

### Migration 027 — Seed the 7 new permissions

### TypeCheck + Final Verification

TypeCheck ✅ — لا أخطاء. لا يوجد أي `req.scope` في routes.

---

## تقرير ما بعد التنفيذ

**الملفات المعدلة:**

| الملف | التغييرات |
|-------|-----------|
| [`contracts.ts`](packages/api/routes/contracts.ts) | GET → `requirePermission('contracts.view_list')` + `authContext`; PUT/DELETE → `requirePermission` + `authorize()` مع `branchId` |
| [`tasks.ts`](packages/api/routes/tasks.ts) | نفس النمط: `tasks.view_list`, `tasks.edit`, `tasks.delete` |
| [`departments.ts`](packages/api/routes/departments.ts) | GET / → `requirePermission('departments.view_list')` + `authContext` |
| [`migrations/027_...sql`](migrations/027_contracts_tasks_departments_permissions_seeding.sql) | Seeding لـ 7 permissions جديدة لجميع template roles بـ `BRANCH` scope |

**استخدامات `req.scope` المتبقية:** صفر — تأكيد بـ grep.

**Permissions المضافة:** `contracts.view_list`, `contracts.edit`, `contracts.delete`, `tasks.view_list`, `tasks.edit`, `tasks.delete`, `departments.view_list` — كلها في migration 027.

**TypeCheck:** ✅ نجح.

**نمط الـ mutations (PUT/DELETE):** بدل المقارنة القديمة `existing.branch_id !== scope.branchId` (تعمل فقط لـ single-branch users)، تم استخدام `authorize(authContext, { permission, branchId: existing.branch_id })` — وهذا يتعامل صحيح مع multi-branch users أيضاً.

**Risks/Follow-ups:** `departments.ts GET /:id` لا يزال يستخدم `requireAuth` فقط (لا branch check). هذا خارج نطاق هذه المرحلة ولم يُمس.