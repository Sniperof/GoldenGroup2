Complete picture. Here's the analysis before writing:

**Schema facts relevant to reset:**
- `hr_users.branch_id` → `branches(id)` ON DELETE **RESTRICT** — cannot delete branches that have hr_users pointing to them
- Many tables (`employees`, `candidates`, `contracts`, etc.) → `branches(id)` ON DELETE **RESTRICT** — cannot delete branches with data
- `user_branch_assignments.user_id` → ON DELETE **CASCADE** — safe, auto-cleaned if we delete users; but we'll deactivate instead
- `referral_sheets.assigned_hr_user_id` → ON DELETE **SET NULL** — safe
- `role` column in hr_users = denormalized text copy — must keep in sync with `role_id`
- Password: `bcrypt.hash(password, 10)` + `bcrypt.compare()` — both go against `password_hash`
- `branches.status` accepts `'active'` | `'inactive'`

**Decisions:**
| Item | Strategy | Why |
|---|---|---|
| Old users | `is_active = FALSE` | FK constraints + audit trail |
| Old branches | `status = 'inactive'` | ON DELETE RESTRICT from many tables |
| Old roles | `is_hidden = TRUE` | Don't break historical data, just hide from UI |
| user_branch_assignments | Deactivate assignments for inactive users | Clean `status = 'inactive'` |
| Cache | `clearPermissionCache()` inside script | No restart needed if server running |

Now typecheck the new script:

Clean. Let me do a quick logic review of the script's critical paths:

Script is solid. Let me verify the dev-reset-auth-users.ts still compiles (since it uses the same pool and bcrypt pattern):

That error is from passing a bare filename to tsc without the project config — it ignores `tsconfig.json`. The full project check already passed:

```
cd packages/api && npx tsc --noEmit → API OK
```

The script is included in the project's `tsconfig.json` files glob, so it compiles correctly. The individual file invocation is a non-issue.

Let me do one final cross-check — confirm no leftover issues in the full repo:

Exit code 1 is from `grep` finding no matches (no errors after filtering the npm warn). The actual TypeScript output is clean. Confirmed by the individual package checks above.

---

## تقرير Phase Z0.2

### تحليل ما تم

| السؤال | الجواب |
|---|---|
| هل البيئة آمنة؟ | Script يتحقق من `APP_ENV` + `NODE_ENV` + `DATABASE_URL` — يوقف على `production`/`prod`/`staging` |
| هل SYSTEM_ADMIN موجود؟ | Script يتحقق من وجوده + `is_template` + `is_protected` + `is_hidden` + GLOBAL grants قبل أي تعديل |
| Delete أم Deactivate؟ | **Deactivate** للمستخدمين (`is_active = FALSE`) وللفروع (`status = 'inactive'`) — ON DELETE RESTRICT على branches يجعل الحذف خطيراً |
| الجداول التي ستُلمس | `hr_users`, `user_branch_assignments`, `branches`, `roles` — فقط DML بدون DDL |
| الفروع القديمة | `status = 'inactive'` — البيانات محفوظة والـ FKs سليمة |
| Password hashing | `bcrypt.hash(password, 10)` — نفس المنطق المستخدم في login |

---

### الملف المنشأ

```
packages/api/dev-reset-single-superadmin.ts
```

**تشغيله:**
```bash
cd packages/api && tsx dev-reset-single-superadmin.ts
```

---

### ما يفعله الـ Script (بالترتيب)

| الخطوة | الإجراء |
|---|---|
| 0 | تحقق من البيئة — يوقف على production |
| 1 | تحقق من SYSTEM_ADMIN: exists + is_template + is_protected + is_hidden + GLOBAL grants |
| 2 | `UPDATE hr_users SET is_active = FALSE WHERE username != 'superadmin'` |
| 3 | `UPDATE user_branch_assignments SET status = 'inactive'` للمستخدمين المعطلين |
| 4 | `UPDATE roles SET is_hidden = TRUE WHERE is_system = FALSE` |
| 5 | Ensure فرع دمشق (INSERT أو UPDATE status = 'active') |
| 6 | `UPDATE branches SET status = 'inactive' WHERE id != damascus_id` |
| 7 | `bcrypt.hash('Password123!', 10)` |
| 8 | Upsert superadmin: INSERT أو UPDATE — `is_super_admin = TRUE, role = 'SYSTEM_ADMIN'` |
| 9 | `user_branch_assignments: superadmin → فرع دمشق (is_primary=true, active)` ON CONFLICT DO UPDATE |
| 10 | COMMIT — ثم verification queries |

---

### بيانات الدخول بعد التنفيذ

```
username   : superadmin
password   : Password123!
role       : SYSTEM_ADMIN (template, protected, hidden)
is_super   : true
branch     : فرع دمشق (is_primary=true)
```

---

### معايير القبول

| المعيار | النتيجة |
|---|---|
| active user واحد فقط | ✅ script يتحقق ويُحذّر |
| هذا المستخدم super admin | ✅ `is_super_admin = TRUE` |
| `role_id` → SYSTEM_ADMIN template | ✅ `role_id = systemAdminRoleId` |
| SYSTEM_ADMIN محمي ومخفي | ✅ تحقق قبل التنفيذ، بدون تغيير |
| فرع دمشق موجود | ✅ INSERT or reuse |
| assignment primary على دمشق | ✅ ON CONFLICT DO UPDATE |
| لا clone roles لأي active user | ✅ superadmin → SYSTEM_ADMIN (template) فقط |
| لا business roles مفروضة | ✅ roles قديمة is_hidden = TRUE |
| permissions catalog سليم | ✅ لا يُلمس |
| password بالهاش | ✅ bcrypt 10 rounds |
| لا كسر FK | ✅ deactivate بدل delete |
| typecheck | ✅ API OK + WEB OK |