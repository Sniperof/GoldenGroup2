\*\*تحليل قبل التنفيذ\*\*

التعديل كان محدوداً في ملفين فقط: \[packages/api/policies/candidatePolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/candidatePolicy.ts:1) لتمرير `owner\_user\_id` إلى `authorize()` في عمليات candidate نفسها، و\[packages/api/services/authorizationService.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/services/authorizationService.ts:1) لتفعيل `ASSIGNED` فعلياً مع branch check مدمج.



الدمج تم بهذه الفكرة:

\- `candidatePolicy` يمرر `branchId` دائماً

\- وفي `view/edit/delete` يمرر أيضاً `assignedUserId = owner\_user\_id`

\- `authorize()` عند grant من نوع `ASSIGNED` لا يكتفي بالـ owner، بل يتحقق أيضاً أن `candidate.branch\_id` ضمن `allowedBranchIds`

\- بهذا لا يمكن لـ `ASSIGNED` أن يتجاوز branch enforcement



وأبقيت مؤجلاً عمداً:

\- أي استخدام لـ `created\_by`

\- أي تعديل على schema أو grants data

\- أي توسيع لوحدات غير `candidates`

\- أي team/multi-owner logic



\*\*التنفيذ\*\*

فعّلت `ASSIGNED` في `candidatePolicy` لعمليات:

\- `canViewCandidate`

\- `canEditCandidate`

\- `canDeleteCandidate`



بحيث تمرر:

\- `branchId`

\- `assignedUserId = owner\_user\_id`



أما `canCreateCandidate` فتركته branch-only محافظاً، حتى لا يصبح الإنشاء معتمداً على owner قبل الحاجة الفعلية لذلك.



وفي `authorize()` صار سلوك `ASSIGNED` كالتالي:

1\. يتحقق أن `assignedUserId` موجود وغير null

2\. يتحقق أن `assignedUserId === context.userId`

3\. يتحقق أن `branchId` أو branch السياق الفعلي موجود

4\. يتحقق أن هذا الفرع ضمن `context.allowedBranchIds`



إذا كان `owner\_user\_id = null`:

\- لا يُعتبر assigned

\- ومع grant من نوع `ASSIGNED` تكون النتيجة رفضاً واضحاً

\- أما إذا كان grant من نوع `GLOBAL` أو `BRANCH` فالسلوك يبقى كما هو بدون أي كسر



تحققت من البناء:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير بعد التنفيذ\*\*

تم تفعيل `ASSIGNED` باستخدام `owner\_user\_id` فقط، ولم يُستخدم `created\_by` إطلاقاً.



كيف تم دمجه مع `BRANCH`:

\- `ASSIGNED` لا ينجح إلا إذا تحقق الشرطان معاً:

&#x20; - `candidate.owner\_user\_id === authContext.userId`

&#x20; - `candidate.branch\_id ∈ authContext.allowedBranchIds`



كيف تم التعامل مع `null owner`:

\- لا يُعتبر assigned

\- ومع grant من نوع `ASSIGNED` يتم الرفض

\- `GLOBAL` و`BRANCH` بقيا بدون تغيير



هل بقي path غير محمي؟

\- داخل `candidates` لا، نفس enforcement من Phase 3A بقي فعالاً

\- هذه المرحلة أضافت فقط ownership check فوقه في المسارات المناسبة



ما الذي لم يتم لمسه عمداً:

\- لم أغيّر `GLOBAL`

\- لم أغيّر `BRANCH`

\- لم أستخدم `created\_by`

\- لم أفعّل `ASSIGNED` في أي وحدة غير `candidates`

\- لم أضف schema أو policy engine أوسع

