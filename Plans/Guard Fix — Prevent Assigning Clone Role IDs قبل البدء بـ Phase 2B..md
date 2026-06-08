\*\*تحليل موجز\*\*

وجدت write paths التي تعيّن `hr\_users.role\_id` في أربعة مسارات فعلية:

\- REST: إنشاء مستخدم HR وتعديله في \[packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:391)

\- tRPC: `createHrUser` و`updateHrUser` في \[packages/api/trpc/routers/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts:277)

\- system account للموظف: حفظ/تحديث الحساب عبر \[packages/api/services/employeeService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/employeeService.ts:781)



وضعت guard مركزي في خدمة جديدة \[packages/api/services/roleAssignmentGuard.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/roleAssignmentGuard.ts:1). هذه الخدمة تقرأ الـ role مرة واحدة وتسمح فقط بـ template role صالحة، وترفض أي clone role صراحة.



\*\*التنفيذ\*\*

أضفت helper مركزي:

\- `validateTemplateRoleAssignment(roleId)`

\- ورسالة خطأ موحدة:

&#x20; - `يجب إسناد role template فقط، ولا يمكن إسناد branch-specific clone role مباشرة`



ثم ربطته بالمسارات التالية:

\- REST `POST /hr-users`

\- REST `PUT /hr-users/:id`

\- tRPC `createHrUser`

\- tRPC `updateHrUser`

\- employee system account save/update path في `employeeService`



وفي `employeeService` أزلت منطق “يجب أن يكون الدور clone من نفس الفرع” من هذا المسار تحديداً، واستبدلته بالتحقق الجديد: “يجب أن يكون Template role”. لم أغيّر أي read path أو schema أو auth runtime behavior خارج هذا المنع.



تحققت أيضاً من البناء عبر `tsc --noEmit` للـ API ونجح.



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[packages/api/services/roleAssignmentGuard.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/roleAssignmentGuard.ts:1)

\- \[packages/api/routes/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/roles.ts:1)

\- \[packages/api/trpc/routers/roles.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/routers/roles.ts:1)

\- \[packages/api/services/employeeService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/employeeService.ts:1)



المسارات التي أصبحت محمية:

\- REST HR user create

\- REST HR user update

\- tRPC HR user create

\- tRPC HR user update

\- employee system account create/update عبر service layer



هل بقي path غير مغطى؟

\- لم أجد public/service write path آخر يغيّر `hr\_users.role\_id` خارج هذه المسارات

\- توجد دوال repository منخفضة المستوى مثل `insertEmployeeSystemAccount` و`updateEmployeeSystemAccount`، لكنها الآن محمية فعلياً لأن الاستدعاء إليها يمر عبر `employeeService`

\- تحديث الاسم فقط مثل `updateHrUserNameByEmployeeId` لا يلمس `role\_id` أصلاً



نص الخطأ عند محاولة إسناد clone role:

\- `يجب إسناد role template فقط، ولا يمكن إسناد branch-specific clone role مباشرة`



الخلاصة:

\- لم يعد بالإمكان إسناد clone role إلى `hr\_users.role\_id` عبر write paths الأساسية

\- `role\_id` بقي ضمن المودل canonical الذي اعتمدناه

\- لم يتم توسيع النطاق إلى Phase 2B ولم يتغير read path أو branch authorization runtime

