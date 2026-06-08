**Executive Summary**
نظام الأدوار يعمل تقنياً، لكنه ما زال **إدارياً مخربطاً**. المشكلة الأساسية ليست في `authorize()` أو `hr_users.role_id` الآن، بل في طبقة إدارة الأدوار نفسها: لدينا **30 template roles + 56 branch clones**، بينما المستخدمون الفعليون مرتبطون فقط بـ **8 template roles**، والواجهة ما زالت تعرض surface مختلطة وتكتب إلى `role_permissions` القديمة بدل `role_permission_grants`.

الخلاصة العملية:
- **المودل الأمني الأساسي صار صحيحاً جزئياً**: `hr_users.role_id` يشير فعلاً إلى templates فقط.
- **المودل الإداري ما زال غير نظيف**: roles كثيرة legacy/job-title-driven، clones تظهر في بعض surfaces، وإدارة الصلاحيات ما زالت تعتمد على الجداول القديمة.

**Current State**
**الجداول والمعنى الحالي**
- [migrations/003_hr_rbac_tables.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/003_hr_rbac_tables.sql:1) أنشأت النموذج القديم: `roles`, `permissions`, `role_permissions`, و`hr_users.role_id`.
- [migrations/013_multi_branch_identity.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/013_multi_branch_identity.sql:1) أضافت:
  - `roles.is_template`
  - `roles.template_id`
  - `roles.branch_id`
  - وقيد `roles_scope_ck`
- معنى الحقول الآن:
  - `is_template = true`: role template أمني عام
  - `is_template = false` مع `template_id` و`branch_id`: branch-specific clone
  - `template_id`: clone يشير إلى template الأصل
- [migrations/020_role_model_conflict_cleanup.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/020_role_model_conflict_cleanup.sql:1) أعادت `hr_users.role_id` إلى template roles فقط.

**ما الذي وجدته في البيانات**
من قاعدة البيانات الحالية:
- `roles` الإجمالي: **86**
- templates: **30**
- clones: **56**
- `hr_users.role_id` على clones: **0**
- templates المستخدمة فعلياً من `hr_users.role_id`: **8 فقط**
- clones المستخدمة فعلياً من المستخدمين: **0**
- clones التي لديها grants: **12**
- clones بدون أي grants: **44**

هذا يعني:
- نعم، توجد branch-specific clone roles فعلاً.
- لا، لم تعد تُستخدم كمصدر حقيقة للمستخدمين.
- نعم، `hr_users.role_id` يشير حالياً إلى templates فقط في البيانات الحالية.

**إدارة الأدوار الحالية**
لدينا أكثر من surface:
- REST في [packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:1)
- tRPC في [packages/api/trpc/routers/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts:1)
- واجهة الإدارة في [packages/web/src/pages/admin/Roles.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx:1)
- شاشة الصلاحيات في [packages/web/src/pages/admin/RolePermissions.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx:1)

السلوك الحالي غير موحد:
- REST `GET /roles`:
  - super admin افتراضياً يرى **clones فقط**
  - templates تظهر فقط مع `?templates=true`
- tRPC `roles.list`:
  - super admin بدون branch context يرى **كل شيء: templates + clones**
  - وهذا هو surface الذي تستخدمه صفحة [Roles.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx:1)
- النتيجة: واجهة الإدارة الحالية تميل إلى عرض أدوار أكثر من اللازم، ومنها clones

**الجداول القديمة مقابل الجديدة**
- Runtime auth الجديد يقرأ grants من `role_permission_grants`
- لكن إدارة الصلاحيات ما زالت تقرأ/تكتب `role_permissions`:
  - REST في [packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:214)
  - tRPC في [packages/api/trpc/routers/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts:206)
  - UI في [packages/web/src/pages/admin/RolePermissions.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx:206) و[RolePermissions.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx:283)
- حالياً لا يوجد drift عددي في البيانات بين `role_permissions` و`role_permission_grants`, لكن **surface التحرير نفسها ما زالت legacy**.

**Inventory Table**
أهم inventory العملي الآن:

| group | examples | type | used_by_users | grants | should_show_in_admin | recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| System templates | `ADMIN`, `HR_MANAGER`, `HR_ASSISTANT` | TEMPLATE | نعم | نعم | نعم | `KEEP` |
| Dev templates | `DEV_GLOBAL_ADMIN`, `DEV_BRANCH_USER` | TEMPLATE | نعم | نعم | لا في الإنتاج | `SYSTEM_ONLY` |
| Job-title templates used | `job_title_5636`, `job_title_5641`, `job_title_3937` | TEMPLATE | نعم | نعم | لا بالشكل الحالي | `DEPRECATE` ثم `MERGE/REMODEL` |
| Job-title templates unused | معظم `job_title_*` | TEMPLATE | لا | نعم | لا | `HIDE_FROM_ADMIN` ثم `DELETE_LATER/DEPRECATE` |
| System clones | clone لـ `ADMIN`, `HR_MANAGER`, `HR_ASSISTANT` | CLONE | لا | بعضها نعم | لا | `HIDE_FROM_ADMIN` ثم `DELETE_LATER` |
| Job-title clones with grants | بعض `job_title_*` في branch 4/5 | CLONE | لا | نعم | لا | `HIDE_FROM_ADMIN` ثم `DELETE_LATER` |
| Job-title clones zero-grant | 44 clone تقريباً | CLONE | لا | لا | لا | `DELETE_LATER` |
| Orphan-like admin clutter | templates/clones غير مستخدمة ولا تلعب دوراً بالمستخدمين | MIXED | لا | متفاوت | لا | `DEPRECATE` |

**الأدوار المستخدمة فعلياً الآن من المستخدمين**
- `ADMIN`
- `HR_MANAGER`
- `HR_ASSISTANT`
- `DEV_GLOBAL_ADMIN`
- `DEV_BRANCH_USER`
- `job_title_3937` / `محاسب`
- `job_title_5636` / `مدير تنفيذي`
- `job_title_5641` / `مشرفة مبيعات`

هذه النتيجة وحدها تكشف المشكلة: ما زال عندنا **security roles مرتبطة بمسميات job title** عبر أسماء `job_title_*`، وهذا ضد charter أساساً.

**Problems Found**
1. **تضخم roles بدون استخدام فعلي**
- 86 role rows مقابل 8 templates مستخدمة فعلياً فقط من المستخدمين.
- 56 clone role، ولا واحد منها مستخدم مباشرة من `hr_users.role_id`.

2. **وجود job-title-driven security roles**
- أسماء مثل `job_title_5636` و`job_title_5641` تؤكد أن المودل الأمني ما زال إدارياً ملوثاً بمنطق job title.

3. **clones ما زالت ظاهرة إدارياً**
- tRPC list يعرض templates + clones للسوبر أدمن.
- صفحة الإدارة تعتمد tRPC list، لذلك surface الإدارة ليست minimal ولا واضحة.

4. **إدارة الصلاحيات ما زالت legacy**
- UI وREST وtRPC الخاصة بتعديل الصلاحيات ما زالت تعتمد `role_permissions`.
- بينما runtime auth يعتمد `role_permission_grants`.

5. **REST وtRPC غير متطابقين**
- REST list أكثر تقييداً.
- tRPC list أكثر اتساعاً.
- بعض checks في REST scoped أكثر من tRPC.

6. **clone data غير متسقة**
- 44 clone بدون grants.
- بعض clones لديها grants بنطاق `GLOBAL` رغم أنها clone branch-specific، وهذا يؤكد أنها بقايا transitional وليست جزءاً صحياً من target model.

7. **واجهة الصلاحيات hybrid**
- [RolePermissions.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx:1) تستخدم `useRoleStore` لجلب catalog عبر tRPC، لكنها تحفظ التعديلات عبر `authFetch` REST مباشرة.
- هذا surface مزدوج وغير مثالي.

**Recommended Target Model**
**ما الذي يجب أن يبقى**
أوصي بأن يبقى إدارياً فقط:
- Template roles الرسمية فقط
- System roles الرسمية فقط إن كانت لازمة
- عدد محدود جداً من business/security roles الواضحة

