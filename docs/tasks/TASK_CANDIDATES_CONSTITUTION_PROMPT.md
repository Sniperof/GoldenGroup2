# Prompt: Domain Constitution for Candidates (المرشحون)

## Objective

Build the **complete, authoritative Domain Constitution** for the `candidates` entity in Golden CRM. Follow the exact same template and quality standard established by the `clients` pilot (`docs/constitution/domains/clients.md`).

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, policies, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/candidates.md` — The full Candidates constitution
2. Update `docs/constitution/INDEX.md` — Add candidates row to the domains table
3. Update `docs/constitution/CROSS-REFERENCE.md` — Add candidates fields to shared fields / relationships
4. If new gaps discovered: `docs/constitution/GAPS-TRACKER.md` — Add GAP-007, GAP-008, etc.

---

## Step 1: Read ALL Source Files

Read these files in order. Do NOT skip any.

### A. Database Schema (Migrations)
Read EVERY migration file that touches the `candidates` table:

```
migrations/001_core_tables.sql          (CREATE TABLE candidates — baseline)
migrations/007_candidates_missing_columns.sql  (ALTER TABLE candidates — what was added?)
migrations/014_branch_id_domain_tables.sql
migrations/021_candidates_authorization_enablement.sql
migrations/034_candidate_name_lists_permissions.sql
migrations/042_assignments_m2m.sql       (candidate_assignments junction table)
migrations/054_permissions_allowed_scopes.sql
migrations/111_referral_sheets_target_candidates.sql
```

For each, extract:
- Columns added/modified
- Constraints (CHECK, FK, UNIQUE, NOT NULL, DEFAULT)
- Indexes created
- Data migrations performed

### B. API Layer
```
packages/api/routes/candidates.ts          (ALL endpoints, validation, SQL columns)
packages/api/policies/candidatePolicy.ts   (permissions + scope rules)
packages/api/services/customerOwnership.ts (if touches candidates — check!)
```

### C. Shared Types
```
packages/shared/types.ts                (any Candidate-related interfaces)
packages/shared/types/authorization.ts  (scope enums)
```

### D. System Configuration
```
migrations/021_candidates_authorization_enablement.sql
migrations/034_candidate_name_lists_permissions.sql
migrations/054_permissions_allowed_scopes.sql
```

**CRITICAL NOTE:** Candidates have **TWO permission namespaces**:
1. `candidates.*` — standard CRUD permissions
2. `candidates.name_lists.*` — used by referral sheets (name list management)

Document BOTH and explain when each is used.

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/candidates.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: المرشح
- **الاسم الإنجليزي**: Candidate
- **اسم الجدول**: `candidates`
- **الوصف**: [اكتب بناءً على الكود — شو بيمثل المرشح بالنظام؟ شو الفرق بينو وبين Client؟]
- **الجداول المرتبطة**: referral_sheets, clients (via converted_to_lead_id), candidate_assignments, hr_users, branches...
- **الأهمية**: كيان تسويقي/تشغيلي — بيتحول لـ Client (زبون) عند الشراء أو الترشيح الناجح.
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

Build the **complete field dictionary**.

**CRITICAL:** Candidates table has a CHECK constraint on `status`! Document it precisely.

Also document:
- `duplicate_flag`, `duplicate_type`, `duplicate_reference_id` — duplicate detection system
- `converted_to_lead_id` — conversion to client
- `referral_confirmation_status` — what values does it take? (check migration 007)
- `candidate_notes` vs `notes` (if exists)
- `owner_user_id` — is this legacy like `assigned_hr_user_id` on clients? Or actively used?
- `branch_id` — which branch "owns" this candidate?

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

Document at minimum:

#### BR-1: Status State Machine
Candidates have a CHECK constraint on `status` with values: `'New', 'Suggested', 'FollowUp', 'Contacted', 'Qualified', 'Junk'`.
Document what each state means, who can transition to whom, and which transitions are allowed.

#### BR-2: Duplicate Detection System
```
duplicate_flag: BOOLEAN
duplicate_type: VARCHAR(50)
duplicate_reference_id: INTEGER
```
What triggers duplicate detection? What values can `duplicate_type` take? What happens when a duplicate is found?

#### BR-3: Conversion to Client (Lead Conversion)
```
converted_to_lead_id → clients.id
is_candidate (on clients) = TRUE
candidate_status (on clients) = 'New' / 'OP' / 'FOP'
```
How does a candidate become a client? Which endpoint triggers this? Is it automatic or manual?

#### BR-4: Candidate Ownership vs Client Ownership
Candidates use `owner_user_id` (single owner) + `candidate_assignments` (M2M).
Clients use `client_assignments` (M2M) only.
Is `owner_user_id` legacy or still functional? Document the discrepancy.

#### BR-5: Referral Sheet Linkage
candidates have `referral_sheet_id` — they come FROM a referral sheet.
Document how candidates are created from referral sheets vs manually.

---

### Section 4: العلاقات (Relationships)

Include ER diagram (mermaid) showing:
```
candidates }o--|| referral_sheets : "comes from"
candidates ||--o| clients : "converts to (via converted_to_lead_id)"
candidates }o--|| branches : "belongs to"
candidates ||--o{ candidate_assignments : "assigned to"
candidates }o--|| hr_users : "created by"
```

---

### Section 5: آلة الحالات (State Machine)

Document the FULL candidate lifecycle state machine:

```
[Suggested] → (Contacted) → [Qualified] → [Converted to Client]
   │              │              │
   │              ▼              ▼
   │           [Junk]       [Lost/Inactive]
   │
   └───► [New] (manual entry)
