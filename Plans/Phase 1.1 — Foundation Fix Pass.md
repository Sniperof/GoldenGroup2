\*\*تحليل قبل التنفيذ\*\*

التصحيح كان محصوراً في 4 أماكن فقط: \[packages/api/middleware/auth.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/auth.ts:1) لجعل `requireAuth` مصادقة فقط، \[packages/api/middleware/permission.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts:1) ليصبح المكان الوحيد في Express الذي يبني `AuthContext` ويحتوي `attachScope`, \[packages/api/trpc/init.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/init.ts:1) لمنع بناء `authContext` الوهمي داخل `createContext` وحصره في `withPermission`, و\[packages/api/services/authorizationService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/authorizationService.ts:1) لتوضيح fallback المؤقت للـ `GLOBAL` scopes.



أقل تغييرات لازمة كانت:

\- حذف أي `scope` و`authContext` و`attachScope` من `auth.ts`

\- إزالة bypass المشرف العام من `requirePermission` و`tRPC withPermission`

\- منع بناء `authContext` بدون permissions

\- جعل `resolveTargetBranchId()` يمر عبر `resolveActingBranch()` بدل امتلاك branch-resolution logic مستقل



\*\*التنفيذ\*\*

نفذت التعديلات فعلياً، والنتيجة الآن:

\- `requireAuth` يضع `req.user` فقط ولا يبني أي `scope` أو `authContext`

\- يوجد `attachScope` واحد فقط، داخل `permission.ts`

\- `AuthContext` يُبنى فقط بعد تحميل permissions:

&#x20; - Express: داخل `requirePermission`

&#x20; - tRPC: داخل `withPermission`

\- `createContext` في tRPC يعيد `authContext: null` دائماً حتى مرحلة enforcement

\- لم يعد هناك `if (req.user.isSuperAdmin) return next()` داخل `requirePermission`

\- لم يعد هناك `if (ctx.user.isSuperAdmin) return next()` داخل `withPermission`

\- أضفت تعليق `PHASE2\_REQUIRED` فوق fallback تحويل كل permission إلى grant من نوع `GLOBAL`

\- `resolveTargetBranchId()` صار يعتمد على `resolveActingBranch()` بدل تكرار implementation آخر



تحققت من البناء عبر:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



وكلاهما نجح.



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة في هذا الـ pass:

\- \[packages/api/middleware/auth.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/auth.ts:1)

\- \[packages/api/middleware/permission.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts:1)

\- \[packages/api/trpc/init.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/init.ts:1)

\- \[packages/api/services/authorizationService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/authorizationService.ts:1)



ما الذي أصبح صحيحاً الآن:

\- يوجد مسار واحد واضح لبناء `AuthContext`

\- يوجد مسار واحد واضح لاتخاذ قرار permission: `authorize()`

\- لم يعد هناك `authContext` وهمي مبني بـ `permissions: \[]`

\- branch resolution صار موحداً حول `resolveActingBranch()`

\- `requireAuth` أصبح authentication only كما طلبت



هل بقي duplication؟

\- لا، بالنسبة لـ `attachScope` لم يعد موجوداً إلا في مكان واحد داخل `permission.ts`

\- لا يزال هناك parsing JWT مكرر في بعض middleware legacy، لكن هذا لم يكن ضمن نطاق هذا الـ fix pass



هل بقي bypass؟

\- لا يوجد bypass للمشرف العام داخل `requirePermission` أو `withPermission`

\- قرار super admin في permission enforcement أصبح محصوراً داخل `authorize()`

\- بقيت guards legacy مثل `requireRole(...)` و`requireSuperAdmin(...)` كما هي خارج نطاق هذا الـ pass، ولم أوسع refactor لإزالتها



هل أصبح لدينا single path للـ authorization؟

\- نعم، للـ permission-based authorization الجديد صار المسار المستهدف فعلياً:

&#x20; - `request -> requireAuth -> requirePermission -> authorize()`

&#x20; - و`tRPC -> withPermission -> authorize()`



الـ side effects المحتملة:

\- المشرف العام لم يعد يتخطى `requirePermission` قبل تحميل permissions، لذلك كل طلب permission-protected سيحمل permissions أولاً ثم يمر عبر `authorize()`. هذا تغيير معماري مقصود، لكنه لا يفترض أن يغير business behavior لأن `authorize()` ما زال يمنح super admin السماح النهائي.

\- `requireNotHQOnly` ما زال guard مستقل للصفحات branch-only، لكنه لم يعد يبني `AuthContext` أو يعتمد على bypass permission logic.



ملاحظة أخيرة: توجد تغييرات أخرى غير مرتبطة داخل مجلد `Plans` في الـ worktree، ولم ألمسها.

