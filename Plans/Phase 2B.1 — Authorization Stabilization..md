\*\*تحليل موجز\*\*

عدّلت ملفين فقط: \[packages/api/middleware/permission.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts:1) و\[packages/api/routes/employees.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/employees.ts:1). الهدف كان إصلاح shared guard نفسه، لا فتح refactor جديد.



جعلت `requireNotHQOnly` تستخدم `AuthContext` canonical مباشرة:

\- إذا كان `req.authContext` موجوداً تستخدمه

\- وإذا لم يكن موجوداً تبنيه عبر `buildAuthContext()`

\- ثم تعتمد على `authContext.actingBranchId` بدل `req.user.branchId`



الـ side effect المقصود هنا هو أن أي route تستخدم `\[requireAuth, requireNotHQOnly]` ستبدأ فعلياً بالاعتماد على `user\_branch\_assignments` و`role\_permission\_grants` في branch context، بدون تغيير الـ UI أو schema أو تفعيل `ASSIGNED`. وأبقيت مؤجلاً عمداً أي refactor واسع للمسارات التي ما زالت تستخدم `requireAuth` فقط مع helpers قديمة.



\*\*التنفيذ\*\*

أضفت helper داخلي موحد في `permission.ts` لبناء أو إعادة استخدام `AuthContext`، ثم جعلت:

\- `requirePermission` تستخدمه

\- `requireNotHQOnly` تستخدمه أيضاً



بهذا لم تعد `requireNotHQOnly` تسلك المسار القديم المعتمد على `req.user.branchId` من الـ JWT. وإذا لم يوجد `actingBranchId` الآن، فالرفض صار صريحاً برسالة branch-only واضحة.



وأغلقت حالة الحافة في `GET /employees`:

\- إذا كان المستخدم ليس `superAdmin`

\- و`targetBranchId == null`

\- يُرفض الطلب صراحةً برسالة واضحة

\- ولا يعود هناك fallthrough إلى query غير محددة branch



تحققت بعد ذلك من البناء:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[packages/api/middleware/permission.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/middleware/permission.ts:1)

\- \[packages/api/routes/employees.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/employees.ts:1)



ما أصبح صحيحاً الآن:

\- نعم، `requireNotHQOnly` أصبحت canonical-aware

\- نعم، تستخدم `AuthContext` و`buildAuthContext()` عند الحاجة

\- نعم، modules التي تمر عبر `\[requireAuth, requireNotHQOnly]` أصبحت تستفيد branch-wise من `user\_branch\_assignments`

\- نعم، تم إغلاق حالة `GET /employees` عند `branchId = null`



هل بقي أي shared guard يعتمد على `req.user.branchId`؟

\- لا، ليس كمسار القرار الأساسي في shared guards

\- بقي fallback legacy داخل helper `resolveTargetBranchId()` لمسارات قديمة untouched ما زالت تعتمد `requireAuth` فقط، لكنه ليس guard نفسه ولم ألمسه الآن حتى لا أوسع النطاق



ما الذي لم يتم لمسه عمداً:

\- لم أفعّل `ASSIGNED`

\- لم أغيّر schema أو JWT payload

\- لم أعد كتابة modules القديمة التي ما زالت تعمل عبر `requireAuth` ومسارات branch checks يدوية

\- لم أوسّع التفعيل إلى Phase 3 أو إلى جميع الوحدات دفعة واحدة



الخلاصة: آخر shared guard legacy path تم عزله، وسلوك branch-aware صار أكثر ثباتاً قبل أي توسع لاحق.

