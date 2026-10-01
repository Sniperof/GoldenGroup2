\# مراجعة Phase 2B — Branch Access Activation



\---



\## 1. Executive Summary



Phase 2B حقق تقدماً حقيقياً وملموساً: الـ Phase 1 blocking issues تم حلها بالكامل، `buildAuthContext` أصبح فعلاً يقرأ من المصادر الرسمية، و`authorize()` هي نقطة القرار الوحيدة بدون bypasses. تنفيذ وحدة `employees` نموذج صحيح للـ pattern المستهدف.



لكن هناك مشكلتان مستقلتان يجب معالجتهما قبل التوسع:



\*\*الأولى معمارية\*\*: ثمانية route modules كاملة (tasks، dues، maintenance-requests، emergency-tickets، visits، schedules، route-assignments، telemarketing) تعمل بشكل كامل على الـ legacy path عبر `requireNotHQOnly`. هذه الروابط لا تعرف شيئاً عن `user\_branch\_assignments`. Phase 3 لا يمكنه إزالة `hr\_users.branch\_id` وهذه الـ modules تعتمد عليه.



\*\*الثانية أمنية محدودة\*\*: توجد حالة حافة في `GET /employees` يمكن فيها لمستخدم بصلاحية GLOBAL وبدون branch context الحصول على `getEmployees({ isSuperAdmin: false, branchId: null })` بدون حارس صريح.



\---



\## 2. What Is Solid



\*\*Phase 1 blocking issues حُلّت كلها:\*\*

\- \[`auth.ts`](packages/api/middleware/auth.ts:1) نظيف تماماً — يضع `req.user` فقط، لا scope، لا authContext

\- \[`permission.ts`](packages/api/middleware/permission.ts:27) — `attachScope` واحد يشتق من authContext المبني

\- \[`trpc/init.ts:25`](packages/api/trpc/init.ts:25) — `createContext` يُعيد `authContext: null` بدلاً من dummy context

\- لا يوجد `isSuperAdmin` pre-check في أي مكان — `authorize()` تتعامل معه داخلياً



\*\*`buildAuthContext` أصبح canonical:\*\*

\[`authorizationService.ts:28`](packages/api/services/authorizationService.ts:28) — يقرأ من `role\_permission\_grants` و`user\_branch\_assignments` بشكل متوازٍ (`Promise.all`). الـ cache key يشمل `cacheRoleId` و`cacheBranchId` لـ invalidation عند تغيير الـ JWT.



\*\*تنفيذ employees صحيح:\*\*

Pattern "double-check" (middleware + handler) صحيح — الـ middleware يتحقق من امتلاك الـ permission، والـ handler يتحقق من الوصول إلى resource محدد ببرانش محدد. هذا الفصل سيكون مهماً عندما ينتقل scope من GLOBAL إلى BRANCH. أيضاً: `PUT /:id` يتحقق من الـ owner branch وكذلك الـ target branch — هذا صحيح.



\*\*`authorizeAssignedGrant` deny محافظ:\*\*

\[`authorizationService.ts:240`](packages/api/services/authorizationService.ts:240) — القرار الصحيح. يُبقي النظام في حالة معروفة بدلاً من fallback غامض.



\*\*`normalizeScope`:\*\*

\[`authorizationService.ts:246`](packages/api/services/authorizationService.ts:246) — validates DB values قبل استخدامها. أي قيمة غير صالحة تُسقط الـ grant بدل أن تسبب unexpected scope.



\---



\## 3. What Is Risky



\### \[BLOCKING] `requireNotHQOnly` لا تزال على الـ legacy path



\[`permission.ts:99`](packages/api/middleware/permission.ts:99):

```typescript

const branchId = req.authContext?.actingBranchId ?? resolveActingBranch({

&#x20; headerBranchId: req.header('x-branch-id'),

&#x20; primaryBranchId: req.user.branchId ?? null,        // ← JWT legacy field

&#x20; allowedBranchIds: req.user.branchId != null ? \[req.user.branchId] : \[],  // ← single branch only

});

```



\[`index.ts:72`](packages/api/index.ts:72) يضع هذه الدالة كـ guard وحيد لثمانية modules:

```typescript

const branchOnly = \[requireAuth, requireNotHQOnly];

// tasks, dues, maintenance-requests, emergency-tickets,

// visits, schedules, route-assignments, telemarketing

```



`requireAuth` لا يبني `authContext`. لذلك عندما تُستدعى `requireNotHQOnly`، `req.authContext` دائماً `null`، وتقع في الفرع الثاني الذي يقرأ من `req.user.branchId` مباشرةً.



\*\*الأثر المزدوج:\*\*

