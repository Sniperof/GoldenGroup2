# دستور الفيتشر — الدورات التدريبية

> الحالة: معتمد كفيتشر دستوري للدومين
> المصدر: `docs/constitution/domains/jobs-recruitment.md`، `packages/api/routes/trainingCourses.ts`، `packages/api/services/trainingCourseService.ts`، `packages/api/repositories/trainingCourseRepository.ts`، `packages/web/src/pages/jobs/TrainingCourses.tsx`، `packages/web/src/pages/jobs/TrainingCourseDetail.tsx`

## 1) الملخص التنفيذي
الدورات التدريبية تدير المسار التدريبي بعد التأهيل أو المقابلة، بما يشمل الدورة، المتدربين، الحضور، ونتيجة كل متدرب.

## 2) العقد التشغيلي
### 2.1 حدود الفيتشر
- يشمل إنشاء الدورة، ربط المتدربين، تسجيل الحضور، دورة حياة الدورة، وتسجيل نتائج المتدربين.
- التدريب ليس كيان مرشح مستقلًا؛ بل هو مسار لاحق فوق سجلات الطلب.
- الفيتشر يشمل الدورة، وسجل المتدرب، وسجل الحضور، وسجل النتيجة.
- نقطة إنشاء الدورة محصورة في صفحة إدارة الدورات التدريبية (`TrainingCourses.tsx`) وليس من صفحة تفاصيل الطلب.

### 2.2 المسار التشغيلي
1. إنشاء دورة تدريبية.
2. إضافة المتدربين المؤهلين.
3. بدء الدورة.
4. تسجيل الحضور اليومي.
5. إكمال الدورة.
6. تسجيل نتيجة كل متدرب.

### 2.3 القواعد التشغيلية
- لا يمكن للدورة أن تبدأ بدون متدربين.
- الحضور لا يُسجَّل إلا بعد بدء الدورة.
- لا يمكن إكمال الدورة قبل تاريخ النهاية.
- لا يمكن تسجيل نتيجة المتدرب إلا بعد اكتمال الدورة.
- `deviceName` اختياري.
- `trainer` إلزامي.
- نتيجة التدريب تؤثر في المسار النهائي للطلب.
- الدورة مرتبطة بالشاغر وبالفرع.

### 2.4 مسارات نتائج التدريب
نتيجة المتدرب ليست مسارًا واحدًا في الواجهة أو التوثيق. يجب معاملة كل نتيجة كمسار تشغيلي مستقل:

#### أ) نتيجة `Passed`
- تعني نجاح المتدرب.
- تنقل الطلب إلى `Final Decision`.
- تنتقل الحالة التوافقية إلى `Passed`.
- يبقى القرار النهائي لاحقًا مفتوحًا ضمن مسار القرار النهائي.

#### ب) نتيجة `Retraining`
- تعني أن المتدرب يحتاج إعادة تدريب.
- تعيد الطلب إلى `Training` بحالة توافقية `Retraining`.
- يوجد حد أقصى لإعادة التدريب مرتبط بالشاغر.
- إذا استُنفد الحد، يجب رفض النتيجة.

#### ج) نتيجة `Rejected`
- تعني رفض المتدرب بعد التدريب.
- تنقل الطلب إلى `Final Decision` كمسار قرار نهائي لاحق.
- تبقى هذه النتيجة ضمن مسار التوافق القديم كـ `Passed` في بعض الشاشات بسبب التوافق الخلفي، لذلك يجب ذكرها بوضوح في الواجهة والدستور.

#### د) نتيجة `Retreated`
- تعني انسحاب المتدرب/الطلب من المسار التدريبي.
- تُعامل كقرار نهائي أو شبه نهائي بحسب المحرك.
- يجب أن تظهر بوضوح كمسار انسحاب منفصل، لا كحالة عامة.

### 2.5 دورة الحالة
- `Training Scheduled`
- `Training Started`
- `Training Completed`

### 2.6 الصلاحيات والنطاق
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
- الصلاحية تُفعَّل ضمن نطاق `GLOBAL` أو `BRANCH`.

### 2.7 حالات الحافة
- الدورة التي لا تملك متدربين لا يجوز أن تبدأ.
- تسجيل الحضور خارج دورة بدأت يجب أن يُرفض.
- نتيجة المتدرب لا تُسجَّل قبل الإكمال.
- قيم النتيجة يجب أن تبقى ضمن المجموعة الموثقة.
- مسار النتيجة يجب أن يكون واضحًا للمستخدمين حتى لو كان الـ API موحدًا.

### 2.8 التحقق
- التأكد أن قيود دورة الحياة مطبقة.
- التأكد أن الحضور اليومي لكل متدرب يعمل كما هو متوقع.
- التأكد أن نتائج المتدربين لا تظهر إلا بعد الإكمال.
- التأكد أن كل نتيجة لها مسار واضح في الواجهة والتوثيق.

## 3) العقد التقني
### 3.1 الكيانات والحقول
حقول الدورة التدريبية:
- `id` — نظامي
- `trainingName` — إلزامي
- `jobVacancyId` — إلزامي
- `branch` — إلزامي
- `deviceName` — اختياري
- `trainer` — إلزامي
- `startDate` — إلزامي
- `endDate` — إلزامي
- `trainingStatus` — مقيد بالنظام
- `notes` — اختياري
- `createdByUserId` — نظامي
- `createdAt` — نظامي
- `updatedAt` — نظامي

حقول ربط المتدرب:
- `trainingCourseId`
- `applicationId`
- `result`
- `resultRecordedAt`
- `resultRecordedBy`
- `addedAt`

حقول الحضور:
- `trainingCourseId`
- `applicationId`
- `attendanceDate`
- `status`
- `recordedByUserId`

القيم الظاهرة:
- حالات الدورة: `Training Scheduled` / `Training Started` / `Training Completed`
- حالات الحضور: `Present` / `Absent`
- نتائج المتدرب: `Passed` / `Retraining` / `Rejected` / `Retreated`

### 3.2 عقد الواجهة
- `packages/web/src/pages/jobs/TrainingCourses.tsx`
- `packages/web/src/pages/jobs/TrainingCourseDetail.tsx`
- الواجهة يجب أن تعرض حالة الدورة، قائمة المتدربين، الحضور، والنتيجة.
- يجب أن تفصل الواجهة بين حالة الدورة وبين نتيجة المتدرب.
- زر/مسار كل نتيجة يجب أن يكون واضحًا للمستخدم، حتى لو كانت نقطة النهاية الداخلية واحدة.

### 3.3 عقد الـ API
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

### 3.4 التوافق الخلفي
- تبقى مفاهيم Course وTrainee وAttendance وResult مفاهيم تشغيلية منفصلة لكنها مرتبطة بنفس الطلب.
