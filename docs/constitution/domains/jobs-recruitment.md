# دستور الدومين — التوظيف والاستقطاب في Golden CRM

> الحالة: معتمد كمرجع دستوري للدومين
> اللغة: عربية موحّدة
> النطاق: Jobs & Recruitment
> الغرض: تثبيت الحقيقة التشغيلية الحالية لدومين التوظيف كما تظهر في الكود والواجهة والأنواع المشتركة، مع توضيح الفجوات والتباينات بدل إخفائها.

---

## 0) الملخص التنفيذي

دومين التوظيف والاستقطاب في Golden CRM هو النظام الذي يدير رحلة الشاغر الوظيفي من لحظة تعريفه حتى القرار النهائي على الطلب المرتبط به. يبدأ الدومين من **الشاغر**، ثم ينتقل إلى **الوظائف العامة**، ثم **طلب التوظيف**، ثم **المراجعة والتأهيل**، ثم **المقابلة**، ثم **التدريب**، ثم **القرار النهائي**.

هذا الدومين لا يملك فقط صفحات عرض، بل يملك عقدًا تشغيليًا واضحًا يحدد:
- ما هو الكيان الأصلي، وما هو العرض فقط.
- ما هي الحالات الرسمية، وما هي حالات التوافق القديمة.
- من يحق له تنفيذ كل عملية.
- متى يُسمح بالتصعيد أو الانسحاب أو الأرشفة.
- كيف تتفرع نتائج التدريب إلى مسارات مستقلة.
- كيف تُسجّل العمليات المؤثرة في سجل التدقيق.

الحقيقة التشغيلية في هذا الدومين موزعة بين:
- الخلفية: المسارات / الخدمات / المستودعات / محرك الحالات / التدقيق / الصلاحيات.
- الواجهة: الصفحات، المودالات، الفلاتر، الأزرار، وخرائط النصوص.
- الأنواع المشتركة: `packages/shared/types.ts` وخرائط الحالات والسكور.

---

## 1) الفلو البشري المبسّط

`Vacancy → Public Job → Application → Review → Shortlist → Interview → Training → Final Decision`

### شرح كل خطوة
- **Vacancy / الشاغر**: تعريف الوظيفة المفتوحة، متطلباتها، فرعها، ومدتها.
- **Public Job / الوظيفة العامة**: العرض العام للشاغر المفتوح للعامة فقط.
- **Application / طلب التوظيف**: السجل المركزي للمرشح والطلب المرتبط بالشاغر.
- **Review / المراجعة**: تقييم أولي يقرأ توافق المرشح مع الشاغر.
- **Shortlist / القائمة المختصرة**: تأهيل الطلب أو رفضه، وبداية المراحل اللاحقة.
- **Interview / المقابلة**: جدولة المقابلة وتسجيل نتيجتها ضمن سجلات مستقلة.
- **Training / التدريب**: إنشاء دورة تدريبية، ربط المتدربين، الحضور، ثم تسجيل النتائج.
- **Final Decision / القرار النهائي**: قرار التوظيف النهائي أو الرفض أو الانسحاب أو المسار النهائي المقفل.

---

## 2) حدود الدومين

### 2.1 داخل النطاق
يشمل هذا الدومين كل ما يلي:
- تعريف الشواغر وإدارتها.
- العرض العام للشواغر المفتوحة.
- إدخال الطلبات العامة والإدارية.
- المراجعة والتأهيل والرفض.
- التصعيد وفك التصعيد.
- الانسحاب والأرشفة.
- المقابلات وأهلية المقابلين.
- التدريب وربط المتدربين والحضور والنتائج.
- سجل التدقيق الخاص بالطلبات والانتقالات المؤثرة.

### 2.2 خارج النطاق
لا يملك هذا الدومين:
- بنية الصلاحيات العامة في المشروع كله.
- تعريف الفروع أو الأقسام أو الجغرافيا.
- قواعد العملاء أو التليماركتينغ أو الزيارات أو العقود.
- تعريف الموظفين كدومين مستقل خارج أثر التوظيف.

