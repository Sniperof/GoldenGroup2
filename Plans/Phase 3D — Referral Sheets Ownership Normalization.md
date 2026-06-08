\*\*تحليل قبل التنفيذ\*\*

الحقل الحالي `referral\_sheets.owner\_user\_id` غير صالح كـ security owner field لسبب ظاهر في الكود نفسه، لا نظرياً فقط:

\- في \[migrations/001\_core\_tables.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/001\_core\_tables.sql:65) الحقل موجود كـ `INTEGER NOT NULL` بدون FK إلى `hr\_users`

\- في \[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:131) و\[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:205) يتم حفظه مباشرة من `req.body.ownerUserId` بلا تحقق من نوع الكيان

\- وفي الواجهة توجد قيم hardcoded مثل \[packages/web/src/components/candidates/CreateReferralSessionModal.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/candidates/CreateReferralSessionModal.tsx:179) و\[packages/web/src/components/candidates/AddCandidateModal.tsx](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/web/src/components/candidates/AddCandidateModal.tsx:325) ترسل `ownerUserId: 1`

\- كذلك `created\_by` موجود كحقل audit منفصل، فلا يمكن اعتباره fallback ownership



لذلك اخترت اسم الحقل الجديد `assigned\_hr\_user\_id` لأنه أوضح دلالة أمنياً: هذا الحقل يمثل مستخدم HR الداخلي المسؤول، ويرتبط دائماً بـ `hr\_users.id`. ولم أجد backfill آمناً 100%، لذلك أبقيته `NULL` افتراضياً بدل أي mapping تخميني.



الملفات التي عدلتها:

\- \[migrations/023\_referral\_sheets\_ownership\_normalization.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/023\_referral\_sheets\_ownership\_normalization.sql:1)

\- \[packages/api/policies/referralSheetPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/referralSheetPolicy.ts:1)

\- \[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:1)

\- \[packages/shared/types.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/shared/types.ts:33)



\*\*التنفيذ\*\*

أضفت migration جديدة تُدخل:

\- `referral\_sheets.assigned\_hr\_user\_id`

\- نوعه `INTEGER`

\- nullable

\- FK إلى `hr\_users(id)`

\- مع index عليه



ولم أنفذ backfill تلقائياً، ووضعت ذلك صراحةً داخل migration لأن:

\- `owner\_user\_id` لا يملك FK

\- يُكتب من client مباشرة

\- والرقم نفسه قد يتداخل بين جداول متعددة

\- لذلك أي backfill تلقائي سيكون غير موثوق



ثم جهزت contract للمستقبل فقط:

\- أضفت `assignedHrUserId?: number | null` إلى `ReferralSheet` في shared types

\- وأضفته إلى `ReferralSheetPolicySubject` ليكون الـ policy contract جاهزاً لاحقاً

\- وأضفته إلى `selectFields` في route حتى يظهر في payloads عند الحاجة

\- لكني لم أستخدمه في `authorize()` ولم أمرره كـ `assignedUserId`



تحققت من البناء:

\- `packages/api`: `tsc --noEmit`

\- `packages/web`: `tsc -p tsconfig.typecheck.json --noEmit`



\*\*تقرير بعد التنفيذ\*\*

الملفات المعدلة:

\- \[migrations/023\_referral\_sheets\_ownership\_normalization.sql](D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/023\_referral\_sheets\_ownership\_normalization.sql:1)

\- \[packages/api/policies/referralSheetPolicy.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/policies/referralSheetPolicy.ts:1)

\- \[packages/api/routes/referralSheets.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/api/routes/referralSheets.ts:1)

\- \[packages/shared/types.ts](D:/OneDrive/سطح المكتب/golden-crm-clean/packages/shared/types.ts:33)



اسم الحقل الجديد النهائي:

\- `assigned\_hr\_user\_id`



هل تم backfill له؟

\- لا، عمداً



ما الحالات التي بقيت `NULL`؟

\- جميع الصفوف الحالية، لأنني لم أجد mapping آمناً 100% من `owner\_user\_id` إلى `hr\_users.id`



هل أصبحت `referral\_sheets` جاهزة لاحقاً لـ `ASSIGNED`؟

\- نعم، من ناحية schema وcontract أصبحت الوحدة مهيأة بوضوح

\- صار لدينا حقل ownership أمني صريح ومفصول عن الحقل القديم المختلط



ما الذي لم يتم لمسه عمداً؟

\- لم أفعّل `ASSIGNED`

\- لم أستخدم `created\_by`

\- لم أستخدم `owner\_user\_id` كمرجع أمني

\- لم أغيّر `authorize()`

\- لم أعدّل وحدات أخرى

\- لم أضف أي fallback ownership مبني على heuristics

