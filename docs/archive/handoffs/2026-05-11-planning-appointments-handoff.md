# Handoff — Planning / Route Assignment / Planning Contact Targets / Telemarketing Appointments

> الحالة: مرجع متابعة للعمل الحالي
> اللغة: عربية موحّدة
> الغرض: حفظ سياق التوثيق الحالي بحيث يمكن العودة مباشرة إلى نفس النقطة في جلسة لاحقة دون إعادة بناء التحليل من البداية.

---

## 1) ما الذي كنا نعمل عليه

كنّا نبني الدساتير الدومينية والفيتشرز في Golden CRM بنفس النسق الثلاثي:

- **Executive Summary**
- **Operational Contract**
- **Technical Contract**

وتم تطبيق هذا النسق على أكثر من ملف ضمن مجال التخطيط والتليماركتينغ.

---

## 2) الملفات الدستورية التي تم تثبيتها حتى الآن

### ضمن التخطيط
- `docs/constitution/domains/planning.md`
- `docs/constitution/features/team-scheduling.md`
- `docs/constitution/features/route-assignment.md`
- `docs/constitution/features/planning-contact-targets.md`

### ضمن التليماركتينغ / المواعيد
- `docs/constitution/features/telemarketing-appointments.md`

### الفهرس
- `docs/constitution/features/README.md`

---

## 3) المعنى التشغيلي الحالي الذي ثُبّت

### 3.1 جدولة الفرق
- أول خطوة في التخطيط التشغيلي.
- مسؤوليتها المباشرة: **مدير الفرع**.

### 3.2 توزيع المسارات / route assignment
- فيتشر مستقلة داخل التخطيط.
- تربط الفريق بالمسارات والمناطق الإضافية وترتيب المحطات.
- ترتبط بحساب **نطاق العمل**.

### 3.3 ملخص الخطة وجهات الاتصال ذات المهام
- `PlanOverview` صار يُفهم كملخص تنفيذي تشغيلي.
- المعنى الحالي لـ `planning/marketing-targets` لم يعد “أهدافًا تسويقية” بالمعنى القديم، بل:
  - **جهات اتصال لديها مهمة داخل نطاق العمل**
  - بغض النظر عن نوع المهمة نفسها.

### 3.4 إدارة المواعيد
- فيتشر مستقلة تم توثيقها كـ `telemarketing-appointments`.
- تم تثبيت أنها ليست مجرد شاشة إدخال وقت.
- هي عقد كامل يربط:
  - الجهة ذات المهمة
  - الموعد
  - المهمة المفتوحة
  - الجهة المرتبطة
  - الزيارة التسويقية الناتجة

---

## 4) القواعد التي تم تثبيتها دستوريًا

### 4.1 قاعدة `pending` الحصرية
- عند احتساب جهات الاتصال ضمن نطاق العمل، الشرط التشغيلي المطلوب هو أن تكون المهمة المفتوحة **قيد الانتظار حصراً**.
- أي توسعة إلى حالات أخرى غير `pending` تُعتبر ثغرة يجب الانتباه لها.

### 4.2 قاعدة جهات الاتصال ذات المهام
- القسم الحالي لا يتحدث عن “أهداف تسويقية” بالمعنى القديم.
- المعنى التشغيلي الصحيح هو: **جهات اتصال لديها مهمة ضمن نطاق العمل**.

### 4.3 قاعدة المواعيد
- الموعد لا يُحجز إلا لجهة اتصال لديها مهمة.
- ويجب أن يكون ضمن الفريق والتاريخ والوقت الصحيح.
- الحجز يؤدي إلى:
  - `booked` على عناصر القائمة
  - `scheduled` على المهمة المفتوحة المؤهلة
  - تحديث `contact_target` إلى `booked`
  - إنشاء `marketingVisit`

---

## 5) طريقة العمل التي اعتمدناها

1. **نقرأ الكود أولًا**
   - لا نعتمد على التخمين.
   - الدستور يُبنى من التطبيق الفعلي والواجهة والـ API.

2. **نفصل بين الاسم التقني والمعنى التشغيلي**
   - إذا كان الاسم قديمًا أو legacy، نُبقيه تقنيًا ونشرح معناه التشغيلي الحالي.

3. **نكتب ثلاث طبقات**
   - Executive Summary
   - Operational Contract
   - Technical Contract

4. **نشتغل خطوة خطوة**
   - feature واحدة في كل مرة.
   - ثم نراجع الترابط مع المكونات المرتبطة.

5. **نسجل الفجوات بدل ما نخفيها**
   - أي قيد غير مطابق أو توسعة غير مرغوبة تُسجَّل كـ gap / loophole.

---

## 6) الملفات الكودية التي تم الرجوع إليها

- `packages/web/src/pages/planning/TeamScheduler.tsx`
- `packages/web/src/pages/planning/RouteAssigner.tsx`
- `packages/web/src/pages/planning/PlanOverview.tsx`
- `packages/web/src/pages/planning/PlanningContactTargets.tsx`
- `packages/api/routes/schedules.ts`
- `packages/api/routes/routeAssignments.ts`
- `packages/api/routes/planning.ts`
- `packages/api/services/planningMarketingTargets.ts`
- `packages/api/routes/telemarketing.ts`
- `packages/web/src/pages/TelemarketerWorkspace.tsx`
- `packages/web/src/components/telemarketing/AppointmentSchedulerModal.tsx`
- `packages/web/src/components/telemarketing/TeamAgendaPanel.tsx`
- `packages/web/src/components/telemarketing/OutcomeRecorderModal.tsx`
- `packages/shared/types.ts`
- `packages/shared/telemarketingOutcomes.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/hooks/useTelemarketingStore.ts`

---

## 7) النقطة التي وقفنا عندها

كنا قد بدأنا تفكيك **Lifecycle الموعد** داخل إدارة المواعيد، ثم انتقلنا إلى تحديد وجود مشاكل تحتاج معالجة منفصلة.

الآن نقطة الوقوف الحالية هي:
- مراجعة المشاكل واحدة واحدة
- كتابة **برومبت مستقل لكل مشكلة** ليُرسل إلى كلود
- ثم الرجوع إلى هذا الملف كمرجع سياقي عند الاستئناف

---

## 8) المشاكل المفتوحة التي يجب التعامل معها لاحقًا

### 8.1 Lifecycle الموعد
نحتاج تدقيقًا دقيقًا في:
- `pending`
- `booked_marketing_appointment`
- `booked`
- `scheduled`
- `contact_target`
- `marketingVisit`

### 8.2 عقد الحجز
نحتاج فحصًا هل `POST /telemarketing/appointments` يطابق فعليًا المعنى الجديد:
- جهة اتصال لديها مهمة
- بغض النظر عن نوع المهمة

### 8.3 drift المصطلحي
نحتاج تقليل اللبس بين:
- `marketingTargets`
- `contactTargets`
- `planning-contact-targets`
- المواعيد

---

## 9) كيف نكمل من هنا

عند العودة، نكمل مباشرة من هذا التسلسل:
1. lifecycle الموعد
2. عقد الحجز
3. المصطلحات القديمة مقابل المعنى التشغيلي الحالي
4. ثم نربط ذلك بملفات الزيارة الناتجة

---

## 10) ملاحظة تشغيلية

هذا الملف هو **handoff context** وليس دستورًا تشغيليًا جديدًا.
وظيفته الوحيدة هي حفظ السياق واستعادة نقطة التقدم الحالية بسرعة.
