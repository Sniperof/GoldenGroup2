# البرومت — صفحة تفاصيل مهمة التوصيل/التركيب/التشغيل (Delivery Task Detail)

> **Target:** Staging branch (`/opt/golden-crm/apps/staging`)
> **Pattern:** نفس نمط `DeviceDemoDetail.tsx` و `EmergencyTaskDetail.tsx` — بيستخدم `TaskDetailLayout`
> **Never touch production.**

---

## الملخص

صفحة تفاصيل لمهام `device_delivery` / `device_installation` / `device_activation` — لما تضغط صف بالجدول (`DeliveryTasks.tsx`) بتفتح هاي الصفحة.

---

## 1. الملفات الجديدة

### 1.1 صفحة التفاصيل الرئيسية

**الملف:** `packages/web/src/pages/tasks/DeliveryTaskDetail.tsx`

**المسار:** `/tasks/delivery/:id`

**الأيقونة:** `Truck`
**لون الأيقونة:** `text-sky-500`

```tsx
import { useParams } from 'react-router-dom';
import { Truck, Wrench, ClipboardCheck } from 'lucide-react';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine, formatDate } from '../../components/tasks/shared';
import type { TaskTypeExtension, TaskDetailData } from '../../components/tasks/types';

// ==================== التاب الإضافي: معلومات التركيب ====================
function InstallationInfoTab({ data }: { data: TaskDetailData }) {
  const { task } = data;
  return (
    <div className="space-y-6" dir="rtl">
      {/* بيانات التسليم */}
      {task.taskType === 'device_delivery' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5 text-sky-500" />
            بيانات التسليم
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoLine label="الرقم التسلسلي" value={task.serialNumber || '—'} />
            <InfoLine label="تاريخ التسليم الفعلي" value={formatDate(task.actualDeliveryDate)} />
            <InfoLine label="عنوان التسليم" value={task.deliveryAddress || '—'} />
            <InfoLine label="حالة الجهاز عند الاستلام" value={
              task.deliveryCondition === 'perfect' ? 'سليم وممتاز' :
              task.deliveryCondition === 'minor_damage' ? 'ضرر طفيف' :
              task.deliveryCondition === 'missing_accessories' ? 'نقص ملحقات' : '—'
            } />
            <InfoLine label="إقرار الزبون" value={task.customerAcknowledged ? 'موقع' : 'غير موقع'} />
            <InfoLine label="مسلّم من" value={task.deliveredByName || '—'} />
          </div>
        </div>
      )}

      {/* بيانات التركيب */}
      {task.taskType === 'device_installation' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-500" />
            بيانات التركيب
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoLine label="مصدر المياه" value={task.waterSourceType || '—'} />
            <InfoLine label="نوع التمديدات" value={task.pipeType || '—'} />
            <InfoLine label="طول التمديد (متر)" value={task.pipeLengthMeters || '—'} />
            <InfoLine label="توصيل كهرباء" value={task.electricalConnectionNeeded ? 'نعم' : 'لا'} />
            <InfoLine label="تثبيت بالحائط" value={task.wallMountingDone ? 'نعم' : 'لا'} />
            <InfoLine label="الملحقات المتركبة" value={task.installedAccessories?.join(', ') || '—'} />
            <InfoLine label="تاريخ بدء التركيب" value={formatDate(task.installationStartDate)} />
            <InfoLine label="تاريخ إنهاء التركيب" value={formatDate(task.installationEndDate)} />
            <InfoLine label="ملاحظات فنية" value={task.technicalNotes || '—'} isBlock />
          </div>
        </div>
      )}

      {/* بيانات التشغيل */}
      {task.taskType === 'device_activation' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-emerald-500" />
            بيانات التشغيل والتسليم النهائي
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoLine label="TDS المياه قبل" value={task.tdsBefore || '—'} />
            <InfoLine label="TDS المياه بعد" value={task.tdsAfter || '—'} />
            <InfoLine label="نتيجة اختبار الضغط" value={task.pressureTestResult || '—'} />
            <InfoLine label="تدريب الزبون" value={task.customerTrainingDone ? 'تم' : 'لم يتم'} />
            <InfoLine label="بطاقة الكفالة" value={task.warrantyCardDelivered ? 'تم التسليم' : 'لم يتم'} />
            <InfoLine label="تاريخ التشغيل" value={formatDate(task.activationDate)} />
            <InfoLine label="ملاحظات التشغيل" value={task.activationNotes || '—'} isBlock />
          </div>
        </div>
      )}

      {/* الروابط بين المهام */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-3">سير العمل المرتبط</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className={`px-2 py-1 rounded-md text-xs font-medium ${
            task.relatedDeliveryTaskId ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'
          }`}>
            تسليم
          </span>
          <span className="text-slate-300">→</span>
          <span className={`px-2 py-1 rounded-md text-xs font-medium ${
            task.relatedInstallationTaskId ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
          }`}>
            تركيب
          </span>
          <span className="text-slate-300">→</span>
          <span className={`px-2 py-1 rounded-md text-xs font-medium ${
            task.relatedActivationTaskId ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
          }`}>
            تشغيل
          </span>
        </div>
      </div>
    </div>
  );
}

// ==================== Renderer للنتيجة ====================
function DeliveryResultRenderer({ task }: { task: any }) {
  if (!task.result && !task.outcome) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-lg font-medium">لم يتم تسجيل نتيجة بعد</p>
        <p className="text-sm mt-2">استخدم زر "تسجيل النتيجة" لحفظ نتيجة المهمة</p>
      </div>
    );
  }

  const result = task.result || task.outcome;
  const isSuccess = result === 'delivered_successfully' || result === 'installed_successfully' || result === 'activated_successfully';

  return (
    <div className="space-y-4" dir="rtl">
      <div className={`bg-white rounded-xl border p-5 shadow-sm ${
        isSuccess ? 'border-emerald-200' : 'border-amber-200'
      }`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isSuccess ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
          }`}>
            {isSuccess ? '✓' : '!'}
          </div>
          <div>
            <h3 className="font-bold text-slate-800">
              {result === 'delivered_successfully' ? 'تم التسليم بنجاح' :
               result === 'installed_successfully' ? 'تم التركيب بنجاح' :
               result === 'activated_successfully' ? 'تم التشغيل بنجاح' :
               result === 'customer_not_available' ? 'الزبون غير متواجد' :
               result === 'wrong_address' ? 'عنوان خاطئ' :
               result === 'refused_delivery' ? 'رفض الاستلام' :
               result === 'installation_incomplete' ? 'تركيب غير مكتمل' :
               result === 'site_not_ready' ? 'الموقع غير جاهز' :
               result === 'needs_adjustment' ? 'يحتاج تعديل' :
               result === 'device_defective' ? 'جهاز معيب' : result}
            </h3>
            <p className="text-sm text-slate-500">{formatDate(task.resultDate)}</p>
          </div>
        </div>

        {/* تفاصيل النتيجة حسب النوع */}
        {task.serialNumber && (
          <InfoLine label="الرقم التسلسلي" value={task.serialNumber} />
        )}
        {task.deliveryCondition && (
          <InfoLine label="حالة الجهاز" value={
            task.deliveryCondition === 'perfect' ? 'سليم' :
            task.deliveryCondition === 'minor_damage' ? 'ضرر طفيف' :
            task.deliveryCondition === 'missing_accessories' ? 'نقص ملحقات' : task.deliveryCondition
          } />
        )}
        {task.tdsBefore && <InfoLine label="TDS قبل" value={task.tdsBefore} />}
        {task.tdsAfter && <InfoLine label="TDS بعد" value={task.tdsAfter} />}
        {task.pressureTestResult && <InfoLine label="اختبار الضغط" value={task.pressureTestResult} />}
        {task.resultNotes && <InfoLine label="ملاحظات" value={task.resultNotes} isBlock />}
      </div>
    </div>
  );
}

