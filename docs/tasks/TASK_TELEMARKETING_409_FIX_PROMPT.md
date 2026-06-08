# TASK: تصحيح خطأ 409 عند حجز موعد لمهام ما بعد البيع

## ⚠️ أولوية قصوى — تعديلات جوهرية ودقيقة

هذا الملف يوثق مشكلة حرجة في نظام حجز المواعيد (`telemarketing appointments`) تؤدي إلى رفض حجز مواعيد لمهام ما بعد البيع (`device_delivery` / `device_installation` / `device_activation`) بسبب فحص خاطئ لـ `contact_target`. أي خطأ في التنفيذ قد يعطل مسار حجز المواعيد بالكامل.

---

## 1. المشكلة (Problem Statement)

### 1.1 السيناريو الفاشل

```
1. زبون له عقد sale_contract (جهاز)
2. النظام ينشئ مهمة device_delivery تلقائياً (status: open)
3. الزبون كان سابقاً ضمن حملة تسويقية (telemarketing campaign)
4. الحملة القديمة أنشأت contact_target للزبون → status: closed
5. المستخدم يحاول حجز موعد لمهمة التسليم (device_delivery)
6. النظام يرفض الحجز:
   API Error 409: "لا يمكن حجز موعد — جهة الاتصال مُقفلة بالفعل"
```

### 1.2 لماذا هذا خطأ؟

**المنطق الحالي الخاطئ:**
- endpoint `POST /telemarketing/appointments` يفحص `contact_target.status === 'closed'`
- لكنه لا يفرّق بين مصدر المهمة
- `contact_target` قديمة من حملة تسويقية → مقفلة → يلزم ذلك
- `device_delivery` مهمة عقدية جديدة → لا علاقة لها بالـ contact_target القديمة

**المنطق الصحيح (حسب دستور المشروع):**
- `contact_target` عمرها محدود بـ "يوم/حملة/سبب"
- جهة الاتصال تسير: جاهزة → ضمن القائمة → تم التواصل → مغلقة
- لما بتسكّر بتسكّر لسبب (حجز سابق أو إغلاق)
- بكرة في جهة جديدة
- مهام ما بعد البيع (`device_delivery` family) لا تستخدم `contact_target` القديمة
- إذا احتاج التواصل مع الزبون للتسليم، بيفتح جهة اتصال **جديدة** — لا يستخدم قديمة

---

## 2. الملفات المطلوب قراءتها (Pre-Implementation Reading)

> **إلزامي:** اقرأ الملفات التالية بالكامل قبل أي تعديل. لا تعتمد على الاختصارات.

### 2.1 Backend — الملف الأساسي
```
packages/api/routes/telemarketing.ts
```
- اقرأ السطور: 1390–1530 بالتحديد
- ركّز على:
  - `resolveContactTargetFromItem()` (سطر ~190)
  - `loadTaskListItem()` (سطر ~207)
  - فحص `contactTargetId != null` + `status === 'closed'` (سطر ~1464–1475)
  - فحص `LOCKED_TASK_STATUSES` (سطر ~1462, 1519)
  - `updateContactTargetLifecycle()` (سطر ~231)
  - كيف يتم استخدام `contactTargetId` لاحقاً بعد الحجز (سطر ~1640+)

### 2.2 Frontend — حجز المواعيد
```
packages/web/src/hooks/useTelemarketingStore.ts
```
- ركّز على: `addAppointment()` وكيف يبني الـ payload

```
packages/web/src/components/telemarketing/AppointmentSchedulerModal.tsx
```
- ركّز على: كيف يتم اختيار المهام (`selectedOpenTasks`) وإرسالها

### 2.3 Frontend — مهام ما بعد البيع
```
packages/web/src/components/tasks/PostSaleStepper.tsx
```
- ركّز على: كيف يتم حجز موعد للتسليم/التركيب (إن وجد)
- تحديداً: هل يتم استخدام نفس `AppointmentSchedulerModal` أم لا؟