### 2.3 ممنوع الخلط بين الكيانات
- الشاغر ليس الطلب.
- الطلب ليس المرشح.
- المرشح ليس الطلب.
- المقابلة ليست القرار النهائي.
- التدريب ليس المقابلة.
- الحضور ليس النتيجة.
- الوظيفة العامة ليست كيانًا مستقلًا.
- الإدخال اليدوي ليس كيانًا مستقلًا.

---

## 3) خريطة المصدر

### 3.1 ملفات الخلفية الأساسية
- `packages/api/routes/vacancies.ts`
- `packages/api/routes/publicVacancies.ts`
- `packages/api/routes/publicApplications.ts`
- `packages/api/routes/adminApplications.ts`
- `packages/api/routes/interviews.ts`
- `packages/api/routes/trainingCourses.ts`
- `packages/api/routes/trainingAttendance.ts` ← موجود لكنه غير موصول حاليًا
- `packages/api/services/applicationService.ts`
- `packages/api/services/interviewService.ts`
- `packages/api/services/trainingCourseService.ts`
- `packages/api/repositories/applicationRepository.ts`
- `packages/api/repositories/interviewRepository.ts`
- `packages/api/repositories/trainingCourseRepository.ts`
- `packages/api/domain/stageEngine.ts`
- `packages/api/utils/applicationHelpers.ts`
- `packages/api/utils/recruitmentPolicy.ts`
- `packages/api/utils/auditLog.ts`
- `packages/api/middleware/permission.ts`

### 3.2 ملفات الواجهة الأساسية
- `packages/web/src/pages/jobs/Vacancies.tsx`
- `packages/web/src/pages/jobs/VacancyDetail.tsx`
- `packages/web/src/pages/jobs/Applications.tsx`
- `packages/web/src/pages/jobs/ApplicationDetail.tsx`
- `packages/web/src/pages/jobs/ManualApplicationEntry.tsx`
- `packages/web/src/pages/jobs/Interviews.tsx`
- `packages/web/src/pages/jobs/InterviewDetail.tsx`
- `packages/web/src/pages/jobs/TrainingCourses.tsx`
- `packages/web/src/pages/jobs/TrainingCourseDetail.tsx`
- `packages/web/src/pages/jobs/PublicJobs.tsx`

### 3.3 الملفات المشتركة المؤثرة
- `packages/shared/types.ts`
- `packages/shared/index.ts`
- `packages/web/src/lib/types.ts`
- `packages/web/src/lib/applicationState.ts`
- `packages/web/src/lib/jobMatch.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/lib/authFetch.ts`

### 3.4 الملفات الدستورية المرتبطة
- `docs/constitution/features/vacancies.md`
- `docs/constitution/features/public-jobs.md`
- `docs/constitution/features/applications.md`
- `docs/constitution/features/manual-application-entry.md`
- `docs/constitution/features/interviews.md`
- `docs/constitution/features/training-courses.md`
- `docs/constitution/features/README.md`
- `docs/constitution/domains/README.md`

---

## 4) المفاهيم الأساسية

### 4.1 `Vacancy`
الشاغر هو سجل الوظيفة المفتوحة.
- هو الأصل التشغيلي الأول في الدومين.
- يملك حالة، نافذة تاريخ، عدد شواغر متبقٍ (`vacancyCount`)، وفرعًا وقسمًا ومتطلبات.
- عند عرض التفاصيل الإدارية، يُعاد أيضًا `remainingSlots` كمرآة مباشرة للقيمة الحالية من الشاغر.
- يملك مسار تعديل متدرج بحسب وجود الطلبات ومرحلتها.

### 4.2 `Public Job`
الوظيفة العامة هي عرض عام للشاغر المفتوح.
- ليست كيانًا مستقلًا.
- تعتمد على نفس سجل الشاغر.
- لا تضيف حالة جديدة ولا نموذج تخزين مستقل.

