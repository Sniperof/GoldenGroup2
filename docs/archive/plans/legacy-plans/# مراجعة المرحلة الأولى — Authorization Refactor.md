

\# مراجعة المرحلة الأولى — Authorization Refactor



\---



\## 1. Executive Summary



التنفيذ بنى foundation layer حقيقية — الـ types مدروسة، الـ scope model سليم، والـ `authorize()` function مكتوبة بشكل نظيف. لكن هناك ثلاثة عيوب معمارية بنيوية تُضعف الأساس بالضبط في النقاط التي يجب أن تكون صلبة: \*\*تكرار `attachScope` بسلوك مختلف في كل نسخة\*\*، \*\*تجاوز `authorize()` لسيناريو superAdmin\*\* في نقطتين مستقلتين، و\*\*`authContext` فارغ الـ grants في كل entry point بشكل مؤقت\*\* مع غياب حارس واضح يمنع استخدامه خطأ. هذه ليست مخاوف مستقبلية — هي عيوب في الأساس الآن.



\---



\## 2. What Was Done Well



\*\*الـ type model ممتاز:\*\*

\[`authorization.ts`](packages/shared/types/authorization.ts:1) نظيف ومدروس. `ScopeType` كـ const tuple، `AuthorizationResult` مع `reason` enum بدلاً من boolean بسيط — هذا قرار صحيح يُسهّل debugging وauditing في المرحلة الثانية.



\*\*`authorize()` الـ core logic سليم:\*\*

\[`authorizationService.ts:69`](packages/api/services/authorizationService.ts:69) — الفصل بين `authorizeBranchGrant` و`authorizeAssignedGrant` كـ private functions صحيح. الـ switch case exhaustive. `toPositiveInteger` helper يمنع type coercion bugs.



\*\*الـ placement صحيح:\*\*

الأنواع في `packages/shared`، المنطق في `packages/api/services`. REST وtRPC يستهلكان نفس الـ service. هذا يحقق بند 8 من الميثاق.



\*\*لا اعتماد جديد على `hr\_users.role` النصي:\*\*

الكود الجديد كله يستخدم `roleId`. `requireRole` المتبقية فيها تعليق صريح بأنها legacy. هذا انضباط مقبول.



\*\*`resolveActingBranch` منطقه صحيح:\*\*

المنطق الأساسي لحل branch ID من header سليم ومنيع ضد negative IDs وstring injection.



\---



\## 3. Architectural Concerns



\### \[BLOCKING] تكرار `attachScope` بسلوك متباين



كلا الملفين يعرّفان دالة `attachScope` خاصة:



\- \[`auth.ts:18`](packages/api/middleware/auth.ts:18) — تبني \*\*scope + authContext\*\* (بـ `permissions: \[]`)

\- \[`permission.ts:28`](packages/api/middleware/permission.ts:28) — تبني \*\*scope فقط\*\*



النتيجة: `requireAuth` → `attachScope(auth)` → `req.authContext` يُبنى بـ grants فارغة. ثم `requirePermission` → `attachScope(permission)` → `req.authContext` يُعاد بناؤه بالـ permissions الحقيقية.



هذا يعني الـ `authContext` المبني في `auth.ts` هو context ميت فوراً — وجوده يوهم القارئ بأن المسار حصل على authorization حقيقية. أي route يستخدم `requireAuth` فقط بدون `requirePermission` لديه `authContext` مع `grants: \[]` — وكل `authorize()` عليه ستعطي `MISSING\_PERMISSION` للجميع بدون أي warning أو خطأ واضح.



كذلك: `auth.ts::attachScope` تستخدم `(req as any).scope` على السطر 27 رغم أن `scope` معرّف كـ typed property في Express namespace — هذا يدل على أن الملفين لم يُنسَّقا بالكامل.



\### \[BLOCKING] الـ `isSuperAdmin` pre-check يتجاوز `authorize()`



في \[`permission.ts:95`](packages/api/middleware/permission.ts:95):

```typescript

if (req.user.isSuperAdmin === true) {

&#x20; attachAuthContext(req);  // grants: \[]

&#x20; return next();           // يمر مباشرة — authorize() لم يُستدعَ أبداً

}

```



وفي \[`trpc/init.ts:69`](packages/api/trpc/init.ts:69):

```typescript

if (ctx.user.isSuperAdmin) return next({ ctx });  // bypass كامل

```



الميثاق البند 7 يقول "authorization decision يجب أن تتجمع في طبقة مركزية موحدة". `authorize()` بداخله بالفعل:

```typescript

if (context.isSuperAdmin) {

&#x20; return { allowed: true, reason: 'SUPER\_ADMIN' };

}

```