```

Also document:
- `referral_confirmation_status` — what are its states? (Pending, Confirmed, Rejected? Check migrations!)
- `duplicate_flag` — how does it affect visibility?

---

### Section 6: صلاحيات الوصول (Permission Matrix)

**CRITICAL — TWO namespaces:**

| الإذن | المفتاح | النطاق | الوصف |
|---|---|---|---|
| عرض قائمة المرشحين | `candidates.view_list` | GLOBAL, BRANCH, ASSIGNED | عرض قائمة المرشحين |
| عرض تفاصيل مرشح | `candidates.view` | GLOBAL, BRANCH, ASSIGNED | تفاصيل مرشح |
| إنشاء مرشح | `candidates.create` | GLOBAL, BRANCH | إضافة مرشح |
| تعديل مرشح | `candidates.edit` | GLOBAL, BRANCH, ASSIGNED | تعديل |
| حذف مرشح | `candidates.delete` | GLOBAL, BRANCH | حذف |
| عرض لائحة أسماء | `candidates.name_lists.view_list` | ? | خاص بـ referral sheets |
| إنشاء لائحة أسماء | `candidates.name_lists.create` | ? | خاص بـ referral sheets |
| تعديل لائحة أسماء | `candidates.name_lists.edit` | ? | خاص بـ referral sheets |

Document which namespace is used by `candidates.ts` route and which is used by `referralSheets.ts` route.
Check `candidatePolicy.ts` for the actual scope logic.

---

### Section 7: عقد API (API Contract)

**CRITICAL:** The candidates route has **4 endpoints only** (no GET /:id!):

| الطريقة | المسار | الصلاحية | وصف |
|---|---|---|---|
| GET | `/api/candidates` | `candidates.view_list` | قائمة المرشحين |
| POST | `/api/candidates` | `candidates.create` | إنشاء مرشح |
| PUT | `/api/candidates/:id` | `candidates.edit` | تعديل مرشح |
| DELETE | `/api/candidates/:id` | `candidates.delete` | حذف مرشح |

**NO GET /:id endpoint exists!** Document this as a gap if the detail view is needed but missing.

Also check: is there a smart-match like clients? Is there bulk-delete? Is there conversion endpoint?

---

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐ COMPREHENSIVE

Include at minimum:

| # | السيناريو | Method | Inputs | Expected |
|---|---|---|---|---|
| TC-01 | إنشاء مرشح صحيح | POST / | {firstName, lastName, mobile, status} | 200 + candidate |
| TC-02 | إنشاء مرشح بدون mobile | POST / | بدون mobile | 400 |
| TC-03 | إنشاء مرشح بحالة غير صالحة | POST / | status: 'Invalid' | 400 أو 500 (CHECK constraint) |
| TC-04 | تعديل status إلى Junk | PUT /:id | {status: 'Junk'} | 200 |
| TC-05 | حذف مرشح محول لزبون | DELETE /:id | converted_to_lead_id NOT NULL | 400 (منع الحذف) |
| TC-06 | عرض قائمة بحسب branch | GET /?branchId=3 | — | يعيد بس فرع 3 |
| TC-07 | عرض ASSIGNED scope | GET / | user ASSIGNED فقط | يعيد المسندين له فقط |
| TC-08 | duplicate_flag = true | GET / | — | هل المرشح المكرر بيظهر للكل؟ |
| TC-09 | conversion trigger | POST / (or PUT /:id?) | convertedToLeadId | 200 + client created? |
| TC-10 | تعديل referral_sheet_id | PUT /:id | referralSheetId changed | 200 + validation |

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

Look for and document:

1. **NO GET /:id endpoint** — Does the frontend show candidate details? How? Via list only?
2. **owner_user_id vs candidate_assignments** — Similar to clients `assigned_hr_user_id` legacy issue. Is `owner_user_id` still used or replaced by M2M?
3. **Status CHECK vs frontend expectations** — Are all 6 status values used by the UI?
4. **Any missing constraints** — Like `referral_confirmation_status` with no CHECK constraint?
5. **Permission scope allowed_scopes.sql** — Does `candidates.*` support ASSIGNED scope in DB? Or blocked like clients was?
6. **Duplicate system** — How does `duplicate_type` get set? What values? Any CHECK constraint?
7. **Conversion mechanism** — Is there an explicit API endpoint for "convert candidate to client"? Or is it implicit?

---

### Section 10: تاريخ التغييرات (Schema Changelog)

Document every migration that touched `candidates` with date, filename, and change description.

---

## Step 3: Update Supporting Files

After writing `candidates.md`, update these files:

### INDEX.md
Add row to the domains table:
```
| المرشحون (Candidates) | [domains/candidates.md](domains/candidates.md) | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
Add `candidates` to relevant sections:
- Shared fields (branch_id, status, created_at, created_by)
- Entity Relationships (candidates → referral_sheets, candidates → clients)
- Table Inventory (row for candidates)

