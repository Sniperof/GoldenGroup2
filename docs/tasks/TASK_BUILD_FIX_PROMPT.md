# TASK: إصلاح أخطاء البناء (Build Fix)

## المشكلة
`npm run build` بيفشل بـ ١٣ خطأ TypeScript. الملفات المكسرة = بقايا من النظام القديم (ما عاد مستخدمة).

## الحل
حذف/إصلاح الملفات المكسرة.

---

## الملفات للحذف (بقايا النظام القديم — غير مستخدمة)

هالملفات ما إلها routes بـ `App.tsx` ولا أي ملف تاني بيستوردها (عدا بعضها بيستورد من بعض). هدول كلهم بقايا نظام المهام القديم:

1. `packages/web/src/pages/tasks/DeliveryTaskDetail.tsx`
2. `packages/web/src/pages/tasks/DeliveryTasks.tsx`
3. `packages/web/src/pages/tasks/PostSaleTasksPage.tsx`
4. `packages/web/src/pages/visits/VisitsListPage.tsx`
5. `packages/web/src/taskTypes/device_delivery/DeliveryResultForm.tsx`
6. `packages/web/src/taskTypes/device_delivery/DeliveryResultRenderer.tsx`
7. `packages/web/src/taskTypes/device_delivery/InstallationResultForm.tsx`

> ملاحظة: `InstallationResultRenderer.tsx` لا تحذف — بيستورد `InstallationResultForm` (اللي بتحذف)، بدك تحذف الاستيراد وتستبدله بـ placeholder بسيط.

---

## الملفات للإصلاح (مستوردة بـ App.tsx أو مستخدمة فعلياً)

### 1. `packages/web/src/pages/visits/VisitsListPage.tsx` — الخطأ: type 'string'

**الخطأ:** `api.fieldVisits.list(targetDate)` — بيمرر `string` بس الـ API بياخد object `{ clientId?, date? }`.

**الإصلاح (سطر ~83):**
```js
// قديم
const data = await api.fieldVisits.list(targetDate);

// جديد
const params = targetDate ? { date: targetDate } : {};
const data = await api.fieldVisits.list(params);
```

---

## التحقق بعد الحذف والإصلاح

1. `npm run build` بـ `packages/web` — لازم يمر بدون أخطاء
2. لا تعدل أي ملف تاني

---

## Deliverables

- [ ] ٧ ملفات محذوفة
- [ ] `VisitsListPage.tsx` مُصلح
- [ ] Build passed (0 errors)
