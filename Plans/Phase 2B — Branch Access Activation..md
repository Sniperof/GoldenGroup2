\*\*تحليل قبل التنفيذ\*\*

حصرْت التعديل في أربع نقاط فقط حتى تبقى المرحلة محافظة: \[packages/api/services/authorizationService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/authorizationService.ts:1) لبناء `AuthContext` من الجداول الجديدة، \[packages/api/middleware/permission.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts:1) لربط Express بنفس المسار، \[packages/api/trpc/init.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/init.ts:1) لتوحيد `tRPC` معه، و\[packages/api/routes/employees.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/employees.ts:1) كوحدة branch-sensitive واحدة لتفعيل runtime عليها فعلياً.



القراءة الجديدة أصبحت من:

\- `role\_permission\_grants` للـ `permission + scope`

\- `user\_branch\_assignments` للـ `allowedBranchIds` مع `status = 'active'`

\- `is\_primary` لاختيار default/acting branch

\- `hr\_users.branch\_id` فقط كـ fallback أخير موثّق بتعليق `PHASE2B\_LEGACY\_FALLBACK`



وأجّلت عمداً:

\- أي تفعيل لـ `ASSIGNED`

\- أي refactor واسع لبقية routes

\- أي تغيير schema أو UI أو business services خارج ما يلزم لتفعيل المسار الجديد



\*\*التنفيذ\*\*

نفذت التغييرات فعلياً. `buildAuthContext()` صار الآن async ويقرأ grants الحقيقية من `role\_permission\_grants`، ويقرأ branch access الحقيقي من `user\_branch\_assignments`. `allowedBranchIds` لم تعد مشتقة من `hr\_users.branch\_id` إلا عند غياب assignments بالكامل كـ fallback مؤقت موثّق. كذلك `resolveActingBranch()` صار يعتمد على `is\_primary` و`allowedBranchIds` بدل branch المستخدم القديم.



في `authorize()` تم تفعيل `BRANCH` scope فعلياً: إذا كانت الصلاحية من نوع `BRANCH` ولم يوجد branch context مناسب أو كان الفرع خارج `allowedBranchIds` فسيُرفض الطلب. أما `ASSIGNED` فتركته conservative deny مع تعليق واضح `PHASE3\_REQUIRED: ASSIGNED scope enforcement not activated yet`.



فعّلت branch-aware enforcement على وحدة `employees` فقط:

\- list

\- manager candidates

\- get by id

\- create

\- update

\- system-account update

\- delete



وفي هذه المسارات صار القرار يمر عبر `authorize(authContext, { permission, branchId })` باستخدام branch الهدف الحقيقي، بدل المقارنات اليدوية القديمة على `scope.branchId`.



تحققت من البناء عبر:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[packages/api/services/authorizationService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/authorizationService.ts:1)

\- \[packages/api/middleware/permission.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts:1)

\- \[packages/api/trpc/init.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/trpc/init.ts:1)

\- \[packages/api/routes/employees.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/employees.ts:1)



ما أصبح صحيحاً الآن:

\- نعم، `AuthContext` صار مبنياً من grants + assignments الحقيقيين

\- نعم، `buildAuthContext()` يقرأ من `role\_permission\_grants`

\- نعم، `allowedBranchIds` تأتي من `user\_branch\_assignments`

\- نعم، `BRANCH` scope صار مفعّلاً فعلياً داخل `authorize()`

\- نعم، `authorize()` بقيت نقطة القرار الوحيدة في المسارات التي فعّلتها



كيف تعاملت مع `ASSIGNED`:

\- لم أفعّله runtime

\- رجّعت deny محافظاً مع تعليق `PHASE3\_REQUIRED`

\- هذا يمنع إدخال behavior ناقص أو policy engine مبكر



المسارات التي فعّلت عليها branch-aware enforcement:

\- وحدة `employees` فقط، لأنها أوضح وحدة branch-scoped في الوضع الحالي وتسمح بتفعيل محدود وقابل للمراجعة



الفallbackات legacy التي بقيت:

\- `hr\_users.branch\_id` ما زال fallback أخيراً فقط عند غياب أي active assignment، وموسوم بـ `PHASE2B\_LEGACY\_FALLBACK`

\- بعض helpers/routes غير الممسوسة ما زالت تستخدم branch logic قديم خارج هذه الوحدة، ولم أوسع النطاق لإعادة كتابتها الآن

\- `role\_permissions` لم يعد read source في مسار `AuthContext` الجديد، لكنه ما زال موجوداً legacy ولم أحذفه



المخاطر والأسئلة المفتوحة للمرحلة التالية:

\- كثير من grants الحالية ما زالت غالباً `GLOBAL` من backfill؛ لذلك التفعيل الحقيقي للـ branch restrictions يعتمد على ضبط `role\_permission\_grants` role-by-role

\- المسارات غير المعدلة بعد ما زالت تحتوي manual branch checks متفرقة، وستحتاج migration تدريجية في Phase 3 أو ما بعدها

\- `ASSIGNED` ما زال مؤجلاً عمداً ويحتاج policy model واضح قبل تفعيله

