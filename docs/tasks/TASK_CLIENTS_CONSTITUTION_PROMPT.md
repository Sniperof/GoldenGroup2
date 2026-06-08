# Prompt: Pilot — Domain Constitution for Clients (الزبائن)

## Objective

Build the **complete, authoritative Domain Constitution** for the `clients` entity in Golden CRM. This is the **Pilot** that establishes the template for all 72 tables.

The output must be:
- **Comprehensive**: Every field, constraint, rule, relationship, state, test case documented.
- **Mixed language**: Arabic explanations, English field/code references.
- **Source-truthful**: Extracted directly from migrations, route handlers, policies, services, and shared types.
- **Critical**: Document ALL gaps, contradictions, or inconsistencies found between sources.

---

## Output Files

1. `docs/constitution/domains/clients.md` — The full Clients constitution
2. `docs/constitution/templates/entity-constitution.md` — Reusable template derived from this pilot

---

## Step 1: Read ALL Source Files

Read these files in order. Do NOT skip any.

### A. Database Schema (Migrations)
Read EVERY migration file that touches the `clients` table:

```
migrations/001_core_tables.sql          (CREATE TABLE clients — baseline)
migrations/004_column_additions.sql       (ALTER TABLE clients — what was added?)
migrations/008_spouse_occupation.sql    (ALTER TABLE clients — spouse_occupation)
migrations/009_data_quality.sql         (ALTER TABLE clients — data_quality)
migrations/010_client_gender.sql        (ALTER TABLE clients — gender)
migrations/011_client_contract_fields.sql
migrations/014_branch_id_domain_tables.sql
migrations/031_clients_assigned_hr_user_id.sql
migrations/041_clients_created_by.sql
migrations/042_assignments_m2m.sql      (client_assignments junction table)
migrations/049_cleanup_null_branch_telemarketing_data.sql
migrations/079_client_audit_and_soft_delete.sql
migrations/082_visit_name_collections.sql
migrations/083_direct_suggestions.sql
migrations/102_open_tasks_phase_zero_fields.sql
migrations/131_client_legal_fields.sql
migrations/167_snapshot_backfill.sql
```

For each, extract:
- Columns added/modified
- Constraints (CHECK, FK, UNIQUE, NOT NULL, DEFAULT)
- Indexes created
- Data migrations performed

### B. API Layer
```
packages/api/routes/clients.ts          (ALL endpoints, validation, SQL columns)
packages/api/policies/clientPolicy.ts   (permissions + scope rules)
packages/api/services/customerOwnership.ts  (ownership logic)
packages/api/services/clientLifecycleService.ts (if exists)
packages/api/middleware/permission.ts   (how permissions apply)
```

### C. Shared Types
```
packages/shared/types.ts                (any Client-related interfaces)
packages/shared/types/auth.ts           (relevant types)
packages/shared/types/authorization.ts  (scope enums)
```

### D. System Configuration
```
migrations/024_clients_permissions_seeding.sql
migrations/025_clients_role_grants_refinement.sql
migrations/043_clients_can_be_assigned_permission.sql
migrations/054_permissions_allowed_scopes.sql
```

---

## Step 2: Build the Constitution Document

Write `docs/constitution/domains/clients.md` with the following sections.

Use this language rule throughout:
> **عناوين السكاشن والشرح بالعربي. أسماء الحقول والأكواد بالإنجليزي.**

---

### Section 1: هوية الكيان (Identity)

```markdown
## 1. هوية الكيان (Entity Identity)

- **الاسم العربي**: الزبون / العميل
- **الاسم الإنجليزي**: Client
- **اسم الجدول**: `clients`
- **الوصف**: الكيان المركزي في النظام. يمثل شخصًا (فرد أو عائلة) له علاقة تجارية مع الشركة. كل العقود، الزيارات، المهام، والاتصالات مرتبطة به.
- **الجدولات المرتبطة**: contracts, visits, tasks, client_assignments, customer_call_logs, referral_sheets, open_tasks...
- **الأهمية**: Core entity — لا يمكن حذفه بشكل فعلي (soft-delete فقط).
```

