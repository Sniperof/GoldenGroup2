# دستور الفيتشر — طلبات التوظيف

> الحالة: معتمد كفيتشر دستوري للدومين
> المصدر: `docs/constitution/domains/jobs-recruitment.md`، `packages/api/routes/adminApplications.ts`، `packages/api/domain/stageEngine.ts`، `packages/web/src/pages/jobs/ApplicationDetail.tsx`، `packages/web/src/pages/jobs/Applications.tsx`

## 1) الملخص التنفيذي
طلبات التوظيف هي قلب دومين التوظيف. هذا الفيتشر يحتفظ بسجل المرشح، وسجل الطلب، والوسيط عند وجوده، ومسار التأهيل والمراجعة، ومسار التصعيد، ومسار الانسحاب، وسجل التدقيق الذي يثبت كل تغيير مهم.

## 2) العقد التشغيلي
### 2.1 حدود الفيتشر
- يشمل بيانات المرشح، إدخال الطلب، بيانات الترشيح، المراجعة، نقل المراحل، تسجيل القرار، التصعيد، الأرشفة، وسجل التدقيق.
- المقابلات والتدريب فيتشرات منفصلة، لكنهما يعتمدان على الطلب.
- الإدخال العام والإدخال الإداري ينتهيان إلى نفس نموذج الطلب.

### 2.2 المسار التشغيلي
1. إنشاء المرشح أو استيراده.
2. ربطه بشاغر.
3. إضافة وسيط إذا كان المسار يحتاج ذلك.
4. استلام الطلب.
5. مراجعة المرشح مقابل الشاغر.
6. نقل المؤهلين إلى القائمة المختصرة.
7. متابعة المسار إلى مقابلة أو تدريب أو قرار نهائي.
8. حفظ القرارات والتاريخ الكامل.

### 2.3 قواعد العمل الأساسية
- كل طلب مرتبط بشاغر واحد فقط.
- التقديم العام مسموح فقط على شاغر `Open` وضمن نافذته الزمنية.
- يمكن إنشاء الطلب من المسار العام أو من المسار الإداري.
- الطلب هو السجل الذي يتحرك بين المراحل.
- القرار النهائي يقيّد الانتقالات اللاحقة.
- `Public Job` ليس الطلب نفسه، بل مجرد واجهة للشاغر.
- `Manual Entry` هو مسار إنشاء وليس كيانًا مستقلًا.

### 2.4 عقد المرشح
المرشح هو سجل الشخص، وليس الطلب نفسه.

الحقول الظاهرة في الكود:
- `firstName` — إلزامي
- `lastName` — إلزامي
- `mobileNumber` — إلزامي
- `gender` — إلزامي
- `dob` — إلزامي
- `maritalStatus` — إلزامي
- `governorate` — إلزامي تشغيليًا
- `cityOrArea` — اختياري تشغيليًا
- `subArea` — اختياري تشغيليًا
- `neighborhood` — اختياري تشغيليًا
- `detailedAddress` — إلزامي
- `academicQualification` — إلزامي
- `specialization` — اختياري
- `previousEmployment` — إلزامي
- `drivingLicense` — إلزامي
- `hasCar` — إلزامي
- `expectedSalary` — إلزامي
- `computerSkills` — إلزامي
- `foreignLanguages` — إلزامي
- `yearsOfExperience` — إلزامي
- `secondaryMobile` — اختياري
- `email` — اختياري
- `cvUrl` / `photoUrl` — مرفقات، مع كون الصورة الشخصية مطلوبة في النموذج العام
- `applicantSegment` — اختياري
- `hasWhatsappPrimary` / `hasWhatsappSecondary` — اختياري
- في عنوان السكن داخل نموذجَي الإدخال اليدوي والتقديم العام، المحافظة والعنوان التفصيلي فقط إلزاميان؛ المنطقة والناحية والحي اختيارية.

### 2.5 عقد الوسيط
الوسيط كيان اختياري يظهر فقط عند وجود ترشيح.

القواعد:
- يظهر فقط في مسار `Refer a Candidate`.
- ليس جزءًا من المرشح نفسه.
- الأنواع المعتمدة: `Personal`، `Unknown`، `Employee`، `Client`.
- `sourceChannel` / طريقة التواصل جزء أساسي من عقد الوسيط.
- `referrerName` هو الاسم المُلخّص (snapshot) الخاص بالوسيط.
- `referralEntityId` يُحفظ فقط عندما يكون الوسيط مرتبطًا بكيان فعلي (`Employee` أو `Client`).

الحقول الظاهرة عند وجوده:
- `type` — إلزامي
- `sourceChannel` — إلزامي
- `referrerName` — إلزامي؛ يتعبأ تلقائيًا في `Personal` و`Unknown` ونتيجة lookup في `Employee` و`Client`
- `employeeId` — إلزامي إذا كان النوع `Employee`
- `referralEntityId` — إلزامي تشغيليًا في `Employee` و`Client`
- `referrerNotes` — ثابت وغني بالنصوص (Rich Text)

