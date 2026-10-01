**Executive Summary**

المشروع **قريب على مستوى الـ foundation** لكنه **غير متّسق على مستوى الموديولات والتجربة المنتجية**. الأساس الجديد موجود فعلاً في [authorizationService.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/authorizationService.ts>) و[permission.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts>): `AuthContext` و`authorize()` و`role_permission_grants` و`user_branch_assignments` و`GLOBAL/BRANCH/ASSIGNED`. لكن التطبيق فوق هذا الأساس ما زال خليطاً بين المودل الجديد والمودل القديم المرتبط بـ HQ/branch clones/legacy branch fields.

أكبر 10 gaps:
1. `HQ` ليس واضحاً كـ branch حقيقي في الـ DB، لكن ما زال يظهر كمفهوم UX/logic عبر `null branch` وعبارة `كل الفروع (HQ)` في [BranchSwitcher.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/BranchSwitcher.tsx>).
2. الـ branch selector ظاهر بشكل عام حتى في الصفحات التي يجب أن تكون `GLOBAL_ONLY` عبر [MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>).
3. كثير من موديولات التشغيل محمية فقط بـ `requireNotHQOnly` عند mount، وليس بسياسات record-level حقيقية: [api/index.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/index.ts>).
4. `clients` لا يملك ownership field صالح لـ `ASSIGNED` حالياً: [clients.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/clients.ts>) و[clientPolicy.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/clientPolicy.ts>).
5. `candidates` و`referral_sheets` لديهما نية ownership، لكن الـ UI ما زال يرسل قيم hardcoded مثل `ownerUserId: 1`: [AddCandidateModal.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/candidates/AddCandidateModal.tsx>) و[CreateReferralSessionModal.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/CreateReferralSessionModal.tsx>).
6. `role_permission_grants` هو المصدر التنفيذي الحقيقي، لكن `role_permissions` ما زال موجوداً ويُكتب له بالتوازي في إدارة الأدوار: [roles.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts>) و[roles.ts tRPC](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts>).
7. ما زالت آثار branch role clones موجودة في schema/functions مثل `clone_role_templates_to_branch`: [020_role_model_conflict_cleanup.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/020_role_model_conflict_cleanup.sql>).
8. `SYSTEM_ADMIN` محمي ومخفي على مستوى schema، لكن ما زال مطلوب تنظيف كامل لسلوك الإدارة حول الأدوار القديمة والمخفية: [029_system_admin_role_protection.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/029_system_admin_role_protection.sql>).
9. موديولات مثل `dues`, `maintenance_requests`, `emergency_tickets`, `visits`, `schedules`, `route_assignments`, `telemarketing` ليست مضبوطة بعد على مودل branch/assigned واضح.
10. الأجهزة وقطع الغيار موجودة، لكن بلا assignment/visibility model مناسب للفروع أو الأقسام: [deviceModels.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/deviceModels.ts>) و[spareParts.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/spareParts.ts>).

الخلاصة: لا نحتاج “إعادة كتابة جذرية”، لكن نحتاج **مراحل منظمة وحاسمة** تبدأ بفصل `Global context` عن `Branch context` قبل أي توسعة على الموديولات.

**Product Authorization Charter**

- الإدارة العليا ليست فرعاً. `Global/Admin context` يجب أن يكون مستقلاً عن أي `branch_id`.
- الفروع وحدات تشغيلية فقط. المستخدم الفرعي يعمل فقط داخل فروعه من `user_branch_assignments`.
- الدور يحدد “ماذا يستطيع المستخدم أن يفعل”، وليس “أين”. المكان تحدده branch assignments أو assignment model مستقل.
- الأدوار والصلاحيات تدار مركزياً فقط. لا branch clones، ولا role-per-branch، ولا HQ role.
- `SYSTEM_ADMIN` يبقى مخفياً ومحميّاً وغير قابل للتعديل التشغيلي العادي.
- `All branches` يجب أن يصبح **فلتر عرض** فقط، وليس branch فعلياً، وليس بديلاً عن global context.
- الصفحات `GLOBAL_ONLY` لا يجب أن تعرض branch selector كمتطلب تشغيل.
- `ASSIGNED` لا يجب أن يعتمد على `created_by`. يجب أن يعتمد على field صريح ذو معنى أمني مثل `assigned_hr_user_id`.
- أي وصول مبني على الموظف/الفريق/المدير المباشر يحتاج مودلاً مستقلاً، وليس تمديداً عشوائياً لـ `ASSIGNED`.
- القوائم العامة `system lists` مركزية افتراضياً، ولا تصبح branch-specific إلا إذا وُجد سبب تشغيلي واضح في المنتج.

