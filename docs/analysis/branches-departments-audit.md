# تدقيق سكوب الفرع — الفروع + الأقسام (م0: خريطة وفرز)

> **التاريخ:** 2026-06-20 · **المعيار:** `docs/constitution/domains/branch-scope-and-visibility-standard.md`
> **القرار المؤسِّس:** الفروع تبقى **مجموعة 2 (GLOBAL)**؛ الأقسام تُرقَّى إلى **مجموعة 1 (تشغيلية تتبع الفرع، شبيهة بالزبائن)** — استخراج كامل من صفحة الفرع.

---

## 1. مصفوفة المنح الفعلية (DB — `role_permission_grants`)

| الدور | branches | departments | dept_availability |
|------|----------|-------------|-------------------|
| SYSTEM_ADMIN (1) | view/manage/lookup/nav **GLOBAL** | view_list/lookup **GLOBAL** | — |
| company_manager (7) | view/manage/lookup **GLOBAL**، nav BRANCH | view_list/manage/lookup **GLOBAL** | view/manage **GLOBAL** |
| branch_manager (6) | lookup **BRANCH** | lookup **BRANCH** → **+view_list/manage BRANCH (هجرة 304)** | view **BRANCH** |
| supervisor (3) / cs_supervisor (2) | lookup **BRANCH** | lookup **BRANCH** | — |

**ملاحظة:** قبل هجرة 304 كان `departments.view_list`/`manage` حصرًا لـSYSTEM_ADMIN وcompany_manager (GLOBAL) — أي الأقسام مُدارة مركزيًّا رغم ملكيتها لفرع. 304 يمنح مدير الفرع إدارة أقسام فرعه (BRANCH) تحقيقًا لقالب الزبائن.

---

## 2. الفروع — فرز الحقول (§2/§3) ونتيجة التدقيق

`GET /api/branches` يرجّع: `name, locationGeoId, locationGeoName, detailedAddress, coveredGeoIds, contactInfo, status, createdAt`.

- **بوابة رؤية الصف:** غير حامل lookup-GLOBAL محصور بـ`b.id = ANY(allowedBranchIds)` (`branches.ts:135-138`). حامل GLOBAL (مدير الشركة/الأدمن فقط، مؤكَّد من DB) يرى الكل — شرعي.
- **اللافتات المرجعية (§3):** `name`/`locationGeoName` عالمية لأي صفّ ظاهر ✓.
- **الحقول التشغيلية (`coveredGeoIds`/`contactInfo`/`detailedAddress`/`status`):** تُكشف كاملةً فقط مع الصفّ الظاهر؛ لا تُسرَّب لفرع آخر لأن غير العالمي لا يرى صفوف فروع أخرى أصلًا.
- **الطفرات:** إنشاء يتطلّب GLOBAL (`branches.ts:252`)؛ تعديل/حذف مقيّد بالفرع (`hasBranchPermission`)؛ تعديل `coveredGeoIds`/`status` يتطلّب `branches.manage` (لا `edit`).

**النتيجة: قسم الفروع نظيف — لا تسريب فرع-لفرع. يبقى GLOBAL. (تحقّق-وإغلاق).**

---

## 3. الأقسام — الحالة الحالية والفجوات

`departments` table له `branch_id`؛ `departments.ts` مقيّد بالفرع بالكامل (`authorize({permission, branchId})`، تصفية القائمة، `sanitizeDepartmentDevices` للحجب الدقيق لتوفّر الأجهزة).

**فجوات تُغلَق في م1–م2:**

| # | الفجوة | الموقع | الإصلاح |
|---|--------|--------|---------|
| G-1 | baseline مدير الفرع ناقص (لا view_list/manage) | DB | هجرة 304 ✅ |
| G-2 | **SH-3:** `POST` يسقط صامتًا في `actingBranchId ?? allowedBranchIds[0]` للعالمي غير-السوبر-أدمن | `departments.ts` POST | رفض الإنشاء بلا فرع صريح ✅ |
| G-2b | **سكوب القائمة:** العالمي بلا `branchId` كان يُحصَر في `actingBranchId` (لا يرى باقي فروعه) | `departments.ts` GET | قراءة `X-Branch-Id` + `null` للعالمي على «الكل» ✅ |
| G-3 | اسم القسم كلافتة §3 على الموظف | `employeeRepository.ts:60` | **محقّق أصلًا** — `d.name` عبر JOIN خادمي مع الصفّ الظاهر ✅ |
| G-4 | الأقسام مدمجة كجدول فرعي داخل `BranchDetail.tsx` بلا صفحة/مسار/تنقّل | الواجهة | استخراج كامل إلى `/departments` (م2) |
| G-5 | لا ربط بالفلتر الخارجي الموحّد + لا مؤشّر + لا بوابة إضافة | الواجهة | §4/§5 (م2) |

---

## 4. خطة التنفيذ (مراحل)

- **م1 — خادم:** 304 (✅) · إغلاق SH-3 في departments POST/PUT · تأكيد سكوب القائمة للعالمي عبر الفلتر · مصدر أسماء أقسام عالمي (§3).
- **م2 — واجهة:** ✅ منجزة (typecheck أخضر، ⏳ E2E):
  - صفحة مستقلّة `pages/Departments.tsx` (سكوب-مُوجَّهة: GLOBAL منتقي/BRANCH مثبّت) + مسار `/departments` + بند شريط جانبي محروس بـ`departments.view_list`.
  - **استخراج كامل:** حُذف `admin/BranchDetail.tsx` ومساره `/branches/:id` وزر «الأقسام» من صف الفرع.
  - ربط الفلتر الخارجي (`branchContextId` deps) + `BranchScopeIndicator` + بوابة الإضافة (زر مُعطَّل «اختر فرعاً لإضافة قسم» على «الكل») + عمود الفرع (لافتة §3 من `api.branches.list`).
  - `api.departments.list` حُوِّل لنمط ترويسة `X-Branch-Id` (متوافق مع `EmployeeFormModal`/`Vacancies`). `/departments` خارج `isGlobalOnlyPath` ✓.
- **م3 — الفروع:** تحقّق-وإغلاق (مؤكّد أعلاه).
- **م4 — مخرجات:** مصفوفة CSV + اعتماد قبول + تحديث §6/§9 (باستئذان).