### 4.3 `Applicant`
المرشح هو الشخص المتقدم.
- يمثل بيانات الشخص نفسه.
- ليس الطلب.
- قد يُنشأ من المسار العام أو الإداري.

### 4.4 `Referrer`
الوسيط أو المُعرّف.
- يظهر فقط في مسار `Refer a Candidate`.
- الأنواع المعتمدة: `Personal`، `Unknown`، `Employee`، `Client`.
- يحمل `sourceChannel` واسمًا snapshot للوسيط.
- إذا كان `Employee` أو `Client` فيجب أن يملك `referralEntityId` مرتبطًا بكيان فعلي.
- ليس جزءًا من المرشح نفسه.

### 4.5 `Job Application`
طلب التوظيف هو الكيان المركزي.
- يربط المرشح بالشاغر.
- يحمل المرحلة والحالة والقرار.
- يملك سجل تدقيق.
- يملك مسارات مستقلة للتصعيد والانسحاب والأرشفة.

### 4.6 `Interview`
المقابلة هي سجل تشغيلي مرتبط بالطلب.
- ليست كيان مرشح مستقل.
- لها حالة خاصة.
- لها نتيجة تُسجل عبر المسار المخصص لها.

### 4.7 `Interviewer`
المقابل هو المستخدم المؤهل لإجراء المقابلات.
- يجب أن يكون فعالًا.
- مرتبطًا بفرع فعال.
- يملك الصلاحية المناسبة.
- يندرج ضمن نطاق `BRANCH` أو `GLOBAL`.

### 4.8 `Training Course`
الدورة التدريبية هي السجل الذي يجمع المتدربين والحضور والنتائج.
- مرتبطة بالشاغر.
- ترتبط بالطلبات المؤهلة.
- لها دورة حياة مستقلة.

### 4.9 `Training Trainee`
سجل رابط بين الدورة والطلب.
- ليس طلبًا جديدًا.
- ليس مرشحًا جديدًا.
- هو كيان رابطه تشغيلي.

### 4.10 `Training Attendance`
سجل حضور يومي.
- مربوط بالدورة والمتدرب.
- قيمه `Present` و`Absent`.

### 4.11 `Training Result`
نتيجة المتدرب داخل الدورة.
- قيمها: `Passed`, `Retraining`, `Rejected`, `Retreated`.
- تختلف عن نتيجة المقابلة وعن الحضور.

### 4.12 `Manual Application Entry`
مسار إدخال إداري.
- هو مسار عمل.
- ليس كيان تخزين مستقل.
- ينتج نفس سجل الطلب النهائي.

---

## 5) الكيانات والحقول على مستوى الدومين

> ملاحظة: الجداول التفصيلية الكاملة للحقول موجودة في دساتير الفيتشر المنفصلة. هذا القسم يثبت الصورة العامة والحقول الجوهرية التي تربط الدومين ببعضه.

### 5.1 Vacancy
#### الحقول الجوهرية
- `id`
- `title`
- `branch`
- `branchId`
- `departmentId`
- `departmentName`
- `governorate`
- `cityOrArea`
- `subArea`
- `neighborhood`
- `detailedAddress`
- `workType`
- `requiredGender`
- `requiredAgeMin`
- `requiredAgeMax`
- `contactMethods`
- `requiredCertificate`
- `requiredMajor`
- `requiredExperienceYears`
- `requiredSkills`
- `responsibilities`
- `drivingLicenseRequired`
- `vacancyCount`
- `startDate`
- `endDate`
- `status`
- `maxRetrainingCount` ← يظهر في منطق التدريب المرتبط بالشاغر

### 5.2 Job Application
#### الحقول الجوهرية
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
- `internalNotes`