**HQ / All Branches / Branch Context**

لم أجد دليلاً أن `HQ` مزروع كفرع حقيقي في migrations. ما وجدته هو:
- legacy semantics في [013_multi_branch_identity.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/013_multi_branch_identity.sql>) تعتبر `NULL branch => HQ/super admin`.
- fallback branch باسم `غير محدد` في [014_branch_id_domain_tables.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/014_branch_id_domain_tables.sql>)، وليس HQ.
- في الواجهة، `null` يُعرض كـ `كل الفروع (HQ)` في [BranchSwitcher.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/BranchSwitcher.tsx>).
- في الـ API، عدم إرسال `X-Branch-Id` يعني عملياً global/no selected branch عبر [api.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/api.ts>) و[authFetch.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/authFetch.ts>).

التوصية الدقيقة:
- نعم، يجب **إنهاء HQ كمفهوم branch**.
- نعم، `All branches` يجب أن يصبح **UI filter only**.
- التصميم الصحيح:
  - `Global context`: بدون `branch_id`.
  - `Branch context`: `actingBranchId = branch_id` واضح وصريح.
  - `All branches filter`: state مستقل للعرض والتحليلات فقط، وليس acting branch.

**الأدوار والصلاحيات**

- `SYSTEM_ADMIN` محمي ومخفي على مستوى الـ DB فعلاً: [029_system_admin_role_protection.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/029_system_admin_role_protection.sql>).
- تعديل scope لكل permission موجود في UI: [RolePermissions.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx>).
- غير السوبر أدمن يمكن أن يملك صلاحيات إدارية إذا مُنح permissions مناسبة، وهذا منسجم مع المطلوب.
- hidden roles لا تظهر لغير السوبر أدمن في tRPC roles router.
- clone roles منطقياً “ما زالت حية” في البنية القديمة، حتى لو الواجهة الجديدة تتجه نحو template roles فقط.
- `role_permission_grants` هو **مصدر الحقيقة التنفيذي**، لكن `role_permissions` لم يمت بعد، وما زال compatibility layer.

**System Lists**

القوائم الموجودة فعلياً تشمل: `occupation`, `job_title`, `certificate`, `work_type`, `nationality`, `marital_status`, `gender`, `driving_license`, `application_source`, `department_type`, `military_service`, `contract_type`, `foreign_language` وغيرها في [SystemLists.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/SystemLists.tsx>).  
الوضع الحالي:
- القراءة متاحة لكل مستخدم authenticated.
- التعديل super admin فقط.
- لا يوجد branch binding واضح في [systemLists.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/systemLists.ts>).

النتيجة المنتجية:
- أغلبها يجب أن يُصنّف `GLOBAL_ONLY`.
- لا أرى حالياً قوائم branch-specific ناضجة فعلاً، إلا إذا قرر المنتج لاحقاً أن بعض lookup values تكون محلية للفرع.

**Module Classification Table**