// ==================== Main Component ====================
const deliveryExtension: TaskTypeExtension = {
  extraTabs: [
    {
      id: 'installation',
      label: 'معلومات التركيب',
      render: (data) => <InstallationInfoTab data={data} />,
    },
  ],
  ResultRenderer: DeliveryResultRenderer,
};

function scheduleExtraRows(data: TaskDetailData) {
  const { task } = data;
  const visitDate = task.scheduledDate || task.visitDate || null;
  const visitTime = task.scheduledTime || task.visitTime || null;
  return (
    <>
      <InfoLine label="تاريخ الزيارة" value={visitDate ? formatDate(visitDate) : '—'} />
      <InfoLine label="وقت الزيارة" value={visitTime || '—'} />
      <InfoLine label="نوع المهمة" value={
        task.taskType === 'device_delivery' ? 'تسليم جهاز' :
        task.taskType === 'device_installation' ? 'تركيب جهاز' :
        task.taskType === 'device_activation' ? 'تشغيل جهاز' : task.taskType
      } />
    </>
  );
}

function overviewIssuesFor(data: TaskDetailData): string[] {
  const { task } = data;
  const issues: string[] = [];
  if (!task.priority) issues.push('الأولوية غير محددة');
  if (!task.contractId) issues.push('المهمة غير مرتبطة بعقد');
  if (!task.createdByName) issues.push('منشئ المهمة غير موجود');
  if (!task.dueDate) issues.push('تاريخ الاستحقاق غير محدد');
  if (task.taskType === 'device_delivery' && !task.serialNumber) {
    issues.push('الرقم التسلسلي غير مسجل');
  }
  return issues;
}