الحقول التراثية التالية ليست جزءًا من عقد الوسيط المرجعي ولا يجب اعتبارها إلزامية في نماذج التوظيف:
- `lastName`
- `mobileNumber` — اختياري ولا يمنع الحفظ
- `governorate` / `cityOrArea` / `subArea` / `neighborhood`
- `detailedAddress`
- `referrerWork`

### 2.6 نافذة التأهيل
- نافذة المراجعة تفتح عندما يدخل الطلب مرحلة `Submitted` ويبدأ التدقيق.
- السكور مجرد إشارة مساعدة، وليس قرارًا نهائيًا.
- إذا تأهل الطلب ينتقل إلى `Shortlisted` / `Qualified`.
- إذا رُفض يجب حفظ سبب الرفض في السجل.

### 2.7 عقد السكور
السكور في الواجهة يحسب عبر `calculateJobMatchScore` في `packages/web/src/lib/jobMatch.ts`.

الأوزان الظاهرة في الكود:
- الشهادة: `20`
- التخصص: `25`
- الخبرة: `30`
- الموقع: `10`
- الجنس: `5`
- العمر: `5`
- الرخصة: `5`

ملاحظات مهمة:
- السكور إرشادي فقط.
- الحقول غير الموجودة في الشاغر لا تدخل في الحساب.
- ألوان البطاقة في الواجهة مجرد hints بصرية.

### 2.8 مسارات الحالة والقرار
المراحل الكبرى:
- `Submitted`
- `Shortlisted`
- `Interview`
- `Training`
- `Final Decision`

حالات التوافق القديمة الظاهرة بالكود:
- `New`
- `In Review`
- `Qualified`
- `Rejected`
- `Interview Scheduled`
- `Interview Completed`
- `Interview Failed`
- `Approved`
- `Retraining`
- `Training Scheduled`
- `Training Started`
- `Training Completed`
- `Passed`
- `Final Hired`
- `Final Rejected`
- `Retreated`

القرارات النهائية:
- `Rejected`
- `Failed`
- `Hired`
- `Retreated`

### 2.9 مسار التصعيد
التصعيد هو مسار تشغيلي منفصل داخل الطلب، وليس مجرد علامة عرض.

القواعد الحالية:
- المسار متاح عبر `PATCH /api/admin/applications/:id/escalate`.
- الصلاحية المطلوبة هي `jobs.applications.escalate`.
- إذا لم يكن الطلب مصعّدًا سابقًا، يضع النظام `isEscalated = true` و`escalatedAt = NOW()`.
- عند التصعيد، يتجمّد الطلب تشغيليًا في كثير من الشاشات والمسارات.
- فكّ التصعيد يتم عبر `PATCH /api/admin/applications/:id/resolve-escalation`.
- الصلاحية المطلوبة لفكّ التصعيد هي `jobs.applications.resolve_escalation`.
- كل من التصعيد وفكّه يُسجل في `audit_logs`.

ما يترتب على التصعيد:
- يتوقف التعامل الحر مع الطلب إلى أن يُفكّ التصعيد.
- يبقى الطلب نفسه موجودًا، لكن حركة التعديل تصبح مقيدة.
- يجب أن يظل واضحًا في الواجهة أنه طلب مصعّد.

### 2.10 مسار الانسحاب
الانسحاب (`Retreated`) هو قرار نهائي خاص، ويعمل كمخرج صالح في أكثر من مرحلة.

حسب محرك المراحل، يمكن اتخاذ `Retreated` في:
- `Submitted / Under Review`
- `Shortlisted / Ready`
- `Interview / Completed`
- `Training / Ready`
- `Training / Scheduled`
- `Training / In Progress`
- `Training / Completed`
- `Final Decision / Awaiting Decision`

ما يترتب على الانسحاب:
- القرار يصبح نهائيًا.
- لا يجوز فرض قرار جديد فوقه.
- في التوافق الخلفي، يعود `applicationStatus` إلى `Retreated`.
- في قواعد الانتقال، يجب أن تبقى المرحلة كما هي عند وضع حالة الانسحاب.
- هذا المسار يُستخدم عندما ينسحب المرشح أو يُغلق المسار بطلب منه أو بقرار تشغيلي مماثل.

### 2.11 الأرشفة
- الأرشفة مسموحة فقط للحالات النهائية التالية: `Final Hired` أو `Final Rejected` أو `Retreated`.
- الطلب المؤرشف لا يقبل الأرشفة مرة ثانية.
- الأرشفة نفسها تُسجل في سجل التدقيق.

### 2.12 التحقق
- التأكد أن صفحة التفاصيل تعرض المرحلة الحالية، القرار، وسجل التدقيق الحقيقي.
- التأكد أن مسار التأهيل يعتمد على سكوره الحقيقي.
- التأكد أن الإدخال اليدوي والتقديم العام ينشئان نفس كيان الطلب.
- التأكد أن المحافظة والعنوان التفصيلي هما فقط حقلا العنوان الإلزاميان، وأن المنطقة والناحية والحي يمكن تركها فارغة.
- التأكد أن كل انتقال مهم يترك أثرًا في سجل التدقيق.
- التأكد أن التصعيد، وفك التصعيد، والانسحاب، والأرشفة تظهر كسيناريوهات مستقلة لا كرسائل عامة.
- أثناء `Training Started` لا تظهر أزرار اتخاذ القرار أو إعادة التدريب؛ هذه الخيارات تبقى محصورة بعد `Training Completed`.
- التأكد أن تاب التدريب في تفاصيل الطلب يبقى للعرض والتنقل فقط، بدون إنشاء دورة جديدة.