### 2.4 الدستور (Constitution) — إلزامي
```
docs/constitution/features/telemarketing-appointments.md
```
- اقرأ: `AP-R007` (إغلاق جهة الاتصال)
- اقرأ: `AP-G005` (قاعدة "الوعاء" والحالات المسموح بها)

```
docs/constitution/features/planning-contact-targets.md
```
- اقرأ: مسار جهة الاتصال (سطور 133–138)
- اقرأ: `PC-G001` (القيد على نوع المهمة)

```
docs/constitution/domains/tasks.md
```
- اقرأ: دورة حياة المهمة وحالاتها

### 2.5 Types
```
packages/shared/types.ts
```
- ابحث عن: `TaskTypeConfig`, `OpenTask`, أنواع المهام العقدية

---

## 3. التحليل الجذري (Root Cause Analysis)

### 3.1 السؤال الحاسم

هل مهام `device_delivery` / `device_installation` / `device_activation` تستخدم نفس آلية حجز المواعيد (`POST /telemarketing/appointments`) أم لها endpoint منفصل؟

**الإجابة (من الكود):**
- في `PostSaleStepper.tsx` (سطر 141): يستخدم `api.marketingVisits.submitDeliveryResult()` لتسجيل النتيجة
- لكن **لا يوجد** في `PostSaleStepper.tsx` حجز موعد مباشر — المهمة بتكون `open` وما محجوزة
- المستخدم ممكن يحجز موعد لمهمة التسليم من خلال:
  - إما صفحة التسليم نفسها (`DeliveryTaskDetail`) → زر "حجز زيارة"
  - أو من شاشة "جميع المهام المفتوحة"

### 3.2 من أين يأتي `contactTargetId`؟

في `telemarketing.ts:1390–1401`:
```ts
let contactTargetId: number | null = null;

if (appointment.taskListItemId && appointment.taskListId) {
  contactTargetId = await resolveContactTargetFromItem(pool, appointment.taskListId, appointment.taskListItemId);
}

const taskListItem = await loadTaskListItem(pool, appointment.taskListId, appointment.taskListItemId);
contactTargetId = taskListItem.contact_target_id ?? null;
```

المشكلة: إذا وصل `taskListItemId` (من التلي ماركتينج) → بيجيب `contact_target_id` القديمة المقفلة.

لكن إذا المهمة `device_delivery` من العقد → **لا يوجد** `taskListItemId` أصلاً! المفروض `contactTargetId` يكون `null`.

### 3.3 لكن المشكلة تحدث فعلياً

المستخدم قال إنه بيحصل 409. هذا يعني أحد الأحتمالين:

**احتمال أ:** `taskListItemId` يُبعث مع مهام `device_delivery` (خطأ في Frontend)
**احتمال ب:** `contactTargetId` يُستخرج بطريقة أخرى (مثلاً من `open_task` المرتبطة)
**احتمال ج:** `contactTargetId` يتم استنتاجه من `client_id` وليس من `taskListItemId`

**المطلوب:** تحديد أي احتمال هو الصحيح من الكود.

---

## 4. التعديل المطلوب (Required Changes)

### 4.1 الخيار المُعتمد: استثناء مهام Post-Sale من فحص contact_target

```ts
// في packages/api/routes/telemarketing.ts
// بعد السطر 1461، قبل السطر 1464

const POST_SALE_TASK_TYPES = ['device_delivery', 'device_installation', 'device_activation'];

// هل كل المهام المختارة من نوع post-sale؟
const allTasksArePostSale = rawSelectedTasks.length > 0 && 
  rawSelectedTasks.every(t => POST_SALE_TASK_TYPES.includes(t.taskType));

// إذا كانت post-sale → تجاوز فحص contact_target
if (!allTasksArePostSale && contactTargetId != null) {
  const ctRow = await pgClient.query<{ status: string }>(
    'SELECT status FROM contact_targets WHERE id = $1',
    [contactTargetId],
  );
  if (ctRow.rows[0]?.status === 'closed') {
    await pgClient.query('ROLLBACK');
    return res.status(409).json({
      error: 'لا يمكن حجز موعد — جهة الاتصال مُقفلة بالفعل (نتيجة حجز سابق أو إغلاق).'
    });
  }
}
```