### GAPS-TRACKER.md
If any new gaps found (GAP-007, GAP-008...), add them following the exact same format as GAP-001 through GAP-006.

---

## Verification Checklist

Before committing, verify:

- [ ] `candidates.md` contains all 10 sections above
- [ ] Every field in `CREATE TABLE candidates` + `ALTER TABLE candidates` is documented
- [ ] CHECK constraint on `status` documented with all 6 values
- [ ] `duplicate_flag` system documented
- [ ] `converted_to_lead_id` conversion mechanism documented
- [ ] Both permission namespaces (`candidates.*` + `candidates.name_lists.*`) documented
- [ ] At least 10 functional test cases defined
- [ ] Permission matrix test cases defined
- [ ] At least 3 gaps/contradictions identified (or "None found" if truly clean)
- [ ] INDEX.md updated with candidates row
- [ ] CROSS-REFERENCE.md updated
- [ ] GAPS-TRACKER.md updated (if new gaps)
- [ ] `pnpm --filter @golden-crm/api exec tsc --noEmit` passes
- [ ] `pm2 restart golden-crm-staging` succeeds
- [ ] Git commit: `docs(constitution): complete candidates domain constitution`

---

## Notes for the Executor

1. **Do NOT invent fields.** If a field exists in the DB but not in the route SELECT, document it and note "Present in DB but not exposed via API".
2. **Do NOT skip migrations.** Read EVERY migration that alters `candidates`.
3. **Do NOT trust comments in code.** The code itself is the truth.
4. **If you find a contradiction**, document it in Section 9. Do NOT try to resolve it.
5. **Candidates have NO GET /:id.** This is likely a real gap — document it.
6. **Check if `owner_user_id` is legacy.** Compare with `clients.assigned_hr_user_id` (GAP-004).
7. **Use exact SQL types** from migrations.
8. **Examples must be realistic** for a Syrian CRM context.