| Module | Routes/UI | Current auth | Branch field | Ownership field | Desired model | Gap | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Roles & permissions | `api/routes/roles.ts`, `trpc/routers/roles.ts`, `pages/admin/Roles.tsx` | قوي جزئياً، مع legacy clones | لا | لا | GLOBAL_ONLY | بقايا clone model وdual-write | P1 |
| Branches | `api/routes/branches.ts` | read للجميع، write للسوبر أدمن | n/a | لا | GLOBAL_ONLY | جيد إجمالاً | P2 |
| System lists | `api/routes/systemLists.ts`, `pages/admin/SystemLists.tsx` | read للجميع، write admin | لا | لا | GLOBAL_ONLY | read واسع أكثر من اللازم | P2 |
| Geo units | `api/routes/geoUnits.ts` | public read, admin write | لا | لا | GLOBAL_ONLY | مقبول | P3 |
| Clients | `api/routes/clients.ts` | branch/global جيد | `branch_id` | لا يوجد | GLOBAL_VIEW_BRANCH_OPERATION | لا يدعم ASSIGNED | P1 |
| Candidates | `api/routes/candidates.ts` | branch/assigned جزئي | `branch_id` | `owner_user_id` | GLOBAL_VIEW_BRANCH_OPERATION | ownership غير موثوق | P1 |
| Referral sheets | `api/routes/referralSheets.ts` | branch/assigned أفضل | `branch_id` | `assigned_hr_user_id` | GLOBAL_VIEW_BRANCH_OPERATION | UI ما زال يرسل owner/createdBy خاطئ | P1 |
| Employees | `api/routes/employees.ts` | branch/global جيد | `branch_id` | لا يوجد auth ownership | GLOBAL_VIEW_BRANCH_OPERATION | لا يوجد manager/team model | P1 |
| Contracts | `api/routes/contracts.ts` | branch/global جيد | `branch_id` | لا | GLOBAL_VIEW_BRANCH_OPERATION | جيد نسبياً | P2 |
| Vacancies | `api/routes/vacancies.ts` | branch/global جيد | `branch_id` | لا | GLOBAL_VIEW_BRANCH_OPERATION | جيد نسبياً | P2 |
| Job applications | `api/routes/adminApplications.ts` | branch/global جيد نسبياً | `branch_id` | مشتق من vacancy/app | GLOBAL_VIEW_BRANCH_OPERATION | بعض legacy role guards | P2 |
| Tasks | `api/routes/tasks.ts` | branch/global مباشر | `branch_id` | `assigned_to` تشغيلي | BRANCH_ONLY_OPERATION | الإدارة ما زالت تدخل تشغيلياً | P1 |
| Visits | `api/routes/visits.ts` | ضعيف | لا يوجد واضح | `employee_id` | BRANCH_ONLY_OPERATION / NEEDS_NEW_MODEL | لا branch policy واضحة | P1 |
| Dues | `api/routes/dues.ts` | ضعيف | غير مباشر عبر contract | `assigned_telemarketer_id` | BRANCH_ONLY_OPERATION | لا auth حقيقي | P1 |
| Maintenance requests | `api/routes/maintenanceRequests.ts` | ضعيف | لا | `technician_id` | BRANCH_ONLY_OPERATION / NEEDS_NEW_MODEL | يحتاج branch/assignment model | P1 |
| Emergency tickets | `api/routes/emergencyTickets.ts` | ضعيف | لا | `assigned_technician_id` | BRANCH_ONLY_OPERATION / NEEDS_NEW_MODEL | يحتاج branch/assignment model | P1 |
| Schedules | `api/routes/schedules.ts` | ضعيف | لا | لا | NEEDS_NEW_MODEL | لا branch dimension | P1 |
| Route assignments | `api/routes/routeAssignments.ts` | ضعيف | لا | لا | NEEDS_NEW_MODEL | لا branch dimension | P1 |
| Telemarketing | `api/routes/telemarketing.ts` | ضعيف | `branch_id` موجود بالجداول | `calledBy/createdBy` غير منضبط | BRANCH_ONLY_OPERATION | route-level auth ناقص | P1 |
| Departments | `api/routes/departments.ts` | branch/global جيد | `branch_id` | لا | GLOBAL_VIEW_BRANCH_OPERATION | permissions غير مستقلة | P2 |
| Training courses | `api/routes/trainingCourses.ts` | متوسط | `branch_id` | لا | GLOBAL_VIEW_BRANCH_OPERATION | يحتاج تدقيق أعمق في services | P3 |
| Interviews | `api/routes/interviews.ts` | متوسط | مشتق | interviewer-like | NEEDS_NEW_MODEL | scope مشتق من parent entity | P3 |
| Device models | `api/routes/deviceModels.ts` | ضعيف | لا | لا | GLOBAL_MANAGED_BRANCH_VISIBLE | لا visibility model | P1 |
| Spare parts | `api/routes/spareParts.ts` | ضعيف | لا | لا | GLOBAL_MANAGED_BRANCH_VISIBLE | لا visibility/stock model | P1 |
| Dashboard | `api/routes/dashboard.ts` | ضعيف | لا | لا | GLOBAL_ONLY | لا auth/scoping كاف | P2 |
| Public vacancies/applications | `api/routes/public*.ts` | public/business flow | vacancy/app branch | لا | خارج core admin model | يحتاج فقط consistency downstream | P3 |