### 4.2 أيضاً — تجاوز تحديث contact_target بعد الحجز

في نفس الملف، ابحث عن `updateContactTargetLifecycle` بعد الحجز (سطر ~1640):
```ts
if (contactTargetId != null) {
  await updateContactTargetLifecycle(pgClient, contactTargetId, {
    status: 'closed',
    latestCallOutcome: 'booked_marketing_appointment',
    latestAppointmentId: savedAppointment.id,
  });
}
```

**التعديل المطلوب:**
```ts
if (contactTargetId != null && !allTasksArePostSale) {
  await updateContactTargetLifecycle(pgClient, contactTargetId, {
    status: 'closed',
    latestCallOutcome: 'booked_marketing_appointment',
    latestAppointmentId: savedAppointment.id,
  });
}
```

**لماذا؟** لأنه:
- إذا كانت المهمة post-sale → لا يوجد `contact_target` حالية للإغلاق
- إغلاق `contact_target` قديمة = خطأ فادح (بتغيّر حالة جهة اتصال تاريخية)

### 4.3 أيضاً — تجاوز إغلاق عناصر قائمة الاتصال

ابحث عن (سطر ~1585–1595):
```ts
// Mark ALL selected task list items as booked.
const allSelectedItemIds = rawSelectedTasks.map(t => t.taskListItemId).filter(Boolean);
if (allSelectedItemIds.length > 0) {
  await pgClient.query(...);
}
```

**تحقق:** هل يتم تحديث `telemarketing_task_list_items` لمهام post-sale؟ إذا نعم → يجب حمايتها.

---

## 5. شروط التحقق بعد التنفيذ (Post-Implementation Verification)

### 5.1 اختبارات Backend

```bash
# 1. بناء المشروع
pnpm --filter @golden-crm/api exec tsc --noEmit --skipLibCheck

# 2. بناء الواجهة
pnpm --filter @golden-crm/web exec tsc --noEmit --skipLibCheck

# 3. بناء كامل
pnpm build
```

### 5.2 اختبارات وظيفية (Functional Tests)

**سيناريو 1: التلي ماركتينج (يجب يظل يعمل)**
```
- زبون لديه contact_target مفتوحة (status: 'in_contact_list')
- مهمة device_demo مفتوحة
- حجز موعد → يجب ينجح
- بعد الحجز → contact_target تصبح closed
```

**سيناريو 2: التلي ماركتينج مع contact_target مقفلة (يجب يرفض)**
```
- زبون لديه contact_target مقفلة (status: 'closed')
- مهمة device_demo مفتوحة
- حجز موعد → يجب يرفض بـ 409
```

**سيناريو 3: Post-Sale مع contact_target قديمة مقفلة (يجب ينجح)**
```
- زبون لديه contact_target قديمة مقفلة من حملة تسويقية
- مهمة device_delivery مفتوحة (من العقد)
- حجز موعد → يجب ينجح ✅
- contact_target القديمة يجب ألا تتغيّر
```

**سيناريو 4: Post-Sale + Telemarketing مختلط (يجب يرفض)**
```
- مهمة device_delivery + مهمة device_demo مختارتين معاً
- حجز موعد → يجب يرفض بـ 409 (لأن في device_demo)
```

### 5.3 تحقق من عدم تعديل contact_target القديمة

بعد اختبار سيناريو 3:
```sql
SELECT id, status, latest_call_outcome, updated_at 
FROM contact_targets 
WHERE id = <contact_target_id_القديمة>;
```
يجب أن تبقى:
- `status = 'closed'` (ما تغيّرت)
- `latest_call_outcome` = ما كان عليه (ما تغيّر)
- `updated_at` = قديم (ما تغيّر)

---

## 6. المخاطر والاحتياطات (Risks & Precautions)