1\. مستخدم multi-branch لا يستطيع تبديل الـ branch في هذه الـ modules — محاصر في JWT branch رغم أن Phase 2B يجب أن يحلّ هذا

2\. Phase 3 لا تستطيع إزالة `hr\_users.branch\_id` وهذه الـ modules تعتمد عليه عبر JWT



\### \[HIGH] حالة حافة: data leak محتملة في `GET /employees`



\[`employees.ts:44`](packages/api/routes/employees.ts:44):

```typescript

const targetBranchId = resolveEmployeeTargetBranch(req, requestedBranchId);



if (targetBranchId != null) {

&#x20; const access = authorize(authContext, { permission: 'employees.view\_list', branchId: targetBranchId });

&#x20; if (!access.allowed) return forbidBranchAccess(res, access.reason);

}



if (authContext.isSuperAdmin \&\& targetBranchId == null) {

&#x20; return res.json(await getEmployees({ isSuperAdmin: true, branchId: null }));

}



// ← لا يوجد guard هنا إذا كان targetBranchId == null و isSuperAdmin == false

res.json(await getEmployees({ isSuperAdmin: false, branchId: null }));

```



سيناريو التفعيل: مستخدم بـ GLOBAL scope (كل المستخدمين حالياً) + بدون `x-branch-id` header + بدون `user\_branch\_assignments` + بدون `hr\_users.branch\_id` fallback → `targetBranchId = null` → يمر حارس الـ `if` الأول → يمر حارس superAdmin → يصل إلى `getEmployees({ isSuperAdmin: false, branchId: null })`.



\[`employeeService.ts:637`](packages/api/services/employeeService.ts:637):

```typescript

export async function getEmployees(scope?: { isSuperAdmin: boolean; branchId: number | null }) {

&#x20; if (scope \&\& !scope.isSuperAdmin) {

&#x20;   return listEmployees({ branchId: scope.branchId });  // ← branchId: null هنا

&#x20; }

```



إذا كانت `listEmployees({ branchId: null })` تُعيد كل الموظفين عند `branchId = null` — وهذا هو الـ default behavior الطبيعي في معظم query builders — يكون هذا leak حقيقياً.



السيناريو نادر حالياً (Phase 2A backfill ضمن لكل مستخدم له `branch\_id` وجود assignment)، لكنه \*\*حالة حافة ليس عليها حارس صريح\*\*.



\### \[HIGH] `requireNotHQOnly` يكسر multi-branch للـ non-superAdmin



مستخدم لديه `user\_branch\_assignments = \[1, 2, 3]` لكن `hr\_users.branch\_id = 1`. عند وصوله لـ `/api/tasks` مع header `x-branch-id: 2`:

\- `requireNotHQOnly` تقرأ `req.user.branchId = 1`

\- `allowedBranchIds = \[1]` فقط

\- `resolveActingBranch({ headerBranchId: 2, allowedBranchIds: \[1] })` → branch 2 ليس مسموحاً → `null`

\- المستخدم يحصل على `scope.branchId = null` → قد يُرفض أو يحصل على بيانات خاطئة



هذا regression مباشر لهدف Phase 2B في تفعيل multi-branch.



\### \[MEDIUM] cache invalidation لا يغطي `user\_branch\_assignments` changes



\[`authorizationService.ts:116`](packages/api/services/authorizationService.ts:116) — الـ cache يُبطل فقط إذا تغيّر `roleId` أو `branchId` في الـ JWT. تغيير `user\_branch\_assignments` في DB لا يُبطل الـ cache — فقط TTL (5 دقائق) يُنهيه.



لا توجد أي endpoints تُدير `user\_branch\_assignments` حالياً، لذلك `clearAuthorizationCache(userId)` لا تُستدعى برمجياً أبداً. عند إضافة management UI في Phase 3، إذا نُسي استدعاء `clearAuthorizationCache`، يبقى الـ user يرى الـ branches القديمة لمدة 5 دقائق بعد التعديل.



\### \[MEDIUM] superAdmin مع `user\_branch\_assignments` يصبح مقيداً بصمت



\[`authorizationService.ts:74`](packages/api/services/authorizationService.ts:74):

```typescript

if (options.isSuperAdmin === true) {

&#x20; if (allowedBranchIds.length === 0 || allowedBranchIds.includes(requestedBranchId)) {

&#x20;   return requestedBranchId;

&#x20; }

&#x20; return null;

}

```



إذا كان لـ superAdmin أي `user\_branch\_assignments` (مثلاً تم إضافتها بالخطأ)، سيصبح مقيداً بتلك الـ branches فقط بدل أن يرى كل شيء. لا يوجد في الكود تحذير أو توثيق لهذا السلوك.



