**التحليل**

راجعت هذه surfaces: [Roles.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx>), [RolePermissions.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx>), [SystemLists.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/SystemLists.tsx>), [Branches.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/Branches.tsx>), [BranchDetail.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/BranchDetail.tsx>), [SystemSettings.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/SystemSettings.tsx>), [GeoSettings.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/GeoSettings.tsx>), [RouteManager.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/RouteManager.tsx>)، مع الـ backend المقابل في [roles.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts>), [roles tRPC](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts>), [systemLists.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/systemLists.ts>), [branches.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/branches.ts>), [geoUnits.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/geoUnits.ts>), [routes.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/routes.ts>)، ومع [MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>).

أهم النواقص التي كانت موجودة:
- بعض صفحات الإدارة كانت تعتمد على bypass في الـ sidebar مبني على أسماء أدوار legacy مثل `ADMIN` و`HR_MANAGER` بدل permission صريح.
- `SYSTEM_ADMIN` كان محميًا من الحذف، لكن تعديل الدور أو تعديل صلاحياته لم يكن مقفولًا بالكامل backend/frontend.
- hidden/system/protected roles لم تكن مستبعدة افتراضيًا من قائمة الأدوار.
- `system lists` و`branches` و`geo` كانت تستخدم `requireSuperAdmin` مباشرة بدل permissions إدارية واضحة.
- [routes.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/routes.ts>) لم يكن عليه auth مناسب أصلًا.
- إنشاء فرع جديد كان ما يزال ينفذ `clone_role_templates_to_branch()` في [branches.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/branches.ts>)، وهذا يناقض مبدأ “لا clones”.

**التنفيذ**

ثبّتُّ surfaces الإدارة المركزية كالتالي:
- الإدارة المركزية في الـ sidebar لم تعد تعتمد على bypass بأسماء الأدوار، بل على permissions صريحة فقط في [MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>) للصفحات:
  - `roles`
  - `system lists`
  - `branches`
  - `settings`
  - `geo/routes`
- أضفت page guards مباشرة في:
  - [Roles.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx>)
  - [RolePermissions.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx>)
  - [SystemLists.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/SystemLists.tsx>)
  - [Branches.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/Branches.tsx>)
  - [BranchDetail.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/BranchDetail.tsx>)
  - [SystemSettings.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/SystemSettings.tsx>)
  - [GeoSettings.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/GeoSettings.tsx>)
  - [RouteManager.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/RouteManager.tsx>)
- فصلت بين `view` و`manage` في الواجهة: الصفحة قد تُفتح بصلاحية view، لكن أزرار الإنشاء/التعديل/الحذف صارت معطلة أو مخفية إذا لم توجد `manage`.
- في إدارة الأدوار:
  - القوائم الافتراضية صارت تعرض template business roles فقط.
  - hidden/system/protected roles لم تعد تظهر افتراضيًا في [roles tRPC](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts>) و[roles.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts>).
  - `SYSTEM_ADMIN` صار مقفولًا من edit/delete/permissions backend وfrontend.
- في صفحة صلاحيات الدور:
  - القراءة والكتابة أصبحت عبر tRPC procedures المبنية على `role_permission_grants` في [RolePermissions.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx>).
  - `role_permissions` بقي compatibility فقط في الـ backend write path، ولم أغير هذا المودل.
- في backend:
  - `system lists` writes أصبحت `requirePermission('admin.system_lists.manage')`
  - `branches` writes أصبحت `requirePermission('branches.manage')`
  - `geo` writes أصبحت `requirePermission('geo.manage')`
  - `routes` صارت:
    - `GET` بـ `geo.view`
    - `POST/PUT/DELETE` بـ `geo.manage`
- أوقفت إنشاء clones عند إنشاء فرع جديد بحذف استدعاء `clone_role_templates_to_branch()` من [branches.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/branches.ts>)
- endpoint القديم الخاص بـ propagate إلى clones في [roles.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts>) أصبح deprecated ويرجع `410` بدل تنفيذ الاستنساخ.

**التقرير**

الملفات المعدلة:
- [packages/api/routes/roles.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts>)
- [packages/api/trpc/routers/roles.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts>)
- [packages/api/routes/systemLists.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/systemLists.ts>)
- [packages/api/routes/branches.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/branches.ts>)
- [packages/api/routes/geoUnits.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/geoUnits.ts>)
- [packages/api/routes/routes.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/routes.ts>)
- [packages/web/src/layout/MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>)
- [packages/web/src/pages/admin/Roles.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx>)
- [packages/web/src/pages/admin/RolePermissions.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/RolePermissions.tsx>)
- [packages/web/src/pages/admin/SystemLists.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/SystemLists.tsx>)
- [packages/web/src/pages/Branches.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/Branches.tsx>)
- [packages/web/src/pages/admin/BranchDetail.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/BranchDetail.tsx>)
- [packages/web/src/pages/GeoSettings.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/GeoSettings.tsx>)
- [packages/web/src/pages/RouteManager.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/RouteManager.tsx>)
- [packages/web/src/pages/SystemSettings.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/SystemSettings.tsx>)

الـ permissions المستخدمة في X2:
- `admin.roles.view`
- `admin.roles.manage`
- `admin.system_lists.view`
- `admin.system_lists.manage`
- `branches.view`
- `branches.manage`
- `geo.view`
- `geo.manage`
- `settings.view`
- `settings.manage`

ما تحقق:
- نعم، admin pages أصبحت تعمل كـ `GLOBAL_ONLY` من ناحية الـ UX والـ API surface.
- نعم، لا يتم استخدام `X-Branch-Id` فيها بفضل X1، وهذا السلوك بقي محفوظًا.
- نعم، `SYSTEM_ADMIN` صار محميًا من التعديل والحذف وتعديل الصلاحيات.
- نعم، hidden/system/protected roles لا تظهر افتراضيًا كأدوار عادية.
- نعم، role permissions تُدار من `role_permission_grants`.
- نعم، `system lists` management لا يعتمد على branch.
- نعم، `branches` management لا يعتمد على branch.
- نعم، لا يتم إنشاء clones عند إنشاء فرع جديد بعد الآن.
- لا، لم أضف migration في هذه المرحلة.

التحقق:
- Web typecheck نجح:
```powershell
& 'D:\OneDrive\سطح المكتب\golden-crm-clean\node_modules\.bin\tsc.CMD' -p tsconfig.typecheck.json --noEmit
```
- API typecheck نجح:
```powershell
& 'D:\OneDrive\سطح المكتب\golden-crm-clean\node_modules\.bin\tsc.CMD' --noEmit
```

ما بقي follow-up:
- `settings` ما زالت صفحة frontend-only تقريبًا، وليست لديها backend settings service حقيقي بعد.
- `system lists` و`branches` ما زالت endpoints القراءة العامة متاحة للمستهلكين الداخليين لأن النماذج والبادجات تعتمد عليها. الإدارة نفسها صارت global-only، لكن catalog consumption لم أغيّره حتى لا أكسر النماذج التشغيلية.
- لم أضف permissions جديدة مثل `roles.permissions.view/manage` لأن المودل الحالي يستخدم `admin.roles.view/manage` بالفعل، وهذا كان كافيًا لـ X2.
- إذا كانت بيئة جديدة لا تحتوي أصلًا على keys مثل `branches.manage` أو `geo.manage` في قاعدة البيانات، فسنحتاج migration seeding صغيرة لاحقًا. لم أضفها هنا لأن المشروع الحالي كان يستخدم هذه المفاتيح بالفعل على مستوى الواجهة.