### 6.1 خطر 1: إغلاق contact_target خاطئ
**التأثير:** إذا تم استدعاء `updateContactTargetLifecycle` لـ post-sale → بتغيّر contact_target قديمة → بيخترب تاريخ التلي ماركتينج.
**الحماية:** تأكد من `!allTasksArePostSale` قبل أي استدعاء لـ `updateContactTargetLifecycle`.

### 6.2 خطر 2: تسريب post-sale إلى telemarketing_task_list_items
**التأثير:** إذا تم تحديث `telemarketing_task_list_items` لمهام post-sale → بتظهر بيانات خاطئة.
**الحماية:** تحقق أن `taskListItemId` موجود فعلاً في `telemarketing_task_list_items` قبل التحديث.

### 6.3 خطر 3: فقدان validation على telemarketing tasks
**التأثير:** إذا كان الشرط `!allTasksArePostSale` خاطئًا → بيتخطّى validation للتلي ماركتينج.
**الحماية:** اختبر السيناريو 2 والسيناريو 4 أعلاه.

---

## 7. التقرير المطلوب (Required Report)

بعد التنفيذ، قدّم تقريراً يحتوي على:

### 7.1 ملخص التعديلات
- الملفات المعدّلة (مع مساراتها الكاملة)
- عدد الأسطر المضافة/المحذوفة في كل ملف
- أي migration جديدة؟

### 7.2 التحليل التفصيلي
- أي احتمال من 3.3 كان الصحيح؟
- هل `taskListItemId` يُبعث مع post-sale tasks؟
- كيف تم اكتشاف `contactTargetId`؟

### 7.3 نتائج الاختبارات
- جدول بـ 4 سيناريوهات (نجح/فشل + التفاصيل)
- لقطة من أي خطأ (إن وجد)

### 7.4 المخاطر المعالجة والمتبقية
- أي من المخاطر في القسم 6 تم معالجتها؟
- أي مخاطر لا تزال قائمة؟

### 7.5 الأسئلة المفتوحة
- هل يوجد مكان آخر في الكود يفحص `contact_target` بطريقة مشابهة؟
- هل `marketingVisits` endpoint (`PATCH /:id/result`) يحتاج تعديل مشابه؟
- هل `openTasks.ts` يحتاج تعديل؟

---

## 8. ملاحظات تنفيذية

### 8.1 Branch & Environment
- **العمل على:** `staging` branch
- **المسار:** `/opt/golden-crm/apps/staging`
- **لا تلمس:** Production (`/opt/golden-crm/app/GoldenGroup2`)

### 8.2 بعد التنفيذ
```bash
# 1. بناء
pnpm build

# 2. إعادة تشغيل السيرفر
pm2 restart golden-crm-staging

# 3. التحقق من السجلات
pm2 logs golden-crm-staging --lines 50
```

### 8.3 Git Commit
```bash
git add .
git commit -m "fix(telemarketing): bypass contact_target check for post-sale tasks

- device_delivery, device_installation, device_activation tasks
  no longer require an open contact_target for appointment booking.
- Prevents 409 error when booking visits for delivery tasks
  where the client has an old closed contact_target from a
  previous telemarketing campaign.
- Also prevents accidentally updating legacy contact_target
  records when booking post-sale appointments."
```

---

## 9. المراجع

### الملفات التي يجب قراءتها (إلزامي):
1. `packages/api/routes/telemarketing.ts` (السطور 1390–1530, 1585–1600, 1640–1660)
2. `packages/api/routes/openTasks.ts` (للفهم العام — البحث عن `taskFamily = 'delivery'`)
3. `packages/web/src/components/tasks/PostSaleStepper.tsx`
4. `packages/web/src/hooks/useTelemarketingStore.ts`
5. `docs/constitution/features/telemarketing-appointments.md`
6. `docs/constitution/features/planning-contact-targets.md`
7. `docs/constitution/domains/tasks.md`

---

**تاريخ الإنشاء:** 2026-05-21
**المسار:** `/opt/golden-crm/apps/staging/docs/tasks/TASK_TELEMARKETING_409_FIX_PROMPT.md`
**الحالة:** جاهز للتنفيذ