---

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐ MOST IMPORTANT

Build the **complete field dictionary**.

For each field, extract from migrations + route code + shared types:

```markdown
## 2. قاموس الحقول (Field Dictionary)

### 2.1 الحقول الأساسية

| الحقل | النوع | NULL? | DEFAULT | Constraints | وصف | مثال |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` | ❌ | — | `PRIMARY KEY` | المعرف الفريد التسلسلي | `1542` |
| `name` | `VARCHAR(255)` | ❌ | — | — | الاسم الكامل (legacy) | `"أحمد علي"` |
| `first_name` | `VARCHAR(255)` | ✅ | — | — | الاسم الأول | `"أحمد"` |
| `father_name` | `VARCHAR(255)` | ✅ | — | — | اسم الأب | `"محمد"` |
| `last_name` | `VARCHAR(255)` | ✅ | — | — | اسم العائلة | `"علي"` |
| `mobile` | `VARCHAR(50)` | ❌ | — | — | رقم الموبايل الأساسي | `"0991234567"` |
| `contacts` | `JSONB` | ✅ | `'[]'` | — | قائمة أرقام إضافية | `[{"label": "بيت", "value": "0111234567"}]` |
| `governorate` | `VARCHAR(255)` | ✅ | `''` | — | المحافظة | `"دمشق"` |
| `district` | `VARCHAR(255)` | ✅ | `''` | — | المنطقة | `"المزة"` |
| `neighborhood` | `VARCHAR(255)` | ✅ | `''` | — | الحي | `"المزة فيلات"` |
| `detailed_address` | `TEXT` | ✅ | — | — | العنوان التفصيلي | `"بناية ٥، طابق ٢، شقة ٤"` |
| `gps_coordinates` | `JSONB` | ✅ | — | — | إحداثيات GPS | `{"lat": 33.5138, "lng": 36.2765}` |
| `gender` | `VARCHAR(10)` | ✅ | — | — | الجنس | `"Male"` / `"Female"` |
| `national_id` | `VARCHAR(255)` | ✅ | — | — | الرقم الوطني | `"12345678901"` |
| `birth_date` | `DATE` / `VARCHAR(50)` | ✅ | — | — | تاريخ الولادة | `"1990-05-15"` |
| `mother_name` | `VARCHAR(255)` | ✅ | — | — | اسم الأم | `"فاطمة"` |
| `national_id_registry` | `VARCHAR(255)` | ✅ | — | — | السجل المدني | `"دمشق"` |
| `national_id_issued_by` | `VARCHAR(255)` | ✅ | — | — | الجهة المصدرة | `"وزارة الداخلية"` |
| `national_id_issue_date` | `DATE` | ✅ | — | — | تاريخ الإصدار | `"2010-01-01"` |
| `national_id_box` | `VARCHAR(50)` | ✅ | — | — | رقم الدفتر | `"٥٤٢"` |
| `occupation` | `VARCHAR(255)` | ✅ | — | — | المهنة | `"مهندس"` |
| `spouse_occupation` | `VARCHAR(255)` | ✅ | — | — | مهنة الزوج/ة | `"معلمة"` |
| `data_quality` | `VARCHAR(50)` | ✅ | — | — | جودة البيانات | `"Complete"` / `"Partial"` |
| `water_source` | `VARCHAR(255)` | ✅ | — | — | مصدر الماء | `"شبكة عامة"` |
| `notes` | `TEXT` | ✅ | — | — | ملاحظات عامة | `"عميل VIP"` |
| `rating` | `VARCHAR(50)` | ✅ | — | — | التقييم | `"Committed"` / `"NotCommitted"` |
| `source_channel` | `VARCHAR(255)` | ✅ | — | — | قناة التواصل | `"PhoneCall"` / `"SocialMedia"` |
| `referrer_type` | `VARCHAR(255)` | ✅ | — | — | نوع الوسيط | `"Personal"` / `"Client"` / `"Employee"` |
| `referrer_id` | `INTEGER` | ✅ | — | — | معرف الوسيط | `45` |
| `referrer_name` | `VARCHAR(255)` | ✅ | — | — | اسم الوسيط وقت الإنشاء | `"خالد عمر"` |
| `referrers` | `JSONB` | ✅ | `'[]'` | — | قائمة الوسطاء المسجلين | `[{"type": "Client", "id": 45, "name": "خالد"}]` |
| `referral_entity_id` | `INTEGER` | ✅ | — | — | معرف الكيان المحال | `45` |
| `referral_date` | `VARCHAR(50)` | ✅ | — | — | تاريخ الإحالة | `"2026-04-01"` |
| `referral_reason` | `TEXT` | ✅ | — | — | سبب الإحالة | `"عطل فني"` |
| `referral_sheet_id` | `INTEGER` | ✅ | — | `FK → referral_sheets(id)` | معرف لائحة الإحالة | `12` |
| `referral_address_text` | `TEXT` | ✅ | — | — | عنوان الإحالة النصي | `"المزة، بناية ٣"` |
| `created_at` | `TIMESTAMPTZ` | ✅ | `NOW()` | — | تاريخ الإنشاء | `"2026-05-20T10:30:00Z"` |
| `is_candidate` | `BOOLEAN` | ✅ | `FALSE` | — | هل كان مرشحًا سابقًا؟ | `false` |
| `target_client` | `VARCHAR(255)` | ✅ | — | — | هدف التسويق | `"مياه"` |
| `candidate_status` | `VARCHAR(50)` | ✅ | — | — | حالة المرشح (legacy) | `"New"` |
| `branch_id` | `INTEGER` | ✅ | — | `FK → branches(id)` | الفرع التابع | `3` |
| `created_by` | `INTEGER` | ✅ | — | `FK → employees(id)` | أنشأه المستخدم | `7` |
| `deleted_at` | `TIMESTAMP` | ✅ | — | — | تاريخ الحذف الناعم | `"2026-05-22"` (null = active) |
| `deleted_by` | `INTEGER` | ✅ | — | — | من قام بالحذف | `5` |
| `is_active` | `BOOLEAN` | ✅ | `TRUE` | — | هل مسجل فعليًا؟ | `true` |
```

⚠️ **CRITICAL**: For each field, check:
- Is it in the CREATE TABLE? (001_core_tables.sql)
- Was it added via ALTER TABLE? (which migration?)
- Is it in the route SQL SELECT? (clients.ts CLIENT_SELECT)
- Is it validated in the route handler? (req.body checks)
- Is it in the shared types? (packages/shared/types.ts)

**Document ANY mismatch** between sources in Section 9 (Gaps).

---

### Section 3: القيود والقواعد (Constraints & Business Rules)

```markdown
## 3. القيود والقواعد (Constraints & Business Rules)