### 2.13 مسار تحويل مقدم الطلب إلى سجل الموظفين
- من صفحة تفاصيل الطلب يمكن فتح نموذج إضافة الموظف مباشرة من الطلب نفسه.
- بيانات المرشح النصية الخاصة بالموقع الجغرافي تُمرَّر إلى نموذج الموظف لتكون قيمة ابتدائية.
- إذا توفرت معرفات جغرافية جاهزة، فهي تبقى المرجع الأقوى؛ وإذا لم تتوفر، يحاول النظام مطابقة النصوص مع وحدات الجغرافيا المتاحة.
- الحقول المنقولة حاليًا تشمل: `governorate` و`cityOrArea` و`subArea` و`neighborhood` و`detailedAddress`.
- هذا المسار لا ينشئ طلبًا جديدًا ولا يغيّر دورة حياة الطلب؛ هو فقط جسر إداري بين الطلب وسجل الموظف.

## 3) العقد التقني
### 3.1 الكيانات والحقول
حقول المرشح:
- `firstName`
- `lastName`
- `mobileNumber`
- `gender`
- `dob`
- `maritalStatus`
- `governorate`
- `cityOrArea`
- `subArea`
- `neighborhood`
- `detailedAddress`
- `academicQualification`
- `specialization`
- `previousEmployment`
- `drivingLicense`
- `hasCar`
- `expectedSalary`
- `computerSkills`
- `foreignLanguages`
- `yearsOfExperience`
- `secondaryMobile`
- `email`
- `cvUrl`
- `photoUrl`
- `applicantSegment`
- `hasWhatsappPrimary`
- `hasWhatsappSecondary`

حقول الوسيط:
- `type`
- `sourceChannel`
- `employeeId`
- `referrerName`
- `referralEntityId`
- `referrerNotes`
- `Personal` = اسم المستخدم الحالي / الشخصي
- `Unknown` = مجهول
- `Employee` = lookup بالرقم الوظيفي
- `Client` = lookup بالزبون

حقول الطلب:
- `id`
- `jobVacancyId`
- `applicantId`
- `referrerId`
- `submissionType`
- `applicationSource`
- `enteredByUserId`
- `enteredByName`
- `currentStage`
- `applicationStatus`
- `stageStatus`
- `decision`
- `duplicateFlag`
- `hiredEmployeeId`
- `isEscalated`
- `escalatedAt`
- `isArchived`
- `archivedAt`

### 3.2 عقد الواجهة
- `packages/web/src/pages/jobs/Applications.tsx`
- `packages/web/src/pages/jobs/ApplicationDetail.tsx`
- `packages/web/src/pages/jobs/ManualApplicationEntry.tsx`
- `packages/web/src/components/employees/EmployeeFormModal.tsx` عند فتحه من تفاصيل الطلب

الواجهة يجب أن تعرض:
- السكور
- المرحلة الحالية
- القرار الحالي
- سجل التدقيق
- حالة التصعيد
- حالة الانسحاب
- حالة الأرشفة
- ومسار نقل بيانات مقدم الطلب إلى سجل الموظفين عند الحاجة

### 3.2.1 عقد نقل الموقع الجغرافي
- صفحة تفاصيل الطلب تبني `EmployeeFormInitialValues` من بيانات المرشح داخل الطلب.
- الحقول النصية الجغرافية القادمة من الطلب تُستخدم لتهيئة نموذج الموظف عندما لا تكون هناك `geoSelection` جاهزة.
- نموذج الموظف يحاول أولًا استخدام `geoSelection` أو معرفات الإقامة إن وُجدت، ثم يكمل بمطابقة النصوص مع وحدات الجغرافيا.
- الهدف من هذا السلوك أن لا يضيع العنوان عند تحويل المرشح إلى سجل موظف.

### 3.3 عقد الـ API
- `GET /api/admin/applications`
- `POST /api/admin/applications`
- `GET /api/admin/applications/:id`
- `PATCH /api/admin/applications/:id/...` بحسب المسار
- `PATCH /api/admin/applications/:id/escalate`
- `PATCH /api/admin/applications/:id/resolve-escalation`
- `PATCH /api/admin/applications/:id/archive`
- `GET /api/admin/applications/:id/audit-logs`
- `POST /api/public/applications`

### 3.4 التوافق الخلفي
- قيم `applicationStatus` القديمة تبقى جزءًا من التوافق.
- محرك المراحل هو المرجع الحقيقي للانتقالات.
- يجب ألا تتفوق تسميات الواجهة القديمة على العقد الحالي.
