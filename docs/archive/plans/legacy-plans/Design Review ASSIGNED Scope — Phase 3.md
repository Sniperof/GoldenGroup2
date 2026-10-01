\# Design Review: ASSIGNED Scope — Phase 3



\---



\## 1. Executive Summary



الكود يكشف عن \*\*أربعة أنماط assignment مختلفة\*\* تماماً في طبيعتها، اثنان منها فقط صالحان لـ ASSIGNED scope في Phase 3. الخطر الرئيسي ليس تعقيد الـ ASSIGNED model في حد ذاته — بل هو \*\*الخلط بين الأنماط الأربعة وتحميل authorize() مسؤولية لا تناسبها\*\*.



السطر الأهم الذي يحدد شكل Phase 3 بالكامل:



```typescript

// candidates.ts:7

router.use(requireAuth);  // ← لا permission checks أصلاً

// referralSheets.ts — لا auth middleware إطلاقاً

```



قبل بناء ASSIGNED policy، يجب مواجهة هذه الحقيقة: الوحدتان اللتان تحملان `owner\_user\_id` (الحقل الوحيد المرشح المباشر لـ ASSIGNED) لا تمران حتى بـ `requirePermission` بعد. هذا يعني Phase 3 لا تبدأ بـ ASSIGNED — تبدأ بإضافة authorization أساسي لهذين الـ modules أولاً.



\---



\## 2. Current Assignment Patterns in the Codebase



\### النمط الأول: HR User Ownership (ملكية مباشرة)



| الجدول | الحقل | نوع المرجع | الـ FK؟ |

|---|---|---|---|

| `candidates` | `owner\_user\_id` | `hr\_users.id` | لا |

| `candidates` | `created\_by` | `hr\_users.id` | لا |

| `referral\_sheets` | `owner\_user\_id` | `hr\_users.id` | لا |

| `referral\_sheets` | `created\_by` | `hr\_users.id` | لا |

| `telemarketing\_appointments` | `created\_by` | `hr\_users.id` | لا |



\*\*الدلالة\*\*: "من يملك هذا السجل" — المستخدم الـ HR هو المالك مباشرةً. هذا هو الـ pattern الوحيد الذي يتطابق طبيعياً مع `context.userId` في `AuthContext`.



\---



\### النمط الثاني: Employee Work Assignment (تكليف عمل)



| الجدول | الحقل | نوع المرجع | الـ FK؟ |

|---|---|---|---|

| `dues` | `assigned\_telemarketer\_id` | `employees.id` | لا |

| `maintenance\_requests` | `technician\_id` | `employees.id` | لا |

| `maintenance\_requests` | `telemarketer\_id` | `employees.id` | لا |

| `visits` | `employee\_id` | `employees.id` | لا |

| `emergency\_tickets` | `assigned\_technician\_id` | `employees.id` | لا |

| `telemarketing\_call\_logs` | `called\_by` | `hr\_users.id` | لا |



\*\*الدلالة\*\*: "من كُلّف بهذا العمل" — المرجع هو `employees.id`، وليس `hr\_users.id`. للوصول عبر ASSIGNED، يجب مسار: `hr\_users.employee\_id == resource.employee\_id`. هذا الـ join غير موجود في `AuthContext` الحالي.



\---



\### النمط الثالث: Audit Trail (سجل تدقيق)



| الجدول | الحقل | النوع |

|---|---|---|

| `job\_applications` | `entered\_by\_user\_id` | hr\_users reference |

| `training\_courses` | `created\_by\_user\_id` | hr\_users reference |

| `training\_attendance` | `recorded\_by\_user\_id` | hr\_users reference |

| `audit\_logs` | `performed\_by\_user\_id` | hr\_users reference |



\*\*الدلالة\*\*: "من أدخل هذا السجل" — هذا للـ audit وليس للـ authorization. لا يجب تحميله معنى authorization أبداً. "أنت أدخلت هذا السجل" لا يعني "يحق لك تعديله."