### 3.1 قيود المستوى (Database Constraints)
- `id`: PRIMARY KEY, auto-increment
- `referral_sheet_id`: FOREIGN KEY → `referral_sheets(id)` ON DELETE SET NULL
- `branch_id`: FOREIGN KEY → `branches(id)`
- `deleted_at IS NULL`: Index `idx_clients_active` — قائمة العملاء النشطين فقط
- لا يوجد CHECK constraint على `status` مباشرة — soft-delete via `deleted_at`

### 3.2 قواعد العمل (Business Rules) ⭐ IMPORTANT

| # | القاعدة | المصدر | الوصف |
|---|---|---|---|
| BR-1 | لا يمكن حذف عميل فعليًا | `clientPolicy.ts` + `079_client_audit_and_soft_delete.sql` | الحذف = soft-delete فقط (`deleted_at = NOW()`). |
| BR-2 | الاسم الكامل (`name`) legacy | `clients.ts` | إذا `first_name` موجود، الاسم الكامل = `first_name + " " + father_name + " " + last_name`. |
| BR-3 | `mobile` يجب أن يكون فريدًا | `clients.ts` smart-match | Smart-match يتحقق من تكرار `mobile` + `nationalId` + `name`. |
| BR-4 | الوسطاء (`referrers`) JSONB | `clients.ts` | يحتوي على مصفوفة من `{ type, id, name }`. |
| BR-5 | Ownership = Company بشكل افتراضي | `customerOwnership.ts` | إذا لم يُسند لموظف، المالك = الشركة (branch-scoped). |
| BR-6 | فقط Supervisor/Technician يمكن تخصيصهم | `customerOwnership.ts` | Non-supervisor/technician creators لا يحصلون على assignment شخصي. |
| BR-7 | العميل قد يكون مرشحًا (`is_candidate`) | `001_core_tables.sql` | إذا `is_candidate = true`، فهو مرشح تم تحويله لعميل. |
| BR-8 | `data_quality` قيم محددة | `009_data_quality.sql` | `Complete`, `Partial`, `Minimal` — لكن بدون CHECK constraint! |
| BR-9 | `gender` قيم | `010_client_gender.sql` | `Male`, `Female` — بدون CHECK constraint. |
| BR-10 | `rating` قيم | `types.ts` | `Committed`, `NotCommitted`, `Undefined`. |
| BR-11 | `source_channel` قيم | `types.ts` | `Acquaintance`, `PhoneCall`, `SocialMedia`, `Campaign`, `App`. |
| BR-12 | `referrer_type` قيم | `types.ts` | `Personal`, `Client`, `Employee`, `Unknown`. |
| BR-13 | `national_id_issue_date` صيغة | `131_client_legal_fields.sql` | `DATE` — يجب أن تكون صالحة (YYYY-MM-DD). |
```

---

### Section 4: العلاقات (Relationships)

```markdown
## 4. العلاقات (Relationships)