الـ pre-checks تخلق \*\*مسارين\*\* لاتخاذ قرار الـ authorization — هذا يتعارض مع هدف المرحلة الأولى الأساسي. إذا تغيّر منطق superAdmin في المستقبل (مثلاً: superAdmin suspended، أو multi-level admin)، يجب تعديله في ثلاثة أماكن بدلاً من واحد.



\### \[HIGH] `createContext` في tRPC يبني dummy authContext فارغ



\[`trpc/init.ts:34-40`](packages/api/trpc/init.ts:34):

```typescript

authContext: buildAuthContext({

&#x20; user,

&#x20; permissions: \[],  // فارغ دائماً

&#x20; actingBranchId,

}),

```



كل procedure يستخدم `authedProcedure` فقط (بدون `withPermission`) لديه `ctx.authContext` مع `grants: \[]`. إذا استدعى أي كود downstream `authorize(ctx.authContext, ...)` ظناً أنه context حقيقي — سيرفض كل شيء صامتاً. الـ context الوهمي هذا هو trap جاهزة للمرحلة الثانية.



\### \[MEDIUM] `resolveTargetBranchId` هو مسار ثالث مستقل



\[`permission.ts:162`](packages/api/middleware/permission.ts:162) — هذه الدالة تحل branch ID بمنطقها الخاص (body > header) دون استدعاء `resolveActingBranch`. الآن لدينا ثلاث implementations لحل branch:

1\. `resolveActingBranch()` في authorizationService

2\. `attachScope` في permission.ts (via resolveActingBranch)

3\. `resolveTargetBranchId` (منطق مستقل)



هذا بالضبط ما يجب أن تمنعه المرحلة الأولى.



\### \[MEDIUM] `requireNotHQOnly` يُعدّل `req.scope` في منتصف الطلب



\[`permission.ts:153`](packages/api/middleware/permission.ts:153):

```typescript

if (req.scope) req.scope.branchId = req.authContext.actingBranchId;

```



mutation على shared object بعد بنائه — يجعل التتبع صعباً ويخالف مبدأ immutability للـ context.



\---



\## 4. Security Concerns



\### هل `authorize()` نقطة قرار موحدة؟



\*\*لا، ليست موحدة بالكامل.\*\* الـ superAdmin check يحدث قبل الوصول إليها في مكانين (راجع أعلاه). الـ foundation صحيحة لكن التكامل معها ناقص.



\### هل يوجد bypass غير مقصود؟



\*\*نعم، bypass ضمني.\*\* كل route يستخدم `requireAuth` فقط دون `requirePermission` يحصل على `authContext` مع `grants: \[]`. إذا قرر مطوّر في المرحلة الثانية كتابة:

```typescript

const result = authorize(req.authContext!, { permission: 'some.perm' });

if (result.allowed) { ... }

```

بعد `requireAuth` فقط — سيحصل على `allowed: false` دائماً لغير superAdmins بدون أي خطأ. هذا ليس security hole لكنه \*\*behavioral trap\*\* يكسر الثقة في الـ foundation.



\### هل الـ GLOBAL fallback خطر؟



\*\*نعم، مشروط.\*\* تحويل كل permission إلى `GLOBAL` grant هو قرار مؤقت مقبول من حيث الاتجاه (لا توسيع للصلاحيات). لكن الخطر ليس في المنح — الخطر في أن كل branch-scoped resource يُقرأ ويُكتب حالياً بـ grant مستوى GLOBAL. عندما تأتي المرحلة الثانية وتُضيف BRANCH scope حقيقي، أي مقارنة بالسلوك الحالي ستكون تضييقاً مؤلماً وغير متوقع للمستخدمين.



\### هل `allowedBranchIds` placeholder آمن؟



\*\*آمن من حيث المنع، لكن وهمي من حيث الدلالة.\*\* `resolveActingBranch` يُستدعى دائماً بـ `allowedBranchIds` غير محددة (empty). المنطق داخله:

```typescript

if (allowedBranchIds.length === 0 || allowedBranchIds.includes(requestedBranchId)) {

&#x20; return requestedBranchId;

}

```

لـ superAdmin مع empty list → يقبل \*\*أي\*\* branch ID من الـ header دون تحقق. هذا مقصود، لكن الكود يوهم أن `allowedBranchIds` تقيد السوبر أدمن — وهو لا يفعل ذلك أبداً طالما القائمة فارغة.



\### هل `resolveActingBranch` آمن لهذه المرحلة؟



\*\*نعم، آمن كافياً\*\* للمرحلة الأولى. `toPositiveInteger` يمنع negative/zero/string branch IDs. المنطق لغير superAdmins صارم: لا تقبل إلا branchId الخاص بالمستخدم فقط.



\---



\## 5. Migration Concerns



\### هل الكود بقي ضمن النطاق؟



\*\*نعم إلى حد بعيد.\*\* لا big bang rewrite، لا مساس بـ business logic في الـ routes. هذا جيد.