\---



\## 4. Answers to Architectural Questions



\### A. هل يجب أن يكون `actingBranchId` mandatory لكل request؟



\*\*لا، لكن يجب أن يكون mandatory للعمليات الكتابية (create/update/delete).\*\*



Pattern الحالي صحيح: read operations يمكنها العمل بدون branch context (مثلاً `GET /employees` للـ superAdmin يُعيد كل الـ branches). لكن write operations يجب أن يكون لها `targetBranchId` صريح أو يُرفض الطلب. هذا مُطبَّق في \[`employees.ts:133`](packages/api/routes/employees.ts:133) — `POST /` يرفض إذا كان `targetBranchId == null`. النموذج صحيح.



\### B. هل يجب منع operations بدون branch context؟



\*\*Writes: نعم — يُطبَّق حالياً بشكل صحيح في employees.\*\*  

\*\*Reads: لا — لكن يجب وجود حارس صريح عند `branchId = null` + `isSuperAdmin = false` يرفض بدلاً من الـ fallthrough الصامت.\*\*



المطلوب إضافته في `GET /`:

```typescript

if (targetBranchId == null \&\& !authContext.isSuperAdmin) {

&#x20; return res.status(400).json({ error: 'يجب تحديد الفرع' });

}

```



\### C. هل current model يسمح privilege leaks بين الفروع؟



\*\*مع GLOBAL scope (الوضع الحالي): نعم، لكنه مقصود مؤقتاً.\*\*



كل المستخدمين لديهم GLOBAL grants من Phase 2A backfill. `authorize()` لـ GLOBAL لا تُجري أي branch check. مستخدم branch 1 يمكنه نظرياً طلب بيانات branch 2 إذا عرف ID موظف من branch 2. الحماية الوحيدة حالياً هي `allowedBranchIds` للقراءة العامة (list)، لكن `GET /:id` يفتح GLOBAL access لأي record.



هذا ليس bug — هو التصميم المقصود للـ GLOBAL scope. لكنه يعني أن \*\*enforcement حقيقي لا يوجد حتى يتم تحويل scope\_type من GLOBAL إلى BRANCH\*\* في `role\_permission\_grants`.



\*\*مع BRANCH scope (المستقبل): لا، النموذج صحيح\*\* — `allowedBranchIds` من `user\_branch\_assignments` ستكون المرجع الوحيد.



\### D. هل current design scale-ready (100+ branches / آلاف users)؟



\*\*الـ cache يحميك على المدى القريب.\*\* `Promise.all` للـ grants والـ assignments + in-memory cache بـ 5 دقائق TTL يعني كل request لا يضرب DB (في الغالب). لكن:



\- الـ cache هو process-local — في multi-instance deployment (load balancer + N instances)، تغيير في assignments لن يُبطل cache الـ instances الأخرى

\- لا يوجد redis أو distributed cache

\- لـ 1000 user active في نفس الوقت على N instances: `N × 1000` cache entries مختلفة محتملة



للـ 100 branches مع أعداد users معقولة (< 1000 concurrent): الـ current design كافٍ. لأكثر من ذلك أو multi-instance: يحتاج distributed cache قبل Phase 3 أو Phase 4 على الأقل.



\---



\## 5. Required Fixes



\### \[يجب قبل أي توسع — Blocking]



\*\*أ. إصلاح `requireNotHQOnly` لتستخدم المصادر الرسمية:\*\*



الخيار الأبسط:

```typescript

export function requireNotHQOnly(req: Request, res: Response, next: NextFunction) {

&#x20; if (!ensureUser(req, res)) return;



&#x20; // إذا تم بناء authContext مسبقاً (via requirePermission)، استخدمه مباشرة

&#x20; if (req.authContext) {

&#x20;   if (req.user.isSuperAdmin === true \&\& req.authContext.actingBranchId == null) {

&#x20;     return res.status(403).json({

&#x20;       error: 'هذه الصفحة متاحة على مستوى الفرع فقط. يرجى اختيار فرع من محول الفروع.',

&#x20;     });

&#x20;   }

&#x20;   req.scope = {

&#x20;     userId: req.authContext.userId,

&#x20;     isSuperAdmin: req.authContext.isSuperAdmin,

&#x20;     branchId: req.authContext.actingBranchId,

&#x20;   };

&#x20;   return next();

&#x20; }



&#x20; // بناء authContext للـ modules التي تستخدم \[requireAuth, requireNotHQOnly] فقط

&#x20; buildAuthContext({

&#x20;   user: req.user,

&#x20;   headerBranchId: req.header('x-branch-id'),

&#x20; }).then(authContext => {

&#x20;   req.authContext = authContext;

&#x20;   if (req.user.isSuperAdmin === true \&\& authContext.actingBranchId == null) {

&#x20;     return res.status(403).json({

&#x20;       error: 'هذه الصفحة متاحة على مستوى الفرع فقط. يرجى اختيار فرع من محول الفروع.',

&#x20;     });

&#x20;   }

&#x20;   req.scope = {

&#x20;     userId: authContext.userId,

&#x20;     isSuperAdmin: authContext.isSuperAdmin,

&#x20;     branchId: authContext.actingBranchId,

&#x20;   };

&#x20;   next();

&#x20; }).catch(err => {

&#x20;   console.error('requireNotHQOnly auth error:', err);

&#x20;   res.status(500).json({ error: 'خطأ في التحقق من الصلاحيات' });

&#x20; });

}

```