### 5.3 Interview
#### الحقول الجوهرية
- `id`
- `applicationId`
- `interviewType`
- `interviewNumber`
- `interviewerName`
- `interviewerUserId`
- `interviewDate`
- `interviewTime`
- `interviewStatus`
- `internalNotes`
- `createdAt`

### 5.4 Training Course
#### الحقول الجوهرية
- `id`
- `trainingName`
- `jobVacancyId`
- `branch`
- `deviceName`
- `trainer`
- `startDate`
- `endDate`
- `trainingStatus`
- `notes`
- `createdByUserId`
- `createdAt`
- `updatedAt`

### 5.5 Training Trainee
#### الحقول الجوهرية
- `trainingCourseId`
- `applicationId`
- `result`
- `resultRecordedAt`
- `resultRecordedBy`
- `addedAt`

### 5.6 Training Attendance
#### الحقول الجوهرية
- `trainingCourseId`
- `applicationId`
- `attendanceDate`
- `status`
- `recordedByUserId`

### 5.7 Training Result
#### القيم الجوهرية
- `Passed`
- `Retraining`
- `Rejected`
- `Retreated`

---

## 6) دورة الحياة والحالات

### 6.1 دورة الشاغر
- `Open` → متاح للاستقبال والعرض العام.
- `Closed` → إيقاف الاستقبال.
- `Archived` → نهائي، غير قابل للتعديل بعد الأرشفة.

### 6.2 دورة الطلب
#### المراحل الرسمية
- `Submitted`
- `Shortlisted`
- `Interview`
- `Training`
- `Final Decision`

#### stageStatus
- `Pending`
- `Under Review`
- `Ready`
- `Scheduled`
- `Completed`
- `In Progress`
- `Awaiting Decision`

#### applicationStatus legacy
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

#### القرارات النهائية
- `Rejected`
- `Failed`
- `Hired`
- `Retreated`

### 6.3 دورة المقابلة
- `Interview Scheduled`
- `Interview Completed`
- `Interview Failed`

### 6.4 دورة التدريب
- `Training Scheduled`
- `Training Started`
- `Training Completed`

#### نتائج المتدرب
- `Passed`
- `Retraining`
- `Rejected`
- `Retreated`

---

## 7) الصلاحيات والنطاق

### 7.1 الشواغر
- `jobs.vacancies.view_list`
- `jobs.vacancies.view_detail`
- `jobs.vacancies.create`
- `jobs.vacancies.edit`
- `jobs.vacancies.change_status`

### 7.2 الطلبات
- `jobs.applications.view_list`
- `jobs.applications.create`
- `jobs.applications.view_detail`
- `jobs.applications.change_stage`
- `jobs.applications.hire`
- `jobs.applications.record_decision`
- `jobs.applications.escalate`
- `jobs.applications.resolve_escalation`
- `jobs.applications.edit_notes`
- `jobs.applications.archive`
- `jobs.applications.view_audit_logs`

### 7.3 المقابلات
- `jobs.interviews.view_list`
- `jobs.interviews.view_detail`
- `jobs.interviews.schedule`
- `jobs.interviews.edit`
- `jobs.interviews.record_result`
- `jobs.interviews.view_eligible`
- `jobs.interviews.conduct`

### 7.4 التدريب
- `jobs.training.view_list`
- `jobs.training.view_detail`
- `jobs.training.create`
- `jobs.training.start`
- `jobs.training.record_attendance`
- `jobs.training.complete`
- `jobs.training.record_result`
- `jobs.training.add_trainees`
- `jobs.training.view_eligible`
- `jobs.training.be_trainer`

### 7.5 مبدأ النطاق
- `GLOBAL`
- `BRANCH`
- `ASSIGNED` في بعض الصلاحيات

---

## 8) القواعد التشغيلية الأساسية

### `JR-R001` — إنشاء الشاغر
- يتطلب عنوانًا، فرعًا، قسمًا، عدد شواغر أكبر من صفر، وتواريخ صالحة.
- القسم يجب أن يتبع نفس الفرع.
- ينشئ الشاغر بحالة `Open`.