### 4.1 Entity Relationship Diagram (نصي)

```
clients ||--o{ contracts : "يملك"
clients ||--o{ visits : "يُزَار"
clients ||--o{ customer_call_logs : "يتم الاتصال به"
clients ||--o{ client_assignments : "يُسند إلى"
clients }o--|| branches : "ينتمي إلى"
clients }o--|| referral_sheets : "أُحيل من"
clients ||--o{ open_tasks : "له مهام"
```

### 4.2 الجداول المرتبطة

| الجدول | العلاقة | ON DELETE | وصف |
|---|---|---|---|
| `contracts` | 1:N | SET NULL | عقود الزبون |
| `visits` | 1:N | — | زيارات الزبون |
| `customer_call_logs` | 1:N | — | سجل الاتصالات |
| `client_assignments` | N:M via junction | CASCADE | تخصيص موظفين |
| `branches` | N:1 | — | الفرع التابع |
| `referral_sheets` | N:1 | SET NULL | لائحة الإحالة |
| `open_tasks` | 1:N | — | المهام المفتوحة |
```

---

### Section 5: آلة الحالات (State Machine)

```markdown
## 5. آلة الحالات (State Machine)

### 5.1 حالة العميل الأساسية (Lifecycle)
```
[غير موجود] → CREATE → [Active] → soft-delete → [Deleted]
                                      ↓
                                  is_candidate=true
                                      ↓
                                  [Converted from Candidate]
```

### 5.2 حالة الجودة (Data Quality)
```
[Unknown] → بيانات جزئية → [Partial]
          → بيانات كاملة → [Complete]
```

### 5.3 حالة التقييم (Rating)
```
[Undefined] → commit → [Committed]
            → لا commit → [NotCommitted]
```
```

---

### Section 6: صلاحيات الوصول (Permission Matrix)

```markdown
## 6. صلاحيات الوصول (Permission Matrix)