\---



\### النمط الرابع: Structural / No Explicit Assignment



| الجدول | الملاحظة |

|---|---|

| `tasks` | لا يوجد user assignment نهائياً — branch-scoped فقط |

| `day\_schedules` | JSONB teams/solos — ليس hr\_user reference |

| `contracts` | لا assignment — customer-linked فقط |

| `clients` | لا assignment — branch-scoped فقط |

| `route\_assignments` | JSONB — ليس user-id |

| `telemarketing\_task\_lists` | `team\_key` VARCHAR — ليس user FK |



\*\*الدلالة\*\*: هذه الوحدات لا تدعم ASSIGNED scope بطبيعتها. لا يوجد ما يُربط به.



\---



\### الـ bridge الحاسم: `hr\_users.employee\_id`



```sql

\-- migration 003

hr\_users.employee\_id INTEGER REFERENCES employees(id) UNIQUE (nullable)

```



هذا الـ link هو ما يربط النمطين الأول والثاني. لكنه:

\- nullable — ليس كل hr\_user له employee record

\- UNIQUE — علاقة 1:1 فقط

\- غير موجود في `AuthContext` الحالي



\---



\## 3. Recommended Canonical Policy Model



\### الأنماط الرسمية المدعومة في Phase 3



\*\*فئة واحدة فقط:\*\* `OWNER` — المستخدم يملك السجل إذا كان `resource.owner\_user\_id == context.userId`.



هذا هو التعريف الرسمي والوحيد لـ ASSIGNED scope في Phase 3. قرار واضح:



```

ASSIGNED scope → يعني: "يمكنك الوصول إلى هذا السجل لأنك مالكه"

المالك = hr\_user مُعرَّف بـ owner\_user\_id

السياق = context.userId (hr\_users.id)

```



\### ما يجب \*\*رفضه\*\* في Phase 3:



\*\*لا تدعم "creator-based" كـ ASSIGNED:\*\*

`created\_by` حقل audit — الـ creator ليس بالضرورة المالك. مستخدم يُدخل سجلاً نيابةً عن شخص آخر يجب ألا يصبح مالكاً. `created\_by ≠ owner\_user\_id`.



\*\*لا تدعم employee-based assignment:\*\*

`dues.assigned\_telemarketer\_id`, `visits.employee\_id`, إلخ — تتطلب `employeeId` في `AuthContext` الذي لا يوجد الآن. أضف هذا كـ Phase 4 مستقلة.



\*\*لا تدعم multi-party ownership:\*\*

لا يوجد حالياً في الـ schema ما يدعم "owned by list of users" — حقل واحد `owner\_user\_id`. لا تخترع abstraction غير موجودة في البيانات.



\### لماذا ASSIGNED وليس subtype منفصل؟



الـ ASSIGNED scope في `role\_permission\_grants` يبقى مفهوماً موحداً. الـ subtype (من نوع owner vs. assignee vs. creator) يُحسم على مستوى الـ policy helper، ليس على مستوى الـ schema. هذا يحافظ على بساطة الـ DB model.



\---



\## 4. Relationship to Branch Scope



\### هل ASSIGNED يتجاوز BRANCH؟



\*\*لا — ASSIGNED يجب أن يبقى داخل Branch scope.\*\*



المنطق: إذا نُقل مستخدم من branch 1 إلى branch 2، وبقيت له candidates مملوكة في branch 1 — هل يجب أن يرى هذه الـ candidates؟



\*\*الجواب الآمن: لا.\*\* إذا أردنا إبقاء وصوله، نضيف `user\_branch\_assignments` لـ branch 1 أيضاً. هذا explicit وقابل للـ audit. ASSIGNED scope كـ "backdoor للـ branch check" يخلق حالات غير قابلة للتتبع.



\### الـ invariant المطلوب:



```

ASSIGNED access = (resource.owner\_user\_id == context.userId)

&#x20;                 AND (resource.branch\_id ∈ context.allowedBranchIds

&#x20;                      OR context.isSuperAdmin)

```



