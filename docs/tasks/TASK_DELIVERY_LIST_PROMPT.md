# البرومت — صفحة جدول مهام خدمات ما بعد البيع (Delivery Tasks Table)

> **Target:** Staging branch (`/opt/golden-crm/apps/staging`)
> **Pattern:** نفس نمط `DeviceDemo.tsx` (جدول مهام مع فلاتر وأعمدة)
> **Never touch production.**

---

## الملخص

صفحة جديدة بعرض مهام `device_delivery` / `device_installation` / `device_activation` بجدول (نفس نمط عروض الأجهزة) — بس بدون Dashboard/Stepper. الصفحة الحالية (`PostSaleTasksPage.tsx`) تبقى كـ Dashboard overview.

---

## 1. المسار والتسمية

| العنصر | القيمة |
|--------|--------|
| الملف | `packages/web/src/pages/tasks/DeliveryTasks.tsx` |
| الـ Route | `/tasks/delivery` |
| عنوان الصفحة | "مهام التوصيل والتركيب" |
| الـ Icon | `Truck` |

---

## 2. أعمدة الجدول

| # | العمود | مصدر البيانات | ملاحظات |
|---|--------|--------------|---------|
| 1 | **معرف المهمة** | `row.id` | `font-mono text-xs` |
| 2 | **الفرع** | `row.displayBranchName` / `row.branchName` | — |
| 3 | **اسم الزبون الكامل** | `row.clientFirstName + fatherName + lastName` | clickable → ClientCardPopup |
| 4 | **العنوان** | `row.installationAddress` أو `row.contractInstallationAddress` | **من العقد** (مش من عنوان الزبون العام) |
| 5 | **رقم الموبايل الأساسي** | `row.clientMobile` / `row.clientSnapshot.mobile` | `dir="ltr"` |
| 6 | **نوع المهمة** | `row.taskType` | labels: `تسليم جهاز` / `تركيب جهاز` / `تشغيل جهاز` |
| 7 | **المرحلة** | `row.phase` أو `getTaskPhase(row.status)` | badge ملون حسب `OPEN_TASK_PHASE_COLORS` |
| 8 | **الحالة** | `row.status` | badge ملون حسب `OPEN_TASK_STATUS_LABELS` |
| 9 | **الأولوية** | `row.priority` | dropdown قابل للتعديل (high/medium/low) |
| 10 | **تاريخ الاستحقاق** | `row.dueDate` | مع `getDueDateStatus` badge |
| 11 | **التاريخ المتوقع** | `row.expectedDate` | مع `getExpectedDateStatus` badge |
| 12 | **نتيجة المهمة** | `row.taskResult` / `row.outcome` | **جديد** — عرض نتيجة المهمة إذا مسجلة |
| 13 | **تاريخ الزيارة** | `row.scheduledDate` | — |
| 14 | **حالة الزيارة** | `row.visitStatus` | badge ملون |
| 15 | **منشئ المهمة** | `row.displayCreatedByName` | — |
| 16 | **تاريخ الإنشاء** | `row.createdAt` | `formatDate` |

---

## 3. الفلاتر (Filters)

نفس فلاتر `DeviceDemo.tsx`:
- **حالة المهمة** (status dropdown)
- **حالة الزيارة** (visitStatus dropdown)
- **مجدول / غير مجدول** (scheduled: yes/no)
- **تاريخ الزيارة** (date input)
- **إخفاء المؤجلة** (checkbox — hideSnoozed)
- **إخفاء اللاحقة** (checkbox — hideFutureTasks)

**فلتر إضافي جديد:**
- **نوع المهمة** (taskType): الكل / تسليم / تركيب / تشغيل

---

## 4. الـ API

```ts
// استدعاء المهام
api.openTasks.list({
  branchId,
  taskFamily: 'delivery',  // بيرجع التلاتة: device_delivery, device_installation, device_activation
  ...(taskTypeFilter ? { taskType: taskTypeFilter } : {}),
  ...(statusFilter ? { status: statusFilter } : {}),
  ...(visitStatusFilter ? { visitStatus: visitStatusFilter } : {}),
  ...(dateFilter ? { scheduledDate: dateFilter } : {}),
  ...(scheduledFilter === 'yes' || scheduledFilter === 'no' ? { scheduled: scheduledFilter } : {}),
  ...(hideSnoozed ? { hideSnoozed: 'true' } : {}),
  ...(hideFutureTasks ? { hideFutureTasks: 'true' } : {}),
});
```

---

## 5. الـ Sidebar

إضافة بند فرعي تحت "خدمات ما بعد البيع":

```ts
// MainLayout.tsx — operationsChildren
{ path: '/tasks/post-sale', label: 'لوحة التتبع', icon: LayoutDashboard },  // Dashboard الحالي
{ path: '/tasks/delivery', label: 'مهام التوصيل والتركيب', icon: ListChecks },  // الجدول الجديد
```

**ملاحظة:** `PostSaleTasksPage` (Dashboard) بيصير اسمه "لوحة التتبع" ويلي بيفتح لما تضغط "خدمات ما بعد البيع" الرئيسي.

---

## 6. الـ Route

```tsx
// App.tsx
<Route path="/tasks/delivery" element={<DeliveryTasks />} />
```

---

## 7. التصميم (Light Theme)

نفس `DeviceDemo.tsx` بالضبط:
- خلفية: `bg-slate-50`
- كروت/جدول: `bg-white border-slate-200`
- نص: `text-slate-800` / `text-slate-600`
- header icon: `bg-sky-500` (أو `bg-indigo-500`)
- hover على الصف: `hover:bg-sky-50`

**ما بده Dark Theme ابداً.**

---

## 8. الملفات اللي لازم تتعدّل/تُنشأ

| # | المسار | العمل |
|---|--------|-------|
| 1 | `packages/web/src/pages/tasks/DeliveryTasks.tsx` | إنشاء جديد |
| 2 | `packages/web/src/layout/MainLayout.tsx` | تعديل — إضافة بند فرعي |
| 3 | `packages/web/src/App.tsx` | تعديل — إضافة Route |
| 4 | `packages/shared/types.ts` | تعديل — إضافة label للأنواع الجديدة إذا ناقص |

---

## 9. القيود

- **لا تحذف** `PostSaleTasksPage.tsx` — بتبقى Dashboard.
- **لا تغير** `PostSaleStepper.tsx`.
- **Light Theme فقط** — نفس ألوان `DeviceDemo.tsx` و `OpenTasks.tsx`.
- **Staging only**.

---

## 10. التحقق

1. `pnpm tsc --noEmit --skipLibCheck` → 0 errors
2. `pnpm build` → success
3. Sidebar → بند "مهام التوصيل والتركيب" ظاهر
4. الصفحة → جدول مهام `delivery` family ظاهر
5. فلتر "نوع المهمة" → بيفلتر حسب `device_delivery` / `device_installation` / `device_activation`