Extracted from: `clientPolicy.ts`, `054_permissions_allowed_scopes.sql`, `roles.ts`

| الإذن | المفتاح | النطاق (Scope) | الوصف |
|---|---|---|---|
| عرض قائمة العملاء | `clients.view_list` | `NONE`, `BRANCH`, `ASSIGNED`, `GLOBAL` | يستطيع رؤية قائمة العملاء |
| عرض تفاصيل عميل | `clients.view` | `NONE`, `BRANCH`, `ASSIGNED`, `GLOBAL` | يستطيع رؤية تفاصيل عميل محدد |
| إنشاء عميل | `clients.create` | `BRANCH`, `GLOBAL` | يستطيع إضافة عميل جديد |
| تعديل عميل | `clients.edit` | `BRANCH`, `ASSIGNED`, `GLOBAL` | يستطيع تعديل بيانات عميل |
| حذف عميل | `clients.delete` | `BRANCH`, `GLOBAL` | يستطيع حذف عميل (soft-delete) |
| التخصيص | `clients.can_be_assigned` | — | يظهر بالقائمة للتخصيص |

### 6.1 منطق النطاق (Scope Logic)
- **NONE**: لا يرى شيئًا (لكن الصلاحية موجودة).
- **BRANCH**: يرى عملاء فرعه فقط (`branch_id = X-Branch-Id`).
- **ASSIGNED**: يرى العملاء المخصصين له شخصيًا فقط.
- **GLOBAL**: يرى كل العملاء (HQ / Super Admin).

### 6.2 ملاحظة هامة
- `canSeeBranchModules` / `isSuperAdmin` ليست موجودة بالكود بعد — كل البوابة عبر Permissions.
```

---

### Section 7: عقد API (API Contract)

```markdown
## 7. عقد API (API Contract)

Extracted from: `clients.ts` + Swagger annotations

### 7.1 Endpoints

| الطريقة | المسار | الصلاحية | Branch-Only | وصف |
|---|---|---|---|---|
| GET | `/api/clients` | `clients.view_list` | ❌ | قائمة العملاء مع pagination |
| POST | `/api/clients/smart-match` | `clients.create` | ❌ | فحص تكرار العميل |
| GET | `/api/clients/:id` | `clients.view` | ❌ | تفاصيل عميل |
| POST | `/api/clients` | `clients.create` | ❌ | إنشاء عميل جديد |
| PUT | `/api/clients/:id` | `clients.edit` | ❌ | تعديل عميل |
| DELETE | `/api/clients/:id` | `clients.delete` | ❌ | حذف عميل (soft) |
| POST | `/api/clients/bulk-delete` | `clients.delete` | ❌ | حذف مجموعة |

### 7.2 Query Parameters (GET /api/clients)
| الباراميتر | النوع | مطلوب | وصف |
|---|---|---|---|
| `branchId` | integer | ❌ | تصفية حسب الفرع |
| `search` | string | ❌ | بحث نصي بـ name/mobile |
| `page` | integer | ❌ | رقم الصفحة (افتراضي: 1) |
| `limit` | integer | ❌ | حجم الصفحة (افتراضي: 20) |
| `status` | string | ❌ | تصفية حسب الحالة |
| `dataQuality` | string | ❌ | تصفية حسب جودة البيانات |