### `JR-R002` — نشر الشاغر للعامة
- لا يُعرض للعامة إلا إذا كان `Open`.
- في التفاصيل العامة يوجد تحقق من نافذة التاريخ، بينما القائمة العامة لا تتحقق من التاريخ بنفس الصرامة.

### `JR-R003` — إنشاء الطلب
- يجب أن يرتبط الطلب بشاغر صالح.
- التقديم العام مسموح فقط على شاغر `Open`.
- الطلب يمكن أن ينشأ من المسار العام أو الإداري.

### `JR-R004` — نافذة التأهيل
- عندما يدخل الطلب مرحلة `Submitted` تبدأ نافذة المراجعة.
- السكور إشارة مساعدة وليس قرارًا نهائيًا.
- التأهيل ينقل الطلب إلى `Shortlisted / Qualified`.

### `JR-R005` — المقابلات
- لا مقابلة إلا لطلب مؤهل.
- لا مقابلة ثانية مجدولة لنفس الطلب.
- المقابل يجب أن يكون مؤهلًا.

### `JR-R006` — التدريب
- الدورة لا تبدأ بلا متدربين.
- الحضور بعد البدء فقط.
- الإكمال بعد نهاية الدورة.
- النتيجة بعد الإكمال.

### `JR-R007` — منع الخلط بين الكيانات
- `Vacancy` ليس `Application`.
- `Application` ليس `Interview`.
- `Interview` ليس `TrainingCourse`.
- `TrainingAttendance` ليس `TrainingResult`.
- `Public Job` مجرد عرض للشاغر.
- `Manual Entry` مجرد مسار إنشاء.

### `JR-R008` — التدقيق والتتبع
- كل انتقال مؤثر في الطلب يجب أن يسجل audit log.
- لا تعتبر الحركة مكتملة إذا لم تترك أثرًا تاريخيًا.

### `JR-R009` — مسار التصعيد
- التصعيد يحوّل الطلب إلى وضع مقيد.
- فك التصعيد محصور بدور الإدارة العليا حسب الخلفية الحالية.
- الواجهة لا تعرض فك التصعيد بوضوح حتى الآن.

### `JR-R010` — مسار الانسحاب
- `Retreated` قرار نهائي خاص.
- يجب أن يبقى بنفس المرحلة عند تطبيقه.
- لا يجوز قرار جديد فوقه.

### `JR-R011` — الأرشفة
- الأرشفة مسموحة فقط للحالات النهائية المحددة.
- الطلب المؤرشف لا يعاد أرشفته.

### `JR-R012` — نتائج التدريب
- كل نتيجة تدريبية لها مسارها التشغيلي الخاص.
- `Passed` و`Retraining` و`Rejected` و`Retreated` ليست مجرد تسميات عرض، بل نتائج تؤثر على دورة الطلب.

---

## 9) الواجهة المرتبطة بالدومين

### 9.1 صفحات الإدارة
- `Vacancies.tsx`
- `VacancyDetail.tsx`
- `Applications.tsx`
- `ApplicationDetail.tsx`
- `ManualApplicationEntry.tsx`
- `Interviews.tsx`
- `InterviewDetail.tsx`
- `TrainingCourses.tsx`
- `TrainingCourseDetail.tsx`
- `PublicJobs.tsx`

### 9.2 ملاحظات تشغيلية من الواجهة
- `ApplicationDetail.tsx` هو مركز التفاعل الأهم.
- من داخل `ApplicationDetail.tsx` يمكن فتح مسار إضافة مقدم الطلب إلى سجل الموظفين.
- عند هذا المسار، تُستخدم بيانات المرشح الجغرافية النصية لتهيئة نموذج الموظف، ثم تُحوَّل إلى `geoSelection` قدر الإمكان عبر مطابقة أسماء وحدات الجغرافيا.
- في نموذجَي الإدخال اليدوي والتقديم العام، المحافظة والعنوان التفصيلي هما فقط الحقلان الإلزاميان ضمن عنوان السكن؛ المستويات الأخرى اختيارية.
- `Vacancies.tsx` يطبّق التعديل المتدرج بحسب tier.
- `TrainingCourseDetail.tsx` يفصل بين حالة الدورة ونتيجة المتدرب.
- `PublicJobs.tsx` يقدّم التقديم العام.
- `InterviewDetail.tsx` موجود لكنه غير موصول بوضوح في التنقل الرئيسي.