function hasResultFor(data: TaskDetailData): boolean {
  const { task } = data;
  return Boolean(task.result || task.outcome || task.latestResult);
}

export default function DeliveryTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={Truck}
      typeIconColor="text-sky-500"
      backLabel="مهام التوصيل والتركيب"
      backHref="/tasks/delivery"
      extension={deliveryExtension}
      scheduleExtraRows={scheduleExtraRows}
      overviewIssuesFor={overviewIssuesFor}
      hasResultFor={hasResultFor}
    />
  );
}
```

---

## 2. الملفات اللي لازم تتعدّل

### 2.1 `packages/web/src/App.tsx`

إضافة Route جديد:

```tsx
import DeliveryTaskDetail from './pages/tasks/DeliveryTaskDetail';

// داخل الـ Routes:
<Route path="/tasks/delivery/:id" element={<DeliveryTaskDetail />} />
```

### 2.2 `packages/web/src/pages/tasks/DeliveryTasks.tsx`

تعديل الـ `<tr>` ليصير clickable:

```tsx
// أضف import:
import { useNavigate } from 'react-router-dom';

// داخل component:
const navigate = useNavigate();

// على الـ <tr> (سطر ~329):
<tr 
  key={row.id} 
  className="border-b border-slate-100 hover:bg-sky-50 hover:cursor-pointer transition-colors"
  onClick={() => navigate(`/tasks/delivery/${row.id}`)}
>
```

**مهم:** تأكد إنه الـ `onClick` على الـ `select` (الأولوية) وعلى `button` (اسم الزبون) بيستخدموا `e.stopPropagation()` — هنّي موجودين بالكود الحالي ✅

---

## 3. التابات (Tabs) بالتفصيل

| الترتيب | التاب | المصدر | ملاحظات |
|---------|-------|--------|---------|
| 1 | **نظرة عامة** | `TaskDetailLayout` (base) | + `scheduleExtraRows` بيضيف نوع المهمة + تاريخ/وقت الزيارة |
| 2 | **بيانات الزبون** | `TaskDetailLayout` (base) | جاهز |
| 3 | **العقد والجهاز** | `TaskDetailLayout` (base) | جاهز |
| 4 | **التواصل والمتابعة** | `TaskDetailLayout` (base) | جاهز |
| 5 | **معلومات التركيب** | `extraTabs` (جديد) | **جديد** — بيانات نوع-specific |
| 6 | **النتيجة** | `TaskDetailLayout` (base) | + `DeliveryResultRenderer` custom |

---

## 4. الحقول المطلوبة من الـ API

الصفحة بتستخدم `api.openTasks.get(taskId)` — لازم الـ API يرجع:

| الحقل | النوع | متى يظهر |
|-------|-------|---------|
| `serialNumber` | string | دائماً (إذا مسجل) |
| `actualDeliveryDate` | date | دائماً |
| `deliveryAddress` | string | دائماً |
| `deliveryCondition` | enum | دائماً |
| `customerAcknowledged` | boolean | دائماً |
| `deliveredByName` | string | دائماً |
| `waterSourceType` | string | لما taskType = installation |
| `pipeLengthMeters` | number | لما taskType = installation |
| `electricalConnectionNeeded` | boolean | لما taskType = installation |
| `wallMountingDone` | boolean | لما taskType = installation |
| `tdsBefore` / `tdsAfter` | number | لما taskType = activation |
| `pressureTestResult` | string | لما taskType = activation |
| `customerTrainingDone` | boolean | لما taskType = activation |
| `relatedDeliveryTaskId` | number | دائماً (إذا موجود) |
| `relatedInstallationTaskId` | number | دائماً (إذا موجود) |
| `relatedActivationTaskId` | number | دائماً (إذا موجود) |

---

## 5. القيود

- **لا تعدل** `TaskDetailLayout.tsx` — استخدم الـ extension pattern.
- **Light Theme فقط** — `bg-white`, `border-slate-200`, `text-slate-800`.
- **Staging only**.

---

## 6. التحقق

1. `pnpm tsc --noEmit --skipLibCheck` → 0 errors
2. `pnpm build` → success
3. افتح `/tasks/delivery` → اضغط صف → بتفتح `/tasks/delivery/:id`
4. التابات الستة ظاهرة:
   - نظرة عامة
   - بيانات الزبون
   - العقد والجهاز
   - التواصل والمتابعة
   - معلومات التركيب ← **جديد**
   - النتيجة