### 7.3 Request Body (POST /api/clients)
```json
{
  "firstName": "أحمد",
  "fatherName": "محمد",
  "lastName": "علي",
  "mobile": "0991234567",
  "contacts": [{"label": "بيت", "value": "0111234567"}],
  "governorate": "دمشق",
  "district": "المزة",
  "neighborhood": "المزة فيلات",
  "detailedAddress": "بناية ٥، طابق ٢",
  "gpsCoordinates": {"lat": 33.5138, "lng": 36.2765},
  "gender": "Male",
  "nationalId": "12345678901",
  "birthDate": "1990-05-15",
  "motherName": "فاطمة",
  "occupation": "مهندس",
  "spouseOccupation": "معلمة",
  "waterSource": "شبكة عامة",
  "notes": "عميل VIP",
  "rating": "Committed",
  "sourceChannel": "PhoneCall",
  "referrerType": "Personal",
  "referrerId": 45,
  "referrerName": "خالد عمر",
  "assignmentUserIds": [7, 12]
}
```

### 7.4 Response Schema (GET /api/clients/:id)
[Copy the full CLIENT_SELECT from clients.ts and document every field]
```

---

### Section 8: حالات الاختبار (Test Cases) ⭐ COMPREHENSIVE

```markdown
## 8. حالات الاختبار الشاملة (Test Cases)

### 8.1 الاختبارات الوظيفية (Functional Tests)

| # | السيناريو | Method + Endpoint | Inputs | Expected | Notes |
|---|---|---|---|---|---|
| TC-01 | إنشاء عميل صحيح | POST `/api/clients` | `{firstName:"علي", mobile:"0991234567"}` | 200 + client object | Happy path |
| TC-02 | إنشاء عميل بدون mobile | POST `/api/clients` | `{firstName:"علي"}` | 400 — mobile مطلوب | Validation |
| TC-03 | إنشاء عميل بتكرار mobile | POST `/api/clients` + smart-match | mobile موجود | 409 / warning | Duplicate |
| TC-04 | عرض عميل غير موجود | GET `/api/clients/99999` | id=99999 | 404 | Not found |
| TC-05 | عرض عميل محذوف | GET `/api/clients/:id` | deleted_at NOT NULL | 404 أو 403 | Soft-delete |
| TC-06 | تعديل عميل بدون صلاحية | PUT `/api/clients/5` | user بدون `clients.edit` | 403 | Permission denied |
| TC-07 | حذف عميل مع عقود | DELETE `/api/clients/5` | client له contracts | 409 أو cascade | FK constraint |
| TC-08 | حذف عميل ناعم | DELETE `/api/clients/5` | — | 200 + deleted_at set | Soft-delete |
| TC-09 | بحث نصي | GET `/api/clients?search=علي` | — | يعيد علي فقط | Filter |
| TC-10 | تصفية حسب فرع | GET `/api/clients?branchId=3` | X-Branch-Id=3 | يعيد فرع 3 فقط | Scope |
| TC-11 | تخصيص عميل لموظف | POST `/api/clients` + assignmentUserIds | `[7]` | client_assignments row | Assignment |
| TC-12 | عرض عميل ASSIGNED scope | GET `/api/clients/5` | user له ASSIGNED فقط | ✅ إذا مخصص له، ❌ إذا لا | Scope logic |

### 8.2 اختبارات الصلاحيات (Permission Matrix Tests)

| المستخدم | clients.view_list | النطاق | يستطيع رؤية | لا يستطيع |
|---|---|---|---|---|
| HQ Admin | ✅ | GLOBAL | كل العملاء | — |
| Branch Manager | ✅ | BRANCH | عملاء فرعه | عملاء فرع آخر |
| Supervisor | ✅ | ASSIGNED | عملاء مخصصين له | عملاء غير مخصصين |
| Telemarketer | ❌ | NONE | لا شيء | — |

### 8.3 Edge Cases

| # | السيناريو | السلوك المتوقع |
|---|---|---|
| EC-01 | عميل له 50 contact number | JSONB يحملها — لا يوجد limit |
| EC-02 | national_id فارغ و birth_date موجود | يُسمح — لا يوجد correlation constraint |
| EC-03 | referrer_type = "Client" لكن referrer_id لا يوجد | يُسمح — لا يوجد FK constraint |
| EC-04 | تعديل عميل أثناء وجود visit active | يُسمح — لا يوجد optimistic locking |
| EC-05 | عميل تم soft-delete ثم إنشاء عميل جديد بنفس mobile | يُسمح — unique ليس على mobile (فقط smart-match) |
| EC-06 | bulk-delete لـ 100 عميل | يجب أن يكون atomic |
```

---

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐ CRITICAL

```markdown
## 9. الثغرات والتضاربات المكتشفة (Gaps & Contradictions)