\*\*ب. إضافة حارس صريح في `GET /employees` للـ non-superAdmin بدون branch:\*\*



\[`employees.ts:60`](packages/api/routes/employees.ts:60) — قبل الـ call الأخير:

```typescript

// بعد resolve targetBranchId وقبل getEmployees

if (targetBranchId == null \&\& !authContext.isSuperAdmin) {

&#x20; return res.status(400).json({ error: 'يجب تحديد الفرع المطلوب' });

}

```



هذا يُغلق الـ path الصامت ويجعل الـ failure explicit.



\### \[قبل Phase 3]



\*\*ج. توثيق سلوك superAdmin مع assignments:\*\*

```typescript

// في resolveActingBranch:

// NOTE: superAdmins with user\_branch\_assignments are restricted to those branches only.

// To grant unrestricted access, ensure user has NO active branch assignments.

```



\*\*د. استدعاء `clearAuthorizationCache(userId)` عند تعديل `user\_branch\_assignments` أو `role\_permission\_grants`:\*\*

عند بناء management endpoints في Phase 3، يجب أن يكون استدعاء cache invalidation جزءاً إلزامياً من كل write operation على هذين الجدولين.



\*\*هـ. مراجعة `listEmployees` للتأكد من أن `branchId: null` مع `isSuperAdmin: false` لها guard:\*\*

حتى لو كان الـ fix في (ب) يمنع الوصول، الـ `listEmployees` يجب ألا تُعيد كل البيانات عند `branchId = null` كـ fail-safe.



\---



\## 6. Readiness for Phase 3



\*\*للبدء في Phase 3 بأمان، يجب أن تكون هذه الشروط محققة:\*\*



| الشرط | الحالة الآن |

|---|---|

| `requireNotHQOnly` تستخدم canonical sources | ❌ يجب إصلاحها |

| كل route modules تمر عبر `authorize()` | ❌ الـ branchOnly modules لا تفعل |

| guard صريح لـ null-branchId + non-superAdmin | ❌ غائب في GET / |

| `clearAuthorizationCache` مربوط بـ data changes | ⚠️ لا توجد write endpoints بعد |

| `hr\_users.branch\_id` fallback موثق ومقيّد | ✅ موجود مع تعليق |

| BRANCH scope code صحيح ومجهّز | ✅ جاهز |

| employees module نموذج للتطبيق | ✅ جاهز |



\*\*قبل إزالة `hr\_users.branch\_id` (Phase 3):\*\*

1\. إصلاح `requireNotHQOnly` أولاً

2\. التحقق أن كل users لديهم `user\_branch\_assignments` (لا يوجد user بـ `allowedBranchIds = \[]` غير superAdmin)

3\. حذف `PHASE2B\_LEGACY\_FALLBACK` في `resolvePrimaryBranchId`

4\. إزالة `branchId` من `AuthUser` type والـ JWT payload

5\. تعديل `loadAuthorizationData` ليحذف `legacyBranchId` و`cacheBranchId`



\---



\## 7. Final Verdict



\## \*\*Needs fixes before continuing\*\*



الأساس المعماري صحيح — Phase 1 blocking issues حُلّت، `authorize()` هي نقطة القرار الوحيدة، `buildAuthContext` يقرأ من canonical sources، وتنفيذ `employees` نموذج سليم.



لكن \*\*ثمانية modules كاملة لا تزال على legacy path\*\* بسبب `requireNotHQOnly`. هذه ليست مسألة "سنعود إليها لاحقاً" — هي حجر عثرة مباشر أمام هدف Phase 3 الأساسي (إزالة `hr\_users.branch\_id`). التوسع إلى modules إضافية بدون إصلاح `requireNotHQOnly` يعني توسيع legacy path بدل تضييقه.



أصلح (أ) و(ب) أولاً، ثم وسّع.

