نريد تنفيذ \*\*Phase 3A — Candidate Authorization Enablement\*\*.



⚠️ هذه المرحلة لا تفعّل `ASSIGNED` بعد.

⚠️ هذه المرحلة لا تعيد كتابة النظام كله.

⚠️ نريد فقط إدخال وحدة `candidates` إلى authorization model الرسمي بشكل صحيح.



\---



\# الهدف



تحويل وحدة `candidates` من وضعها الحالي الذي يعتمد على `requireAuth` فقط إلى وحدة تمر عبر authorization pipeline الرسمية:



\* `requireAuth`

\* `requirePermission`

\* `authorize()`

\* policy helpers



لكن في هذه المرحلة:



\* ندعم فقط `GLOBAL` و `BRANCH`

\* لا نفعّل `ASSIGNED` بعد

\* نجهز الأرضية له في المرحلة التالية



\---



\# الخلفية



نعرف من مراجعة التصميم أن:



\* `candidates` تحتوي:



&#x20; \* `owner\_user\_id`

&#x20; \* `created\_by`

&#x20; \* `branch\_id`

\* `owner\_user\_id` هو النمط الصحيح مستقبلاً لـ `ASSIGNED`

\* `created\_by` هو audit فقط، وليس ownership

\* الوحدة حالياً لا تمر عبر permission enforcement حقيقي



\## القرار المعماري الملزم



في هذه المرحلة:



\* `created\_by` لا يُستخدم في authorization

\* `owner\_user\_id` لا يُستخدم بعد لتفعيل ASSIGNED

\* authorization الحالية لـ candidates يجب أن تعتمد فقط على:



&#x20; \* permission

&#x20; \* branch scope

&#x20; \* authorize()

\* مع إنشاء policy helpers قابلة لتفعيل ASSIGNED لاحقاً



\---



\# المطلوب تنفيذه



\## 1) إدخال permission enforcement إلى candidates module



راجع `packages/api/routes/candidates.\*` أو الملف المقابل، وأدخل:



\* `requireAuth`

\* `requirePermission(...)`



بحيث لا تبقى الوحدة على `requireAuth` فقط



\### مهم



اختر permission names منطقية ومتسقة مع القاموس الحالي، مثل:



\* `candidates.view\_list`

\* `candidates.create`

\* `candidates.edit`

\* `candidates.delete`



إذا كانت هناك أسماء موجودة مسبقاً في permissions catalog فالتزم بها، ولا تخترع قاموساً موازياً.



\---



\## 2) بناء policy helper مخصص لـ candidates



أنشئ policy helper واضحاً، مثل:



\* `canViewCandidate(ctx, candidate)`

\* `canEditCandidate(ctx, candidate)`

\* `canDeleteCandidate(ctx, candidate)`

\* أو helper موحد مناسب إذا كان أنظف



\### القاعدة



في هذه المرحلة helper يجب أن يمرر إلى `authorize()`:



\* permission

\* `branchId`

\* ولا يمرر `assignedUserId` بعد



\### مهم



لا نريد raw `authorize()` calls متناثرة داخل routes إذا أمكن.

نريد policy layer خفيفة لكنها واضحة.



\---



\## 3) تفعيل `GLOBAL` و `BRANCH` على candidates فقط



\### List endpoint



\* يجب أن يحترم branch context

\* إذا كان المستخدم ليس super admin ولا يوجد branch context مناسب، يجب أن يكون الفشل واضحاً



\### Get by id / update / delete



\* يجب أن تُحل candidate أولاً

\* ثم يُمرر `candidate.branch\_id` إلى policy helper

\* ويُمنع الوصول خارج الفرع عندما يكون scope = `BRANCH`



\### Create



\* يجب أن يكون branch target واضحاً

\* لا تسمح بإنشاء candidate بدون branch context مناسب إذا كانت العملية branch-scoped



\---



\## 4) لا تفعّل `ASSIGNED` بعد



\### مهم جداً



\* لا تستخدم `owner\_user\_id` بعد لتفعيل access

\* لا تمرر `assignedUserId`

\* لا تستخدم `created\_by`

\* لا تغيّر `authorizeAssignedGrant` في هذه المرحلة



لكن:



\* حافظ على helper design بحيث يصبح توسيعه لـ ASSIGNED سهلاً لاحقاً



مثال جيد:



\* helper يستقبل candidate object فيه:



&#x20; \* `branchId`

&#x20; \* `ownerUserId`

&#x20;   لكن في هذه المرحلة يستخدم `branchId` فقط



\---



\## 5) لا تستخدم `created\_by` في authorization



هذا قرار ملزم.



\* `created\_by` audit field فقط

\* ليس ownership

\* لا تعتمد عليه في أي check



\---



\## 6) حافظ على النطاق محدوداً



لا نريد:



\* refactor لوحدات أخرى

\* تغييرات schema

\* تغييرات JWT

\* تفعيل assigned

\* policy engine

\* تعديل UI الآن



\---



\# المطلوب في الرد



\## أولاً: تحليل قبل التنفيذ



اشرح:



\* ما الملف/الملفات التي ستعدلها

\* ما permissions التي ستستخدمها

\* كيف ستبني policy helper

\* ما الذي ستؤجله عمداً إلى Phase 3B



\## ثانياً: التنفيذ



نفذ التغييرات



\## ثالثاً: تقرير بعد التنفيذ



أعطني:



\* الملفات المعدلة

\* ما endpoints في candidates أصبحت تمر عبر authorization

\* كيف بنيت policy helper

\* هل تم تجاهل `created\_by` بالكامل في authorization

\* هل بقي أي path داخل candidates خارج enforcement

\* ما الذي بقي مؤجلاً لمرحلة ASSIGNED



\---



\# معايير القبول



لن يعتبر العمل مقبولاً إلا إذا:



1\. لم تعد candidates تعمل بـ `requireAuth` فقط

2\. أصبحت candidates تمر عبر `requirePermission`

3\. يوجد policy helper واضح لـ candidates

4\. يتم تفعيل `GLOBAL` و `BRANCH` فقط

5\. لم يتم استخدام `created\_by` في authorization

6\. لم يتم تفعيل `ASSIGNED` قبل أوانه

7\. بقي التنفيذ محدوداً على candidates فقط



\---



\# ملاحظة ختامية



هذه المرحلة هدفها:



\* جعل candidates أول وحدة fully integrated مع authorization pipeline

\* لكن بدون إدخال تعقيد ASSIGNED قبل تثبيت الأساس



ابدأ بتحليل موجز ثم التنفيذ.