### 9.3 مصادر القيم في الواجهة
- القوائم المنسدلة تأتي غالبًا من:
  - `systemLists`
  - `GeoSmartSearch`
  - `useBranchStore`
  - `api` helpers
- خرائط النصوص والحالات تُبنى في:
  - `applicationState.ts`
  - صفحات Jobs نفسها
  - بعض المكونات المساعدة

---

## 10) واجهات الـ API

### 10.1 الشواغر
- `GET /api/admin/vacancies`
- `GET /api/admin/vacancies/:id`
- `POST /api/admin/vacancies`
- `PUT /api/admin/vacancies/:id`
- `PATCH /api/admin/vacancies/:id/status`
- `GET /api/public/vacancies`
- `GET /api/public/vacancies/:id`

### 10.2 الطلبات
- `GET /api/admin/applications`
- `POST /api/admin/applications`
- `GET /api/admin/applications/:id`
- `PATCH /api/admin/applications/:id/stage`
- `PATCH /api/admin/applications/:id/decision`
- `PATCH /api/admin/applications/:id/escalate`
- `PATCH /api/admin/applications/:id/resolve-escalation`
- `PATCH /api/admin/applications/:id/archive`
- `GET /api/admin/applications/:id/audit-logs`
- `POST /api/public/applications`

### 10.3 تحويل الطلب إلى موظف
- هذا المسار يتم من الواجهة داخل تفاصيل الطلب.
- المصدر التشغيلي لبيانات الموقع هو بيانات المرشح داخل الطلب، لا كيان خارجي جديد.
- إذا كانت هناك `geoSelection` جاهزة فتُحترم، وإلا تُستخدم أسماء المحافظة والمنطقة والناحية والحي لتعيينها قدر الإمكان.

### 10.4 المقابلات
- `GET /api/admin/interviews`
- `GET /api/admin/interviews/:id`
- `GET /api/admin/interviews/eligible/:jobVacancyId`
- `GET /api/admin/interviews/interviewers`
- `POST /api/admin/interviews`
- `PUT /api/admin/interviews/:id`
- `PATCH /api/admin/interviews/:id/result`

### 10.5 التدريب
- `GET /api/admin/training-courses`
- `GET /api/admin/training-courses/:id`
- `GET /api/admin/training-courses/eligible/:jobVacancyId`
- `GET /api/admin/training-courses/trainers`
- `POST /api/admin/training-courses`
- `PATCH /api/admin/training-courses/:id/start`
- `POST /api/admin/training-courses/:id/attendance`
- `PATCH /api/admin/training-courses/:id/complete`
- `PATCH /api/admin/training-courses/:id/trainees/:applicationId/result`
- `POST /api/admin/training-courses/:id/trainees`

### 10.5 الحضور
- `packages/api/routes/trainingAttendance.ts` موجود، لكن غير موصول حاليًا في التطبيق.

---

## 11) التدقيق والتتبع

### الحقول المسجلة
- `entityType`
- `entityId`
- `applicationId`
- `actionType`
- `performedByRole`
- `performedByUserId`
- `oldValue`
- `newValue`
- `internalReason`

### أحداث التدقيق الأساسية
- تقديم طلب
- انتقال مرحلة
- قرار
- توظيف نهائي
- تصعيد
- فك تصعيد
- أرشفة
- جدولة مقابلة
- نتيجة مقابلة
- بدء دورة تدريبية
- إكمال دورة تدريبية
- تسجيل نتيجة متدرب