في الوضع الحالي، الحد الأدنى القابل للإدارة:
- `ADMIN`
- `HR_MANAGER`
- `HR_ASSISTANT`

والباقي يحتاج مراجعة product/ops:
- `DEV_*` يجب أن تكون dev-only
- `job_title_*` لا يجب أن تبقى كـ security roles طويلة الأجل

**ما الذي يجب أن يختفي من واجهة الإدارة**
- كل clone role
- كل role dev-only
- كل role legacy/job-title-derived غير معتمد رسمياً
- أي role بدون users وبدون هدف أمني واضح
- أي zero-grant clone

**ما هو source of truth النهائي**
- user capability identity: `hr_users.role_id -> template role`
- branch access: `user_branch_assignments`
- permission enforcement: `role_permission_grants`
- إدارة الصلاحيات يجب أن تقرأ وتكتب `role_permission_grants`
- `role_permissions` يجب أن يصبح transitional compatibility only ثم يُزال لاحقاً

**Recommended Classification**
التصنيف العام:
- `ADMIN`, `HR_MANAGER`, `HR_ASSISTANT`: `KEEP`
- `DEV_GLOBAL_ADMIN`, `DEV_BRANCH_USER`: `SYSTEM_ONLY`
- `job_title_*` templates المستخدمة: `DEPRECATE`
- `job_title_*` templates غير المستخدمة: `HIDE_FROM_ADMIN`
- كل clones: `HIDE_FROM_ADMIN`
- clones zero-grant: `DELETE_LATER`

**Cleanup Plan**
**R2 — UI / Query Cleanup**
- اجعل واجهة [Roles.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx:1) تعرض template roles فقط
- لا تعرض clones نهائياً في admin UI
- أخفِ dev roles وlegacy roles من القائمة الافتراضية
- وحّد `roles.list` بين REST وtRPC على نفس semantics

**R3 — Grants Source Cleanup**
- اجعل شاشة [RolePermissions.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx:1) تقرأ وتكتب `role_permission_grants`
- أضف UI لعرض scope لكل permission grant
- أبقِ `role_permissions` كتابة توافقية فقط إذا لزم لفترة انتقالية قصيرة

**R4 — Data Cleanup**
- علّم `job_title_*` كـ legacy classification
- عطّل أو أخفِ templates غير المستخدمة
- أوقف إظهار clones نهائياً
- حضّر حذف clones الصفرية وغير المستخدمة بعد التأكد من عدم اعتماد أي surface عليها

**R5 — Legacy Removal**
- إزالة الاعتماد الإداري على `role_permissions`
- إلغاء clone propagation من [packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:291) وDB helper لاحقاً إذا لم يعد هناك استخدام إداري لها
- إنهاء job-title-as-role model نهائياً

**Risks**
- حذف clones بسرعة قد يكسر surfaces قديمة ما زالت تعتمد عليها في القراءة أو العرض
- حذف `job_title_*` بسرعة قد يكسر مستخدمين حاليين لأن بعضهم ما زال مرتبطاً بهذه templates
- تحويل شاشة الصلاحيات إلى grants دون mapping UI واضح للـ scope قد يربك الإدارة
- ما دام `MainLayout` ما زال يستخدم `authUser.role` في بعض bypass/UI checks داخل [packages/web/src/layout/MainLayout.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx:68)، فهناك بقايا legacy role-name logic يجب حصرها قبل أي cleanup عنيف

الخلاصة:
- **النظام الأمني الأساسي تحسن فعلاً**
- لكن **نظام الأدوار الإداري ليس minimal ولا واضحاً بعد**
- أفضل مرحلة تالية مباشرة هي:

**Phase R2 — Roles Admin Surface Cleanup**
- template-only admin list
- hide clones/dev/legacy from UI
- توحيد REST وtRPC semantics

وبعدها:

**Phase R3 — Role Grants Management Migration**
- نقل إدارة الصلاحيات من `role_permissions` إلى `role_permission_grants` بشكل رسمي