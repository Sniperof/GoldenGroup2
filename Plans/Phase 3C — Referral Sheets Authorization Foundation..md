\*\*تحليل قبل التنفيذ\*\*

عدّلت ثلاث نقاط فقط داخل نطاق `referral\_sheets`: \[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:1)، و\[packages/api/policies/referralSheetPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/referralSheetPolicy.ts:1)، و\[migrations/022\_referral\_sheets\_authorization\_foundation.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/022\_referral\_sheets\_authorization\_foundation.sql:1).



اعتمدت حلاً واحداً واضحاً للـ branch model:

\- `referral\_sheets.branch\_id` هو المصدر الرسمي للوحدة

\- أضفت migration لإدخال العمود

\- مع backfill محافظ من `owner\_user\_id` عبر:

&#x20; - `user\_branch\_assignments` أولاً

&#x20; - ثم fallback legacy إلى `hr\_users.branch\_id`

\- ووسمت ذلك بوضوح داخل migration بتعليق `PHASE3C\_LEGACY\_FALLBACK`



ما أُجّلته عمداً:

\- تفعيل `ASSIGNED`

\- استخدام `owner\_user\_id` في القرار الأمني

\- أي استخدام لـ `created\_by`

\- أي refactor لوحدات أخرى

\- أي إضافة policy engine أوسع



\*\*التنفيذ\*\*

أدخلت `referral\_sheets` في authorization pipeline الرسمي:

\- `requireAuth`

\- `requirePermission(...)`

\- policy helper

\- `authorize()`



وأضفت permissions جديدة للوحدة:

\- `referral\_sheets.view\_list`

\- `referral\_sheets.create`

\- `referral\_sheets.edit`

\- `referral\_sheets.delete`



كما أضفت grants لها في `role\_permission\_grants` بنطاق `BRANCH` بشكل محافظ.



أنشأت policy helper مخصصاً:

\- `canListReferralSheets`

\- `canViewReferralSheet`

\- `canCreateReferralSheet`

\- `canEditReferralSheet`

\- `canDeleteReferralSheet`



وفي هذه المرحلة كل هذه helpers تمرر إلى `authorize()`:

\- `permission`

\- `branchId`

فقط، ولا تمرر `assignedUserId`



وفي runtime:

\- `GET /referral-sheets` صار branch-aware

\- `POST /referral-sheets` يتطلب branch target واضحاً

\- `PUT /referral-sheets/:id` يحل record أولاً ثم يطبق policy على `branch\_id`



لم أستخدم `created\_by` في authorization إطلاقاً. بقي حقل audit فقط.



تحققت من البناء:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:1)

\- \[packages/api/policies/referralSheetPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/referralSheetPolicy.ts:1)

\- \[migrations/022\_referral\_sheets\_authorization\_foundation.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/022\_referral\_sheets\_authorization\_foundation.sql:1)



هل أصبحت `referral\_sheets` تمر عبر authorization pipeline؟

\- نعم، لم تعد خارج pipeline

\- المسارات الحالية الموجودة في الوحدة أصبحت تمر عبر `requireAuth` و`requirePermission`



ما هو branch source الرسمي الآن؟

\- `referral\_sheets.branch\_id`



هل أصبحت تدعم `GLOBAL + BRANCH`؟

\- نعم من ناحية model والـ policy/runtime integration

\- grants التي أضفتها للوحدة نفسها مضبوطة الآن على `BRANCH` بشكل محافظ

\- وإذا وُجد لاحقاً grant من نوع `GLOBAL` فالوحدة ستدعمه تلقائياً عبر `authorize()`



ما الذي بقي مؤجلاً لمرحلة `ASSIGNED`؟

\- استخدام `owner\_user\_id` في القرار الأمني

\- تمرير `assignedUserId`

\- أي ownership-based access على referral sheets



ملاحظة مهمة:

\- لم أضف endpoints جديدة مثل `GET /:id` أو `DELETE /:id` لأن ذلك كان سيوسع النطاق. جهّزت policy helper لها فقط حتى تكون المرحلة التالية مباشرة وأسهل.