### الصلاحية المرتبطة بالعرض
- `jobs.applications.view_audit_logs`

---

## 12) السكور ومطابقة الشاغر

### الدالة
- `packages/web/src/lib/jobMatch.ts`
- `calculateJobMatchScore(applicant, vacancy)`

### الأوزان
- الشهادة: `20`
- التخصص: `25`
- الخبرة: `30`
- الموقع: `10`
- الجنس: `5`
- العمر: `5`
- رخصة القيادة: `5`

### ملاحظات
- السكور إرشادي فقط.
- لا يقرر وحده الانتقال.
- `requiredSkills` و`computerSkills` لا تدخلان فعليًا في الحساب، وإن كانتا ظاهرتين تشغيليًا.

---

## 13) عدم الاتساق والفجوات

### 13.1 الشواغر العامة والتاريخ
- القائمة العامة لا تتحقق من نافذة التاريخ بنفس صرامة التفاصيل العامة.
- هذا يسبب احتمال ظهور شاغر `Open` خارج النطاق الزمني.

### 13.2 التقديم العام والتاريخ
- التقديم العام يعتمد بقوة على `Open`، لكن ليس دائمًا على نافذة التاريخ بنفس الصرامة التي يستخدمها الداخل الإداري.

### 13.3 `trainingAttendance.ts`
- ملف موجود.
- غير موصول في `packages/api/index.ts`.
- غير ممثل بوضوح في الواجهة.

### 13.4 حل التصعيد
- الخلفية تدعم `resolve-escalation`.
- الواجهة لا تعرضه بوضوح.

### 13.5 تعديل الشاغر المؤرشف
- الواجهة تُظهر إمكانية إعادة الفتح في بعض الحالات.
- الخلفية تمنع تغيير حالة الشاغر المؤرشف.

### 13.6 نتيجة `Rejected` في التدريب
- الخلفية والواجهة ليسا متطابقين معنويًا في تفسير هذه النتيجة.
- هذه نقطة يجب حسمها دستوريًا قبل أي تطوير لاحق.

### 13.7 `InterviewDetail`
- الملف موجود.
- لكن route الخاص به غير ظاهر بوضوح في التنقل الرئيسي.

---

## 14) الدساتير الفرعية المطلوبة

الفيتشرات التفصيلية المرتبطة بهذا الدومين يجب أن تكون موجودة ومحدثة في:
- `docs/constitution/features/vacancies.md`
- `docs/constitution/features/public-jobs.md`
- `docs/constitution/features/applications.md`
- `docs/constitution/features/manual-application-entry.md`
- `docs/constitution/features/interviews.md`
- `docs/constitution/features/training-courses.md`

---

## 15) قائمة التحقق قبل أي تعديل على الدومين

- هل الكيان المتأثر محدد؟
- هل الملف المتأثر محدد؟
- هل التعديل يغيّر دورة الحياة؟
- هل يحتاج صلاحية جديدة؟
- هل يحتاج audit log؟
- هل يؤثر على الواجهة؟
- هل يؤثر على الـ API؟
- هل يؤثر على التحقق؟
- هل يكسر المسار العام؟
- هل يكسر المسار الإداري؟
- هل يتعارض مع الحالة الرسمية أو legacy mapping؟
- هل يحتاج تحديث الدستور قبل التنفيذ؟

---

## 16) الخلاصة

هذا الدستور يثبت الحقيقة التشغيلية الحالية لدومين التوظيف والاستقطاب في Golden CRM. هو لا يحاول اختراع سلوك جديد، بل يوضح:
- أين الكيانات.
- كيف تتحرك.
- من يملك صلاحية كل حركة.
- ما الذي يترتب على كل مسار.
- وما هي الفجوات التي يجب حسمها قبل أي تطوير لاحق.

إذا تغيّر السلوك، يجب أن يتغير هذا الدستور أولًا.
