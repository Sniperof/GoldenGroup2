# معيار قبول تدقيق سجلات الأسماء المقترحة

> **يحكمه:** [بروتوكول تدقيق أقسام السجلات](../constitution/domains/section-audit-protocol.md) + [معيار هندسة الصلاحيات](../constitution/domains/permissions-engineering-standard.md).
> **الدومين:** `candidates.name_lists.*` (بعد تقاعد `referral_sheets.*` في هجرة 280).
> **آخر تحديث:** 2026-06-16

## الدرجات

- **(ك)** GLOBAL — سوبر-أدمن + مدير الشركة (نائب، مطابق لتجربة الزبائن).
- **(ف)** BRANCH — مدير الفرع + الفني.
- **(ز)** ASSIGNED — المشرفة (سجلاتها المسندة لها).

## القرارات المعتمدة (2026-06-16)

- مدير الفرع: **BRANCH كامل** (view_list/create/edit/delete) إضافةً لـ assignment.manage. (كان يملك الإسناد فقط، وهو عديم الأثر لأن مساري الإنشاء/التعديل يتطلبان create/edit.)
- مدير الشركة: **مطابق للزبائن تماماً** — view_list/create/edit = GLOBAL، delete/assignment.manage = BRANCH.
- طُبّقا عبر [هجرة 292](../../migrations/292_name_lists_role_baseline_grants.sql).

## السلوك المتوقّع لكل درجة

| المنطقة | (ك) | (ف) | (ز) |
|---|---|---|---|
| القائمة | كل السجلات + تضييق بفرع | سجلات فرعه | سجلاتها المسندة |
| الإنشاء | أي فرع | فرعه | فرعها (تُسنَد لها تلقائياً) |
| الإسناد | مؤهلو الفرع (أو أي مؤهل لـ GLOBAL/سوبر) | مؤهلو فرعه فقط | تُسنَد لها تلقائياً |
| الحذف | GLOBAL/(ف) BRANCH | فرعه | سجلاتها |

## ما أُصلِح في هذا المرور

1. **أمان (إسناد عابر للفروع):** الخادم الآن يرفض إسناد سجل لموظف خارج فرع العملية لغير (سوبر/GLOBAL) — `assertAssignedHrUserExists` بات يفرض الفرع (deny-by-default)، لا الواجهة وحدها.
2. **قصر-دائرة GLOBAL:** نائب GLOBAL يقدر ينشئ/يعدّل في أي فرع (نظير الزبائن).
3. **baseline الأدوار:** هجرة 292 (مدير الفرع BRANCH كامل، النائب GLOBAL).

## فلتر الإدارة (مُنفَّذ)

نُفّذ فلتر إدارة محكوم بنطاق `candidates.view_list` في صفحة سجلات الأسماء (يخدم العائلتين معاً): GLOBAL→منسدل فعّال، BRANCH→شارة مقفولة، ASSIGNED→لا فلتر. يضيّق القائمتين (الأسماء + اللوائح) عبر `X-Branch-Id`، والمتجر يتذكّر آخر فرع فلا ينفقد بعد الإضافة. يتطلب `branches.lookup` لمدير الشركة لملء المنسدل (نفس شرط الزبائن).

الملفات: `packages/web/src/pages/candidates/CandidatesEntry.tsx` + `hooks/useCandidateStore.ts` + `lib/api.ts`.

المخرجات: `name-lists-permissions-test-matrix.csv` + `name-lists-critical-audit-areas.csv`.
