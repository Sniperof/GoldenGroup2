**التحليل قبل التنفيذ**

وضع `clients` الحالي كان branch-scoped فقط. لم يكن هناك ownership field أمني صريح، ولم يكن `created_by` مستخدمًا أصلًا كملكية في هذا الموديول، وهذا جيد. الـ route في [clients.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/clients.ts>) كان يمرر فقط `branchId` إلى policy، لذلك `GLOBAL + BRANCH` كان يعمل، لكن `ASSIGNED` لم يكن ممكنًا لأن `authorize()` لم يكن يستقبل `assignedUserId` من العميل. كما أن القائمة كانت تعتمد على فرع واحد فقط، وليس على grant-aware filtering.

اعتمدت الحقل الجديد `clients.assigned_hr_user_id` كما طلبت، وقررت عدم عمل backfill تخميني. العملاء القدامى سيبقون `NULL`، وهذا يعني: غير مسندين، فلا يظهرون لمستخدم `ASSIGNED` حتى يتم إسنادهم صراحة. كذلك لم أضف `clients.assign` في هذه المرحلة حتى لا نوسع سطح الصلاحيات؛ استخدمت `clients.edit` مؤقتًا لتحديث الإسناد عند الحاجة، كما سمحت أنت.

**التنفيذ**

أضفت migration جديدة فقط لتعريف الحقل nullable:
- [031_clients_assigned_hr_user_id.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/031_clients_assigned_hr_user_id.sql>)

وحدّثت policy والـ route بحيث:
- `view/edit/delete` تمر الآن عبر `authorize()` مع:
  - `branchId`
  - `assignedUserId = assigned_hr_user_id`
- list لم تعد row-by-row، بل أصبحت تبني SQL filter حسب scope:
  - `GLOBAL`: كل العملاء، مع فلترة فرع إذا وُجد `X-Branch-Id`
  - `BRANCH`: فقط `allowedBranchIds`
  - `ASSIGNED`: فقط `assigned_hr_user_id = authContext.userId` وداخل `allowedBranchIds`
- create:
  - يتطلب branch واضحًا كما كان
  - إذا المنشئ إداري global وترك الإسناد فارغًا: يبقى `NULL`
  - إذا المنشئ branch/supervisor ولم يرسل إسنادًا: يُسند تلقائيًا إلى `authContext.userId`
- update:
  - إذا أرسل `assignedHrUserId` يتم التحقق من وجود `hr_users.id`
  - إذا لم يرسله، يبقى الإسناد الحالي كما هو

الواجهة أيضًا أصبحت تميز بين “المُحيل” و“المسؤول عن العميل”:
- [ClientModal.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/ClientModal.tsx>)
- أضفت حقل branch للإدارة فقط
- أضفت حقل “المسؤول عن العميل” للإدارة فقط
- مستخدم الفرع/المشرفة لا يحتاج هذا الحقل؛ الإسناد الافتراضي يتم من الـ backend
- أضفت helper frontend صغيرًا فقط للوصول إلى `/api/admin/hr-users` من [api.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/api.ts>) من دون تعديل أي route

**التقرير بعد التنفيذ**

الملفات المعدلة:
- [031_clients_assigned_hr_user_id.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/031_clients_assigned_hr_user_id.sql>)
- [clientPolicy.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/clientPolicy.ts>)
- [clients.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/clients.ts>)
- [types.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/shared/types.ts>)
- [ClientModal.tsx](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/ClientModal.tsx>)
- [api.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/lib/api.ts>)

الحقل الجديد:
- `clients.assigned_hr_user_id`
- في الأنواع: `assignedHrUserId`

هل تم backfill؟
- لا
- كل السجلات القديمة تبقى `NULL`
- لم أستخدم `created_by` أو `referrer_id` أو `referral_sheet_id` كملكية

كيف يعمل `create` الآن:
- branch يحدد كما كان عبر branch context / body
- branch/supervisor: إذا لم يرسل `assignedHrUserId` يصبح المالك الحالي هو `authContext.userId`
- الإدارة: يمكنها الإرسال صراحة أو تركه `NULL`

كيف يعمل `update`:
- الإسناد لا يتغير إذا لم يُرسل
- إذا أُرسل `assignedHrUserId` يتم التحقق من أنه `hr_users.id` صالح
- التحقق الأمني يمر عبر `authorize()` بعد بناء subject الجديد

كيف تعمل `list` الآن:
- `GLOBAL`: كل العملاء، أو فرع محدد إذا وُجد header
- `BRANCH`: فقط العملاء ضمن `allowedBranchIds`
- `ASSIGNED`: فقط العملاء المسندون للمستخدم الحالي وضمن `allowedBranchIds`
- بذلك `ASSIGNED` لا يتجاوز branch access

هل استُخدم `authorize()`؟
- نعم
- في [clientPolicy.ts](</D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/clientPolicy.ts>) لعمليات `view/create/edit/delete`
- وتمرير `assignedUserId` صار فعليًا جزءًا من subject

هل أضيفت permissions جديدة؟
- لا
- لم أضف `clients.assign` في هذه المرحلة

هل تغيّر authorization model العام؟
- لا

التحقق:
- API typecheck نجح:
```powershell
& 'D:\OneDrive\سطح المكتب\golden-crm-clean\node_modules\.bin\tsc.CMD' --noEmit
```
- Web typecheck نجح:
```powershell
& 'D:\OneDrive\سطح المكتب\golden-crm-clean\node_modules\.bin\tsc.CMD' -p 'D:\OneDrive\سطح المكتب\golden-crm-clean\packages\web\tsconfig.typecheck.json' --noEmit
```

**اختبار يدوي مقترح**

1. `superadmin` يفتح صفحة العملاء بدون branch filter: يجب أن يرى كل العملاء.
2. `branch_manager` في فرع دمشق: يجب أن يرى فقط عملاء دمشق.
3. `supervisor_a` بصلاحيات `ASSIGNED + BRANCH create`: تنشئ عميلًا جديدًا.
4. العميل الجديد يجب أن يُحفظ مع `assigned_hr_user_id = supervisor_a`.
5. `supervisor_a` ترى العميل الجديد في القائمة وتستطيع فتحه/تعديله.
6. `supervisor_b` لا ترى عميل `supervisor_a`.
7. `branch_manager` يرى عميل `supervisor_a` لأنه داخل نفس الفرع.
8. `superadmin` يرى عميل `supervisor_a`.
9. إذا تم إسناد عميل إلى `supervisor_a` لكن `branch_id` ليس ضمن فروعها المسموحة، يجب ألا يظهر لها.
10. إذا أنشأ `superadmin` عميلًا وترك “المسؤول عن العميل” فارغًا، يجب أن يبقى العميل غير مسند وألا يظهر لمستخدمي `ASSIGNED` حتى يتم إسناده لاحقًا.