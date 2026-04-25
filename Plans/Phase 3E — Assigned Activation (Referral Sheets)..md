\*\*تحليل قبل التنفيذ\*\*

فعّلت `ASSIGNED` في `referral\_sheets` عبر مسارين فقط: \[packages/api/policies/referralSheetPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/referralSheetPolicy.ts:1) و\[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:1). الفكرة كانت:

\- policy helpers تمرر `assignedUserId = assigned\_hr\_user\_id`

\- مع `branchId` دائماً

\- وبدون أي استعمال لـ `owner\_user\_id` أو `created\_by` في القرار الأمني



بالنسبة لـ `assigned\_hr\_user\_id = NULL`:

\- لا يُعتبر assigned

\- وبالتالي grant من نوع `ASSIGNED` فقط سيرفض

\- بينما `GLOBAL` و`BRANCH` يبقيان كما هما



وعند الإنشاء:

\- `assigned\_hr\_user\_id` أصبح مطلوباً

\- ويتم التحقق أنه يشير إلى `hr\_users.id` صالح

\- وما أجلته عمداً هو أي refactor أوسع أو أي fallback ownership قديم



\*\*التنفيذ\*\*

في `referralSheetPolicy`:

\- `canViewReferralSheet`

\- `canEditReferralSheet`

\- `canDeleteReferralSheet`



صارت تمرر إلى `authorize()`:

\- `branchId`

\- `assignedUserId = assignedHrUserId ?? null`



وأبقيت `canCreateReferralSheet` branch-only، لأن المطلوب هنا عدم كسر create behavior بمنطق ownership access زائد؛ ownership في create أصبح enforced من صحة الحقل ووجوده، لا من grant `ASSIGNED` نفسها.



في route:

\- `POST /referral-sheets` يرفض الآن إذا غاب `assignedHrUserId`

\- ويرفض إذا لم يكن يشير إلى سجل موجود في `hr\_users`

\- ويتم حفظه في `assigned\_hr\_user\_id`



وفي `PUT /referral-sheets/:id`:

\- إذا أُرسل `assignedHrUserId` جديد، يتم التحقق من صحته

\- وإذا لم يُرسل، يبقى الحقل الحالي كما هو

\- وaccess check في update صار يستخدم `assigned\_hr\_user\_id` فقط



تحققت من البناء:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[packages/api/policies/referralSheetPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/referralSheetPolicy.ts:1)

\- \[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:1)



كيف تم تفعيل `ASSIGNED`:

\- فقط عبر `assigned\_hr\_user\_id`

\- ومع branch check الإلزامي الموجود داخل `authorizeAssignedGrant`



هل أصبح `assigned\_hr\_user\_id` required عند create؟

\- نعم، والرفض واضح إذا كان مفقوداً أو غير صالح



كيف تم التعامل مع السجلات القديمة؟

\- إذا كان `assigned\_hr\_user\_id = NULL` فهي ليست assigned

\- grant من نوع `ASSIGNED` فقط سيرفض

\- `GLOBAL` و`BRANCH` لم يتغيرا



هل بقي أي path يستخدم `owner\_user\_id` أو `created\_by` في authorization؟

\- لا، ليس داخل authorization checks في `referral\_sheets`

\- ما زال `owner\_user\_id` و`created\_by` موجودين كبيانات business/audit فقط



ما الذي لم يتم لمسه عمداً؟

\- لم أعدّل schema

\- لم ألمس وحدات أخرى

\- لم أضف fallback على `owner\_user\_id`

\- لم أستخدم `created\_by`

\- لم أغيّر `GLOBAL` أو `BRANCH` behavior