**Current vs Desired Behavior Matrix**

| Module family | من يرى الآن | المطلوب | هل يحتاج branch؟ | هل يحتاج assigned؟ |
| --- | --- | --- | --- | --- |
| Roles/permissions/system lists/branches | الإدارة أساساً | إدارة مركزية فقط | لا | لا |
| Clients | الإدارة كلهم، الفرع فرعه | الإدارة كلهم + filter، الفرع فرعه، المشرفة assigned فقط | نعم للفرع | نعم بعد ownership normalization |
| Candidates/referrals | قريب من المطلوب لكن غير ناضج | الإدارة كلهم + filter، الفرع فرعه، assigned بصيغة آمنة | نعم | نعم |
| Employees | الإدارة كلهم، الفرع فرعه | نفس ذلك، مع احتمال manager/team لاحقاً | نعم | ليس الآن، إلا بمودل مستقل |
| Contracts/vacancies/applications | قريب من المطلوب | إدارة ترى الكل، الفرع يرى فرعه | نعم | غالباً لا |
| Tasks/operations/visits/telemarketing | غير متسق | تشغيل داخل الفرع فقط، والإدارة overview/report فقط | نعم إلزامي | حسب الموديول |
| Devices/spare parts | عالمي عملياً | إدارة مركزية + رؤية فرعية بالassignment | ليس branch field مباشر فقط، بل visibility model | أحياناً department-based |

**الزبائن**

الوضع الحالي في [clients.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/clients.ts>):
- الإدارة ترى كل الزبائن عند غياب `X-Branch-Id`.
- الفرع يرى زبائن فرعه.
- لا يوجد `assigned_hr_user_id`.
- create لا يربط العميل تلقائياً بمالك واضح.
- policy الحالية في [clientPolicy.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/clientPolicy.ts>) لا تملك أساساً لـ `ASSIGNED`.

النتيجة:
- `clients` **لا يدعم حالياً** المطلوب المنتج للمشرفة/الموظف.
- نعم، نحتاج ownership normalization.
- نعم، سنحتاج migration لاحقاً لإضافة ownership field صريح مثل `assigned_hr_user_id` أو `owner_hr_user_id` وفق القرار المنتج.
- نعم، سنحتاج policy helper يجعل subject يحتوي `branchId + assignedHrUserId`.
- permissions المقترحة لاحقاً: `clients.view`, `clients.create`, `clients.edit`, `clients.delete` مع `GLOBAL/BRANCH/ASSIGNED`.

**الموظفون والأسماء المقترحة**

- `employees`: branch visibility جيدة، لكن لا يوجد model واضح للمدير/الفريق رغم وجود `direct_manager_id`.
- `candidates/leads`: يوجد ownership field اسمه `owner_user_id` لكن استخدامه الحالي غير آمن لأنه لا يتم تطبيعه product-wise.
- الفرق المهم: `employees` هي سجلات تشغيلية داخلية، بينما `candidates/referrals` ما زالت أقرب لموديل “record ownership”.

**المواعيد والعمليات والمهام**