> **هذا القسم الأهم.** إذا وجدت أي تضارب بين المصادر، سجله هنا.

### 9.1 تضارب 1: [الوصف]
- **المصدر أ**: migration X تقول...
- **المصدر ب**: route Y تقول...
- **التضارب**: ...
- **التوصية**: ...

### 9.2 غياب CHECK constraints
- `data_quality`: migration تضيف VARCHAR(50) بدون CHECK — لكن types.ts تعرف `Complete`, `Partial`, `Minimal`.
- `gender`: VARCHAR(10) بدون CHECK — لكن منطقياً Male/Female.
- **الخلاصة**: الـ validation موجود فقط بالـ frontend/API، ليس بالـ DB.

### 9.3 غياب UNIQUE constraint
- لا يوجد UNIQUE على `mobile` — لكن smart-match يكتشف التكرار.
- **المشكلة**: race condition ممكن — عميلين بنفس mobile بالـ DB.

### 9.4 [أي شيء آخر تجده]
```

---

### Section 10: تاريخ التغييرات (Changelog)

```markdown
## 10. تاريخ التغييرات (Schema Changelog)

| التاريخ | Migration | التغيير |
|---|---|---|
| 2026-04 | 001_core_tables.sql | CREATE TABLE clients (baseline) |
| 2026-04 | 004_column_additions.sql | إضافة أعمدة... |
| 2026-04 | 008_spouse_occupation.sql | إضافة `spouse_occupation` |
| 2026-04 | 009_data_quality.sql | إضافة `data_quality` |
| 2026-04 | 010_client_gender.sql | إضافة `gender` |
| ... | ... | ... |
```

---

## Step 3: Create the Reusable Template

After writing `clients.md`, derive a reusable template from it:

**Write** `docs/constitution/templates/entity-constitution.md`:

It should contain the same 10 sections but with `[ENTITY_NAME]` placeholders and instructions on how to fill each section for future entities.

---

## Verification Checklist

Before committing, verify:

- [ ] `clients.md` contains all 10 sections above
- [ ] Every field in `CREATE TABLE clients` + `ALTER TABLE clients` is documented
- [ ] Every CHECK constraint is documented
- [ ] Every FK relationship is documented
- [ ] Every permission from `clientPolicy.ts` is documented
- [ ] Every endpoint from `clients.ts` is documented
- [ ] At least 12 functional test cases defined
- [ ] Permission matrix test cases defined
- [ ] Edge cases documented
- [ ] At least 3 gaps/contradictions identified (or "None found" if truly clean)
- [ ] Template file created and valid
- [ ] `pnpm --filter @golden-crm/api exec tsc --noEmit` passes
- [ ] `pm2 restart golden-crm-staging` succeeds
- [ ] Git commit: `docs(constitution): complete clients domain constitution + template`

---

## Notes for the Executor

1. **Do NOT invent fields.** If a field exists in the DB but not in the route SELECT, document it and note "Present in DB but not exposed via API".
2. **Do NOT skip migrations.** Read EVERY migration that alters `clients` — even if it just adds an index.
3. **Do NOT trust comments in code.** The code itself is the truth. Comments may be stale.
4. **If you find a contradiction**, document it in Section 9. Do NOT try to resolve it — that requires a separate decision prompt.
5. **Use exact SQL types** from migrations (e.g., `TIMESTAMPTZ` not `datetime`).
6. **Examples must be realistic** for a Syrian CRM context (names, phone numbers, addresses).
