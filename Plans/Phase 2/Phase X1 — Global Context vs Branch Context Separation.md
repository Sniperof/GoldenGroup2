**التحليل**

`HQ` كان يظهر صراحة في [BranchSwitcher.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/BranchSwitcher.tsx>) كنص `كل الفروع (HQ)`. كما أن الـ branch selector كان يظهر من [MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>) بشكل عام داخل الـ sidebar، لذلك حتى صفحات الإدارة المركزية كانت تبدو وكأنها داخل فرع. كذلك كان `X-Branch-Id` يُرفق من الواجهة على مستوى عام عبر [api.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/api.ts>) و[authFetch.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/authFetch.ts>) و[trpc.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/trpc.ts>) متى كان السوبر أدمن قد اختار فرعًا، من غير تمييز بين صفحة إدارية global-only وصفحة branch-scoped.

اعتمدت الصفحات التالية كـ `GLOBAL_ONLY` في هذه المرحلة: `/admin/roles`, `/admin/roles/:id/permissions`, `/system-lists`, `/branches`, `/branches/:id`, `/settings`, وأيضًا `/geo` و`/routes` لأنها صفحات إعداد/إدارة عامة وليست تشغيلًا فرعيًا. أما الصفحات branch-aware التي أبقيت عليها كما هي فتشمل السجلات والتشغيل مثل `/clients`, `/employees`, `/candidates`, `/contracts`, `/telemarketer`, `/planning/*`, `/tasks/*`, `/operations/marketing` وصفحات البيانات المشابهة. قبل التعديل، نعم: كان `X-Branch-Id` يمكن أن يُرسل أيضًا في صفحات الإدارة إذا كان السوبر أدمن مختارًا فرعًا.

**التنفيذ**

نفّذت فصلًا دلاليًا في الـ frontend فقط، بدون أي تعديل على `AuthContext` أو `authorize()` أو schema أو migrations أو backend authorization model.

التغييرات الأساسية:
- أزلت تسمية `HQ` من الـ UI في [BranchSwitcher.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/BranchSwitcher.tsx>).
- جعلت خيار `كل الفروع` واضحًا كفلتر عرض فقط بإضافة وصف: `فلتر عرض للإدارة، وليس فرعاً تشغيلياً`.
- أضفت helper جديدًا في [branchContext.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/branchContext.ts>) لتعريف الصفحات `GLOBAL_ONLY` مرة واحدة.
- ربطت [MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>) بهذا التعريف لإخفاء `BranchSwitcher` على الصفحات الإدارية global-only.
- منعت إرسال `X-Branch-Id` في الصفحات global-only عبر:
  - [api.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/api.ts>)
  - [authFetch.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/authFetch.ts>)
  - [trpc.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/trpc.ts>)

لإكمال شرط `typecheck` أصلحت أيضًا خطأين TypeScript سابقين غير وظيفيين في:
- [trpc-contract.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/trpc-contract.ts>)
- [Roles.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx>)

**التقرير**

الملفات المعدلة:
- [BranchSwitcher.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/BranchSwitcher.tsx>)
- [MainLayout.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx>)
- [api.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/api.ts>)
- [authFetch.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/authFetch.ts>)
- [trpc.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/trpc.ts>)
- [branchContext.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/branchContext.ts>) جديد
- [trpc-contract.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/trpc-contract.ts>)
- [Roles.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/pages/admin/Roles.tsx>)

النصوص التي تغيّرت:
- `كل الفروع (HQ)` أصبحت `كل الفروع`
- أضفت تحتها توضيحًا: `فلتر عرض للإدارة، وليس فرعاً تشغيلياً`

الصفحات التي لم تعد تعرض branch selector:
- `/admin/roles`
- `/admin/roles/:id/permissions`
- `/system-lists`
- `/branches`
- `/branches/:id`
- `/settings`
- `/geo`
- `/routes`

كيف أصبح `all branches` يعمل:
- ما زال يساوي عدم اختيار `actingBranchId` من الواجهة.
- لكنه لم يعد يُعرض أو يُشرح كأنه HQ branch.
- وفي الصفحات branch-aware فقط: يعني “عرض جميع الفروع” للسوبر أدمن، ومعه لا يُرسل `X-Branch-Id`.
- وفي الصفحات global-only: السويتشر أصلًا مخفي، والـ header لا يُرسل.

هل تغيّر أي backend behavior؟
- لا.
- لم أغيّر `AuthContext`
- لم أغيّر `authorize()`
- لم ألمس `role_permission_grants`
- لم ألمس `user_branch_assignments`
- لم أضف migrations
- التغيير محصور في semantics الواجهة وإرسال header من الـ frontend بحسب نوع الصفحة

التحقق:
- `typecheck` نجح عبر:
```powershell
& 'D:\OneDrive\سطح المكتب\golden-crm-clean\node_modules\.bin\tsc.CMD' -p tsconfig.typecheck.json --noEmit
```

النتيجة النهائية الآن:
- `Admin/global ≠ HQ branch`
- `All branches ≠ branch`
- `Branch context = تشغيل فرعي فقط`