\### هل حصل over-engineering؟



\*\*لا.\*\* `AuthorizationResult.reason` enum يبدو زائداً في المرحلة الأولى لكنه ضروري للـ audit trail وdebugging في المراحل اللاحقة.



\### هل حصل under-engineering؟



\*\*نعم، في نقطة واحدة محددة:\*\* الـ `authContext` الذي يُبنى في `requireAuth` بدون permissions هو under-engineering متعمد يخلق trap. كان يجب إما عدم بناؤه أصلاً في تلك المرحلة، أو وضع marker واضح عليه (`permissionsLoaded: false`).



\### هل هذا foundation مناسب للبناء عليه؟



\*\*جزئياً.\*\* الـ types والـ `authorize()` logic سليمة تماماً ومناسبة للبناء عليها. لكن تكرار `attachScope` وتجاوز `authorize()` للسوبر أدمن يعنيان أن المرحلة الثانية ستجد مفترق طرق مزدوجاً في كل entry point.



\---



\## 6. Specific Recommendations Before Phase 2



\### \[يجب تنفيذه الآن — Blocking]



\*\*أ. دمج `attachScope` في مكان واحد:\*\*

احذف `attachScope` من `auth.ts` كلياً. `requireAuth` يجب أن يضبط `req.user` فقط — لا scope، لا authContext. الـ scope والـ authContext يُبنيان فقط في `requirePermission` (لـ REST) و`withPermission` (لـ tRPC) بعد تحميل الـ permissions.



\*\*ب. أزل الـ `isSuperAdmin` pre-check من `requirePermission` و`withPermission`:\*\*

```typescript

// احذف هذا:

if (req.user.isSuperAdmin === true) {

&#x20; attachAuthContext(req);

&#x20; return next();

}

// ابقِ فقط هذا بعد loadPermissions:

const result = authorize(authContext, { permission: key });

// authorize() ستعالج isSuperAdmin داخلياً

```



\*\*ج. في tRPC — لا تبنِ authContext في `createContext` إذا لم تحمل permissions:\*\*

```typescript

// بدلاً من buildAuthContext مع permissions: \[]

// استخدم null أو استخدم نوع منفصل يدل على أنه غير مكتمل

authContext: null,  // يُبنى فقط داخل withPermission

```



\### \[يجب توثيقه رسمياً قبل Phase 2]



\*\*د. اشتراطات رفع الـ temporary assumptions:\*\*

أضف تعليقاً `// PHASE2\_REQUIRED` على كل موضع يحوّل permissions إلى GLOBAL:

```typescript

// PHASE2\_REQUIRED: Replace with actual scope from role\_permissions.scope column

grants: permissions.map(permission => ({

&#x20; permission,

&#x20; scope: 'GLOBAL',

})),

```



\*\*هـ. احظر `requireRole` من routes جديدة بشكل آلي:\*\*

أضف ESLint rule أو تعليق `@deprecated` قابل للـ lint يمنع أي import جديد لـ `requireRole` خارج المسارات الحالية.



\*\*و. وحّد `resolveTargetBranchId` مع `resolveActingBranch`:\*\*

إما دمجهما أو جعل `resolveTargetBranchId` تستدعي `resolveActingBranch` داخلياً. وجود منطقين مختلفين لحل الـ branch سيسبب divergence حتمياً.



\### \[قبل Phase 2]



اجعل `AuthUser.roleId` مطلوباً (`roleId: number`) في الـ JWT الجديدة وأضف validation عند login — المرحلة الثانية ستحتاجه إلزامياً.



\---



\## 7. Final Verdict



\## \*\*Request Changes\*\*



الـ foundation ليست فاسدة ولا خطيرة أمنياً — لكنها غير مكتملة بالشكل الذي يجعلها قابلة للبناء عليها بأمان في المرحلة الثانية. تحديداً:



\- وجود \*\*`attachScope` مكرر بسلوك مختلف\*\* يعني أن فهم ما هو مضمون في `req.authContext` عند أي middleware يتطلب تتبع سلسلة الاستدعاء — وهذا بالضبط ما كانت المرحلة الأولى تهدف إلى إزالته.

\- \*\*تجاوز `authorize()`\*\* في مكانين يكسر الـ invariant المركزي للـ foundation — وسيجعل كل توسيع مستقبلي لمنطق الـ superAdmin عملية "ابحث عن ثلاثة أماكن وعدّلها".

\- الـ \*\*dummy authContext بـ grants فارغة\*\* في كل entry point هو بالضبط نوع الـ "illusion of progress" الذي يجب تجنبه — يبدو أن المسار مؤمّن وهو ليس كذلك للـ use cases المستقبلية.



التغييرات المطلوبة صغيرة وغير خطرة، لكن يجب تنفيذها قبل البناء على هذا الأساس.

