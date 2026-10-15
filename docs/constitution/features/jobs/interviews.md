# دستور الفيتشر — المقابلات

> الحالة: معتمد كفيتشر دستوري للدومين
> المصدر: `docs/constitution/domains/jobs-recruitment.md`، `packages/api/routes/interviews.ts`، `packages/api/services/interviewService.ts`، `packages/api/repositories/interviewRepository.ts`، `packages/web/src/pages/jobs/Interviews.tsx`، `packages/web/src/pages/jobs/InterviewDetail.tsx`

## 1) الملخص التنفيذي
المقابلات تدير سجلات المقابلات المرتبطة بطلب التوظيف، مع شروط أهلية المقابل، ومسار النتيجة، والربط مع الطلب.

## 2) العقد التشغيلي
### 2.1 حدود الفيتشر
- يشمل جدولة المقابلة، تعديلها، تسجيل نتيجتها، واستخراج قائمة المقابلين المؤهلين.
- المقابلة تعتمد على الطلب؛ ليست سجل مرشح مستقلًا.
- الفيتشر يملك سجل المقابلة وانتقالات نتيجتها.

### 2.2 المسار التشغيلي
1. البدء من طلب مؤهل.
2. اختيار مقابل مؤهل.
3. جدولة المقابلة.
4. إنهاء المقابلة أو فشلها عبر مسار المقابلات.
5. حفظ النتيجة وتحديث مسار الطلب تبعًا لها.

### 2.3 القواعد التشغيلية
- لا تُجدول المقابلة إلا لطلب مؤهل.
- يجب أن يكون المقابل مؤهلًا ومربوطًا بنطاق الفرع الصحيح.
- المقابلات المجدولة فقط هي القابلة للتعديل.
- تسجيل النتيجة يجب أن يمر عبر مسار المقابلات نفسه، لا عبر نقطة نهاية عامة.
- لا يجوز إنشاء مقابلة مجدولة ثانية لنفس الطلب إذا كانت هناك مقابلة مجدولة مسبقًا.
- نتيجة المقابلة ليست هي نتيجة التدريب.

### 2.4 عقد المقابل
المقابل ليس كيانًا عميقًا مستقلًا، لكن الفيتشر يعتمد على شروط الأهلية التالية:
- المستخدم فعّال.
- المستخدم مرتبط بفرع فعّال.
- المستخدم يملك الصلاحية `jobs.interviews.conduct`.
- النطاق المسموح `BRANCH` أو `GLOBAL`.

### 2.5 دورة الحالة
- `Interview Scheduled`
- `Interview Completed`
- `Interview Failed`

### 2.6 الصلاحيات والنطاق
- `jobs.interviews.view_list`
- `jobs.interviews.view_detail`
- `jobs.interviews.schedule`
- `jobs.interviews.edit`
- `jobs.interviews.record_result`
- `jobs.interviews.view_eligible`
- `jobs.interviews.conduct`
- الصلاحية تُفعَّل ضمن نطاق `GLOBAL` أو `BRANCH`.

### 2.7 حالات الحافة
- إذا كان المقابل غير فعّال أو خارج نطاق الفرع، يجب منع الجدولة.
- المقابلة غير المجدولة لا يجوز أن تقبل تعديلًا كأنها مجدولة.
- تسجيل النتيجة لا يجوز أن يتجاوز دورة حياة المقابلة.
- قائمة المقابلين يجب ألا تعرض من لا يستوفي عقد الأهلية.

### 2.8 التحقق
- التأكد أن الجدولة تعمل فقط للطلبات والمقابلين المؤهلين.
- التأكد أن نقطة النهاية الخاصة بالنتيجة تحدّث حالة المقابلة الحقيقية.
- التأكد أن قائمة الأهلية تحترم نطاق الفرع.
- التأكد أن التعديل محصور بالمقابلات المجدولة.

## 3) العقد التقني
### 3.1 الكيانات والحقول
حقول المقابلة:
- `id` — نظامي
- `applicationId` — إلزامي
- `interviewType` — إلزامي
- `interviewNumber` — إلزامي / نظامي
- `interviewerName` — إلزامي
- `interviewerUserId` — إلزامي
- `interviewDate` — إلزامي
- `interviewTime` — إلزامي
- `interviewStatus` — مقيد بالنظام
- `internalNotes` — اختياري
- `createdAt` — نظامي

القيم الظاهرة:
- `Interview Scheduled`
- `Interview Completed`
- `Interview Failed`

### 3.2 عقد الواجهة
- `packages/web/src/pages/jobs/Interviews.tsx`
- `packages/web/src/pages/jobs/InterviewDetail.tsx`
- الواجهة يجب أن تعرض الحالة المجدولة، والحالة النهائية، وهوية المقابل.
- لا يجوز للواجهة أن تسمح بانحراف حر في الحالات.

### 3.3 عقد الـ API
- `GET /api/admin/interviews`
- `GET /api/admin/interviews/:id`
- `GET /api/admin/interviews/eligible/:jobVacancyId`
- `GET /api/admin/interviews/interviewers`
- `POST /api/admin/interviews`
- `PUT /api/admin/interviews/:id`
- `PATCH /api/admin/interviews/:id/result`

### 3.4 التوافق الخلفي
- المقابلة تبقى سجلًا stateful مرتبطًا بالطلب.