هذا يعني `authorizeAssignedGrant` في Phase 3 يجب أن يتحقق من \*\*كلا الشرطين\*\*، وليس فقط `assignedUserId`.



\---



\## 5. Policy Layer Design



\### هل يكفي `authorize()` + helpers؟



\*\*نعم — لكن بشرط: helpers واجبة وليست اختيارية.\*\*



المشكلة مع المتصيد: كل route يستخدم `authorize()` مباشرةً يجب أن يمرر `branchId` و`assignedUserId` بشكل صحيح. هذا عبء على كل من يكتب route. الـ helper يُخفي هذا العبء ويجعل الـ contract واضحاً.



\### شكل الـ helpers الصحيح:



```typescript

// packages/api/policies/candidatePolicy.ts



interface CandidateAccessParams {

&#x20; branchId: number;

&#x20; ownerUserId: number | null;

}



export function canViewCandidate(

&#x20; ctx: AuthContext,

&#x20; candidate: CandidateAccessParams,

): AuthorizationResult {

&#x20; return authorize(ctx, {

&#x20;   permission: 'candidates.view',

&#x20;   branchId: candidate.branchId,

&#x20;   assignedUserId: candidate.ownerUserId ?? undefined,

&#x20; });

}



export function canEditCandidate(

&#x20; ctx: AuthContext,

&#x20; candidate: CandidateAccessParams,

): AuthorizationResult {

&#x20; return authorize(ctx, {

&#x20;   permission: 'candidates.edit',

&#x20;   branchId: candidate.branchId,

&#x20;   assignedUserId: candidate.ownerUserId ?? undefined,

&#x20; });

}

```



\### لماذا هذا الشكل؟



\- الـ route handler يُمرر الـ domain object — لا يفكر في بناء الـ check يدوياً

\- الـ permission string مُعرَّف في مكان واحد لكل entity

\- إذا تغيّر اسم الـ permission في المستقبل، يتغيّر في مكان واحد

\- قابل للـ unit test بدون HTTP context



\### ما لا نحتاجه:



لا policy engine، لا rule evaluation، لا ABAC. `authorize()` + domain helpers كافيان للـ use cases الحالية. الـ policy engine يكون ضرورياً عند: conditions ديناميكية، delegation، attribute-based rules — لا شيء من هذا موجود.



\---



\## 6. Best First Module: `candidates`



\### لماذا candidates وليس referral\_sheets؟



\*\*`referral\_sheets` لا تمتلك authentication أصلاً:\*\*



```typescript

// referralSheets.ts:1-4

import { Router } from 'express';

import pool from '../db.js';

// ← لا requireAuth، لا requirePermission

const router = Router();

```



`referral\_sheets` مفتوح تماماً. لا يمكن اختبار ASSIGNED scope على module بدون authentication.



\*\*`candidates` لديها `requireAuth` على الأقل\*\*, و`owner\_user\_id` موجود فعلاً في كل query SELECT وINSERT وUPDATE. البيانات متوفرة، المرجع (hr\_users.id) مطابق لـ `context.userId`.



\### معايير الاختيار:



| المعيار | Candidates | Referral Sheets |

|---|---|---|

| Authentication موجود | ✅ `requireAuth` | ❌ لا شيء |

| `owner\_user\_id` موجود | ✅ | ✅ |

| `branch\_id` موجود | ✅ migration 014 | ❌ لا branch |

| BRANCH + ASSIGNED interaction | ✅ قابل للاختبار | ❌ مستحيل |

| Nullable owner (edge case) | ✅ موجود وقابل للتعامل | ✅ |

| Business clarity | ✅ "مرشح مملوك لمستخدم" واضح | ⚠️ أقل وضوحاً |



\### ملاحظة مهمة على `referral\_sheets`:



`referral\_sheets` لا تملك `branch\_id`. هذا يعني ASSIGNED scope ستكون فيها بدون branch constraint — وهو بالضبط ما قلنا يجب تجنبه. \*\*لا تُفعّل ASSIGNED على referral\_sheets قبل إضافة `branch\_id` إليها أولاً.\*\*



\---



\## 7. What to Defer



\### أجّل في Phase 3:



\*\*أ. Employee-based assignment:\*\*

`dues.assigned\_telemarketer\_id`, `maintenance\_requests.technician\_id`, `visits.employee\_id` — كلها تحتاج `employeeId` في `AuthContext`. هذا يتطلب:

1\. إضافة `employeeId` لـ `AuthUser` (JWT field)

2\. تحميله في `loadAuthorizationData`

3\. تحديث كل JWT مُولَّد



هذا تغيير في JWT structure — Phase مستقلة.



\*\*ب. Manager-based access:\*\*

`employees.direct\_manager\_id` — "مدير يرى بيانات مرؤوسيه" هو policy hierarchy معقد. يتطلب recursive query أو materialized path. لا مكانه في Phase 3.



\*\*ج. Team-based assignment:\*\*

`day\_schedules` JSONB teams، `telemarketing\_task\_lists` team\_key — هذه ليست user FK. تحليل "هل المستخدم في هذا الـ team" يتطلب قرار تصميمي منفصل تماماً.



\*\*د. `referral\_sheets` حتى يحصل على `branch\_id`:\*\*

لا تُفعّل ASSIGNED على جدول بدون branch constraint.



\### ما هو over-engineering لو أُدخل الآن:



\- Policy inheritance (role A يرث من role B)

\- Delegation (user A يُفوّض user B)

\- Temporal access ("وصول مؤقت حتى تاريخ كذا")

\- Resource-level permissions بدلاً من type-level



\---



\## 8. Risks and Safeguards



\### Top 5 Risks إذا فُعّل ASSIGNED بدون policy model مضبوط:



\*\*Risk 1: ASSIGNED تتجاوز BRANCH constraint\*\*

إذا بُنيت `authorizeAssignedGrant` بدون branch check — مستخدم منقول من branch 1 إلى branch 2 يحتفظ بوصول كامل لـ candidates branch 1 التي "امتلكها" قبل النقل. لا يوجد revocation mechanism.



\*\*Risk 2: `created\_by` يُستخدم كـ assignedUserId\*\*

إذا ربط مطور `created\_by` بـ ASSIGNED check — كل من أدخل سجلاً يصبح "مالكاً" له. هذا يكسر سيناريو "موظف يُدخل سجلاً نيابةً عن مديره."



\*\*Risk 3: `owner\_user\_id = null` يُعامَل كـ "مملوك للجميع"\*\*

إذا لم يُوجد guard على `null` — `authorize(ctx, { assignedUserId: null })` ستنتج `ASSIGNMENT\_FORBIDDEN` لأن `null !== context.userId`. هذا صحيح. لكن إذا كتب مطور `??`:

```typescript

assignedUserId: candidate.ownerUserId ?? ctx.userId  // ← bug خطير

```

هذا يعطي الجميع ownership على السجلات غير المُعيَّنة.



\*\*Risk 4: Employee-based assignment تُعامَل كـ hr\_user ownership\*\*

`dues.assigned\_telemarketer\_id` هو `employees.id`، وليس `hr\_users.id`. إذا مرّر مطور هذا مباشرةً لـ `assignedUserId` — سيقارن employee ID برقم hr\_user ID. قد تتطابق الأرقام بالصدفة لبعض المستخدمين وتُعطي access خاطئ.



\*\*Risk 5: Cache لا يُبطل عند تغيير `owner\_user\_id`\*\*

تغيير ملكية candidate (نقله من مستخدم لآخر) لا يُبطل الـ cache. المستخدم السابق قد يحتفظ بوصوله لمدة 5 دقائق. هذا ليس حالة نادرة في CRM workflows.



\### Top 5 Design Safeguards:



\*\*أ. تُقيّد authorizeAssignedGrant بـ branch check إلزامي:\*\*

```typescript

function authorizeAssignedGrant(

&#x20; context: AuthContext,

&#x20; check: AuthorizationCheck,

&#x20; grant: PermissionGrant,

): AuthorizationResult {

&#x20; // MUST check branch first

&#x20; if (!context.isSuperAdmin) {

&#x20;   const branchId = toPositiveInteger(check.branchId);

&#x20;   if (branchId == null || !context.allowedBranchIds.includes(branchId)) {

&#x20;     return { allowed: false, reason: 'BRANCH\_FORBIDDEN', grant };

&#x20;   }

&#x20; }

&#x20; // Then check ownership

&#x20; const assignedUserId = toPositiveInteger(check.assignedUserId);

&#x20; if (assignedUserId == null || assignedUserId !== context.userId) {

&#x20;   return { allowed: false, reason: 'ASSIGNMENT\_FORBIDDEN', grant };

&#x20; }

&#x20; return { allowed: true, reason: 'GRANTED\_ASSIGNED', grant };

}

```



\*\*ب. Domain helpers واجبة — لا raw `authorize()` call في routes:\*\*

أضف ESLint rule أو تعليق توجيهي: routes لا تستدعي `authorize()` مباشرةً لـ candidates — تستدعي `canViewCandidate()` فقط. هذا يمنع `assignedUserId: null` bugs.



\*\*ج. اختبار صريح لـ null ownership:\*\*

الـ policy helper يتعامل صراحةً مع `ownerUserId = null`:

```typescript

// null owner = not assigned to anyone = ASSIGNED scope cannot grant access

assignedUserId: candidate.ownerUserId ?? undefined,

// عند undefined → authorize يتجاهل ASSIGNED check ويقع على scope type

```



\*\*د. لا تُضف `employeeId` لـ AuthContext دون migration plan:\*\*

قرار إضافة `employeeId` للـ JWT يتطلب: token rotation plan، backward compatibility، وتوثيق. لا تفعل هذا بـ patch.



\*\*هـ. استدعاء `clearAuthorizationCache` عند تغيير ownership:\*\*

أي endpoint يُعدّل `owner\_user\_id` يجب أن يستدعي `clearAuthorizationCache(previousOwnerId)` و`clearAuthorizationCache(newOwnerId)`. هذا يجب أن يكون جزءاً من تعريف "انتهى التنفيذ".



\---



\## 9. Final Recommendation



\### قبل كتابة سطر واحد من Phase 3 ASSIGNED، افعل ثلاثة أشياء:



\*\*أولاً: أضف `requirePermission` لـ `candidates` route (قبل ASSIGNED)\*\*

الـ route حالياً على `requireAuth` فقط — لا يمر عبر `authorize()` أصلاً. يجب إصلاح هذا أولاً حتى يكون لتفعيل ASSIGNED معنى.



\*\*ثانياً: حدّث `authorizeAssignedGrant` لتشترط branch check\*\*

قبل أي تفعيل. بدون هذا الـ invariant، ASSIGNED تكون ثغرة.



\*\*ثالثاً: ابنِ `canViewCandidate` و`canEditCandidate` helpers قبل استخدامها\*\*

لا تُفعّل scope جديد بدون helper layer — الـ raw authorize calls في routes خطرة.



\### ما يُعرّف نجاح Phase 3:



1\. `candidates` module تعمل بـ GLOBAL scope ✓

2\. تعمل بـ BRANCH scope ✓

3\. تعمل بـ ASSIGNED scope (owner فقط يرى/يعدّل) ✓

4\. مستخدم بـ ASSIGNED scope ولا يملك الـ candidate → 403 ✓

5\. مستخدم بـ ASSIGNED scope خارج الـ branch → 403 ✓

6\. `owner\_user\_id = null` → ASSIGNED يُرفض، GLOBAL/BRANCH يمر ✓