هذه المنطقة هي الأضعف حالياً:
- `tasks` لديه `branch_id` لكنه ما زال يسمح للإدارة بدخول تشغيلي مباشر.
- `visits`, `dues`, `maintenance_requests`, `emergency_tickets`, `schedules`, `route_assignments`, `telemarketing` ليست كلها محكومة بسياسات branch/assigned مكتملة.
- بعض `assigned` يعتمد على user IDs تشغيلية، لكن ليس ضمن مودل موحد وواضح.
- `schedules` و`route_assignments` بالذات يحتاجان غالباً **schema/model جديد** لأن branch dimension غير موجودة بوضوح.

**الأجهزة وقطع الغيار**

الموديولات موجودة، لكن النموذج المطلوب غير موجود:
- الجداول الحالية: `device_models`, `spare_parts`.
- لا يوجد `branch_id`.
- لا يوجد `department_id` مباشر على الأصل نفسه.
- لا يوجد assignment model.
- يوجد فقط إشارات جانبية عبر departments وsystem lists.

التوصية المنتجية:
- هذا المجال يجب أن يُصنّف `GLOBAL_MANAGED_BRANCH_VISIBLE`.
- نعم، يحتاج schema جديد لاحقاً من نوع:
  - `asset_branch_assignments`
  - `asset_department_visibility`
  - وربما `inventory_location_assignments`

**Roadmap**

1. `X1 — Global Context vs Branch Context Separation`
   - فصل global admin context عن all-branches filter وعن acting branch.
   - إزالة تسمية HQ من الواجهة والمنطق.
2. `X2 — Central Admin Surface Cleanup`
   - تثبيت صفحات الإدارة المركزية: roles, permissions, branches, system lists.
   - إخفاء/تقييد أي بقايا clone-role behavior.
3. `X3 — Clients Ownership Normalization`
   - إضافة ownership صريح للزبائن وتفعيل `ASSIGNED` بشكل صحيح.
4. `X4 — Candidates / Referrals / Employees Visibility Alignment`
   - توحيد ownership fields، وإيقاف الاعتماد على hardcoded owner/createdBy.
5. `X5 — Branch Operations Enforcement`
   - تحويل المهام/الزيارات/الصيانة/الطوارئ/التليماركتنج إلى branch-operational فعلياً.
6. `X6 — Asset Visibility Model`
   - بناء مودل مركزي للأجهزة وقطع الغيار مع رؤية فرعية/قسمية.
7. `X7 — Employee/Team-Based Access Model`
   - أي manager/subordinate/team visibility يُبنى هنا كمودل مستقل.
8. `X8 — QA Authorization Matrix`
   - اختبار يدوي شامل لكل role/scope/module قبل التوسعة التالية.

**First Implementation Recommendation**

المرحلة الأولى التي أوصي بها بعد الـ Discovery هي: **`X1 — Global Context vs Branch Context Separation`** فقط.

السبب المنتجـي:
- هي المرحلة التي ستحل أصل الالتباس كله: `HQ`, `All Branches`, branch selector, global-only pages.
- بدونها سنبني بقية الصلاحيات فوق UX ومعنى تشغيلي مضطرب.
- وهي أقل خطورة من البدء مباشرة بـ ownership migrations للزبائن أو بإعادة هيكلة الموديولات التشغيلية.

**Risks**

- أكثر ما قد ينكسر: تنقل السوبر أدمن بين الصفحات، الـ sidebar visibility، وفلاتر القوائم التي تعتمد حالياً على `null branch`.
- لا يجب لمس الآن: schema الخاصة بالعمليات التشغيلية المعقدة مثل `schedules` و`route_assignments` قبل إنهاء فصل الـ context.
- لا يجب اعتبار `created_by` أساساً أمنياً في أي موديول جديد.
- يجب اختبار يدوياً:
  - super admin بدون branch selected
  - super admin مع branch selected
  - branch admin متعدد الفروع
  - branch user بفرع واحد
  - role hidden/protected
  - system lists read vs write
  - clients/candidates/referrals visibility حسب branch وassigned

إذا رغبت، أستطيع في الخطوة التالية إعداد **وثيقة تنفيذية Phase X1 فقط** بصيغة تسليم للفريق: نطاق التغيير، الملفات المتأثرة، وسيناريوهات الاختبار، من دون كتابة كود.