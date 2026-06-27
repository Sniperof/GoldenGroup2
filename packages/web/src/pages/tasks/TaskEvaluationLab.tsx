import { useMemo, useState, type ComponentType } from 'react';
import { AlertCircle, Beaker, ClipboardCheck, Eye, FilePlus2, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import PageHeader from '../../components/ui/PageHeader';
import DeviceDemoResultModal from '../../taskTypes/device_demo/DeviceDemoResultModal';
import DeviceDeliveryResultModal from '../../taskTypes/device_delivery/DeviceDeliveryResultModal';
import DeviceInstallationResultModal from '../../taskTypes/device_delivery/DeviceInstallationResultModal';
import DeviceActivationResultModal from '../../taskTypes/device_delivery/DeviceActivationResultModal';
import DeviceCheckupResultModal from '../../taskTypes/device_delivery/DeviceCheckupResultModal';
import DeviceDisconnectionResultModal from '../../taskTypes/device_delivery/DeviceDisconnectionResultModal';
import DeviceRetrievalResultModal from '../../taskTypes/device_delivery/DeviceRetrievalResultModal';
import DeviceReturnResultModal from '../../taskTypes/device_delivery/DeviceReturnResultModal';
import DeviceTransferResultModal from '../../taskTypes/device_delivery/DeviceTransferResultModal';
import EmergencyResultModal from '../../taskTypes/emergency_maintenance/EmergencyResultModal';
import GoldenWarrantyOfferModal from '../../taskTypes/golden_warranty_offer/GoldenWarrantyOfferModal';
import GoldenWarrantyCardDeliveryModal from '../../taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardDeliveryModal';
import InstallmentCollectionResultModal from '../../taskTypes/installment_collection/InstallmentCollectionResultModal';
import type { TaskResultModalProps } from '../../components/tasks/types';
import { isHiddenOperationalTaskType } from '@golden-crm/shared';

type ResultModal = ComponentType<TaskResultModalProps>;

type TaskLabItem = {
  taskType: string;
  label: string;
  group: string;
  taskFamily: string;
  createModel: 'available' | 'missing' | 'external';
  resultModel: 'available' | 'missing';
  ResultModal?: ResultModal;
  resultKind?: 'standard' | 'emergency';
  createFields: string[];
  resultFields: string[];
  notes?: string;
};

const TASKS: TaskLabItem[] = [
  {
    taskType: 'device_demo',
    label: 'عرض جهاز',
    group: 'مهام عرض الجهاز',
    taskFamily: 'marketing',
    createModel: 'external',
    resultModel: 'available',
    ResultModal: DeviceDemoResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'فرع', 'موعد متوقع', 'أولوية', 'ملاحظات'],
    resultFields: ['قرار الزيارة', 'العروض المقدمة', 'رد الزبون على كل عرض', 'ملاحظات الإغلاق'],
    notes: 'الإنشاء الفعلي يأتي غالبا من مسار التيلماركتر وحجز الزيارة.',
  },
  {
    taskType: 'emergency_maintenance',
    label: 'صيانة طارئة',
    group: 'مهام الصيانة',
    taskFamily: 'emergency',
    createModel: 'external',
    resultModel: 'available',
    resultKind: 'emergency',
    createFields: ['زبون', 'جهاز مركب', 'مشكلة', 'أولوية', 'مصدر الطلب'],
    resultFields: ['تطبيق الصيانة', 'قطع الصيانة', 'التكلفة', 'الأقساط', 'إعادة جدولة أو إلغاء'],
    notes: 'الإنشاء الطبيعي من طلب صيانة أو بلاغ داخلي.',
  },
  {
    taskType: 'periodic_maintenance',
    label: 'صيانة دورية',
    group: 'مهام الصيانة',
    taskFamily: 'maintenance',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['زبون', 'جهاز', 'تاريخ دوري', 'نوع الصيانة'],
    resultFields: ['حالة الجهاز', 'الأجزاء المستبدلة', 'الدفعات إن وجدت', 'موعد الصيانة التالي'],
    notes: 'غير واضح إذا سيستخدم مودل الصيانة الطارئة نفسه أو مودل أخف.',
  },
  {
    taskType: 'installment_collection',
    label: 'تحصيل قسط',
    group: 'مهام تسديد الذمم',
    taskFamily: 'collection',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: InstallmentCollectionResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'قسط', 'المبلغ المتوقع', 'تاريخ الاستحقاق'],
    resultFields: ['مدفوع كامل', 'مدفوع جزئي', 'إعادة جدولة', 'رفض الدفع', 'طريقة الدفع'],
  },
  {
    taskType: 'maintenance_collection',
    label: 'تحصيل صيانة',
    group: 'مهام تسديد الذمم',
    taskFamily: 'collection',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['زبون', 'فاتورة صيانة', 'المبلغ المتوقع', 'سبب التحصيل'],
    resultFields: ['المبلغ المدفوع', 'طريقة الدفع', 'سبب عدم الدفع', 'موعد متابعة'],
    notes: 'قد يكفي توسيع مودل تحصيل الأقساط ليقبل مصدر ذمة مختلف.',
  },
  {
    taskType: 'device_repair',
    label: 'إصلاح جهاز',
    group: 'خدمات ما بعد البيع',
    taskFamily: 'service',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['زبون', 'جهاز', 'مشكلة', 'أولوية', 'قطع متوقعة'],
    resultFields: ['تم الإصلاح', 'لم يتم الإصلاح', 'قطع مستخدمة', 'تكلفة', 'متابعة مطلوبة'],
  },
  {
    taskType: 'device_checkup',
    label: 'تشييك جهاز',
    group: 'خدمات ما بعد البيع',
    taskFamily: 'service',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceCheckupResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز عند الزبون', 'تاريخ المهمة', 'أولوية', 'ملاحظات'],
    resultFields: ['تسجيل الحالة الفنية للجهاز فقط'],
    notes: 'تشييك الجهاز لا يغير حالة الجهاز ولا الحيازة، ويكتب قراءة diagnostic في سجل device_technical_states.',
  },
  {
    taskType: 'device_retrieval',
    label: 'سحب جهاز',
    group: 'خدمات ما بعد البيع',
    taskFamily: 'service',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceRetrievalResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز', 'سبب السحب', 'موقع السحب'],
    resultFields: ['تم السحب', 'تعذر السحب', 'حالة الجهاز عند السحب', 'موقع التخزين'],
  },
  {
    taskType: 'device_return',
    label: 'إرجاع جهاز',
    group: 'خدمات ما بعد البيع',
    taskFamily: 'service',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceReturnResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز', 'سبب الإرجاع', 'العقد المرتبط'],
    resultFields: ['تم الإرجاع', 'تعذر الإرجاع', 'الأثر المالي', 'حالة الجهاز'],
  },
  {
    taskType: 'device_transfer',
    label: 'نقل جهاز',
    group: 'خدمات ما بعد البيع',
    taskFamily: 'service',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceTransferResultModal,
    resultKind: 'standard',
    createFields: ['زبون حالي', 'زبون أو موقع جديد', 'جهاز', 'سبب النقل'],
    resultFields: ['تم النقل', 'تعذر النقل', 'موقع جديد', 'ملاحظات التركيب'],
  },
  {
    taskType: 'parts_sale',
    label: 'بيع قطع',
    group: 'خدمات ما بعد البيع',
    taskFamily: 'sales',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['زبون', 'قطع مطلوبة', 'أسعار', 'مخزون'],
    resultFields: ['تم البيع', 'لم يتم البيع', 'القطع المسلمة', 'المبلغ المقبوض'],
  },
  {
    taskType: 'gift_delivery',
    label: 'تسليم هدية',
    group: 'مهام الهدايا',
    taskFamily: 'delivery',
    createModel: 'external',
    resultModel: 'missing',
    createFields: ['زبون', 'هدية', 'سبب الاستحقاق', 'كمية', 'تاريخ تسليم'],
    resultFields: ['تم التسليم', 'تعذر التسليم', 'حالة الهدية', 'مستلم الهدية'],
    notes: 'الإنشاء الطبيعي من إدارة الهدايا.',
  },
  {
    taskType: 'golden_warranty',
    label: 'كفالة ذهبية',
    group: 'خدمات الكفالة',
    taskFamily: 'warranty',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['زبون', 'جهاز', 'نوع الكفالة', 'مدة', 'قيمة'],
    resultFields: ['تم التفعيل', 'رفض الزبون', 'دفعات الكفالة', 'تاريخ بداية ونهاية'],
  },
  {
    taskType: 'golden_warranty_offer',
    label: 'عرض كفالة ذهبية',
    group: 'خدمات الكفالة',
    taskFamily: 'warranty',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: GoldenWarrantyOfferModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز أو عدة أجهزة', 'عرض', 'موعد متابعة'],
    resultFields: ['قبول العرض', 'رفض العرض', 'طلب مهلة', 'دفعات مبدئية'],
  },
  {
    taskType: 'golden_warranty_card_delivery',
    label: 'تسليم كرت كفالة',
    group: 'خدمات الكفالة',
    taskFamily: 'warranty',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: GoldenWarrantyCardDeliveryModal,
    resultKind: 'standard',
    createFields: ['زبون', 'كفالة', 'جهاز', 'موعد تسليم'],
    resultFields: ['تم التسليم', 'تعذر التسليم', 'ملاحظات المستلم'],
  },
  {
    taskType: 'warranty_reactivation',
    label: 'إعادة تفعيل كفالة',
    group: 'خدمات الكفالة',
    taskFamily: 'warranty',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['كفالة', 'سبب الإيقاف', 'شرط إعادة التفعيل'],
    resultFields: ['تمت إعادة التفعيل', 'رفض', 'دفعة مطلوبة', 'تاريخ جديد'],
  },
  {
    taskType: 'warranty_cancellation',
    label: 'إلغاء كفالة',
    group: 'خدمات الكفالة',
    taskFamily: 'warranty',
    createModel: 'missing',
    resultModel: 'missing',
    createFields: ['كفالة', 'سبب الإلغاء', 'أثر مالي'],
    resultFields: ['تم الإلغاء', 'رفض الإلغاء', 'مبلغ مسترد', 'ملاحظات'],
  },
  {
    taskType: 'device_delivery',
    label: 'تسليم جهاز',
    group: 'مهام ما بعد العقد',
    taskFamily: 'delivery',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceDeliveryResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'عقد', 'جهاز', 'عنوان التسليم'],
    resultFields: ['تم التسليم', 'الزبون غير متوفر', 'عنوان خاطئ', 'رفض التسليم'],
  },
  {
    taskType: 'device_installation',
    label: 'تركيب جهاز',
    group: 'مهام ما بعد العقد',
    taskFamily: 'delivery',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceInstallationResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز مسلم', 'موقع التركيب', 'موعد'],
    resultFields: ['تم التركيب', 'لم يكتمل', 'رفض التركيب', 'قطع مستخدمة', 'عنوان نهائي'],
  },
  {
    taskType: 'device_activation',
    label: 'تشغيل جهاز',
    group: 'مهام ما بعد العقد',
    taskFamily: 'delivery',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceActivationResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز مركب', 'موعد تشغيل', 'أولوية'],
    resultFields: ['تم التشغيل', 'فشل التشغيل', 'مشكلة بالجهاز', 'قراءات فنية'],
  },
  {
    taskType: 'device_disconnection',
    label: 'فك جهاز',
    group: 'مهام ما بعد العقد',
    taskFamily: 'delivery',
    createModel: 'available',
    resultModel: 'available',
    ResultModal: DeviceDisconnectionResultModal,
    resultKind: 'standard',
    createFields: ['زبون', 'جهاز مركب', 'سبب الفك', 'موعد'],
    resultFields: ['تم الفك', 'تعذر الفك', 'سبب التعذر', 'حالة الجهاز بعد الفك'],
  },
];

const TASK_OVERRIDES: Record<string, Partial<TaskLabItem>> = {
  device_retrieval: {
    label: 'سحب جهاز',
    createFields: ['زبون', 'جهاز مفكوك', 'غرض السحب', 'فرع الخدمة', 'تاريخ المهمة', 'أولوية'],
    resultFields: ['تم السحب', 'إعادة الجدولة', 'رفض السحب', 'تأكيد الزبون', 'ملاحظات فنية'],
    notes: 'السحب مسموح فقط بعد فك ناجح وحالة out_of_service. غرض maintenance ينقل الجهاز إلى in_workshop، وغرض replacement يجعله retrieved.',
  },
  device_return: {
    label: 'إرجاع جهاز',
    createFields: ['زبون', 'جهاز داخل الورشة', 'تاريخ المهمة', 'أولوية', 'ملاحظات'],
    resultFields: ['تم الإرجاع', 'إعادة الجدولة', 'رفض الإرجاع', 'تأكيد الزبون', 'ملاحظات فنية'],
    notes: 'الإرجاع حصراً بعد سحب صيانة ناجح وحالة in_workshop، ويعيد الجهاز إلى عنوان التركيب السابق كـ delivered.',
  },
  device_transfer: {
    label: 'نقل جهاز',
    createFields: ['زبون', 'جهاز عند الزبون', 'نوع النقل', 'زبون جديد عند نقل الملكية', 'حي العنوان المبدئي', 'العنوان التفصيلي', 'إحداثيات اختيارية'],
    resultFields: ['تم النقل', 'إعادة الجدولة', 'رفض النقل', 'تأكيد الزبون', 'تأكيد الزبون الجديد عند نقل الملكية', 'ملاحظات فنية'],
    notes: 'النقل لا يركب ولا يشغل الجهاز. عند النقل لزبون آخر يتم تحديث سجل الحيازة وملكية الجهاز، أما نقل العنوان لنفس الزبون فلا يغير الحيازة.',
  },
};

for (const item of TASKS) {
  Object.assign(item, TASK_OVERRIDES[item.taskType]);
}

const VISIBLE_TASKS = TASKS.filter((item) => !isHiddenOperationalTaskType(item.taskType));

function makeMockTask(item: TaskLabItem) {
  const taskId = 9000 + VISIBLE_TASKS.findIndex((task) => task.taskType === item.taskType);
  return {
    id: taskId,
    taskType: item.taskType,
    task_type: item.taskType,
    taskFamily: item.taskFamily,
    task_family: item.taskFamily,
    status: 'in_execution',
    taskStatus: 'in_execution',
    clientId: 101,
    client_id: 101,
    clientName: 'زبون تجريبي',
    customerName: 'زبون تجريبي',
    contractId: 501,
    contract_id: 501,
    deviceId: 701,
    device_id: 701,
    installedDeviceId: 701,
    installed_device_id: 701,
    expectedAmountSyp: 250000,
    remainingBalance: 250000,
    activeVisit: {
      id: 8001,
      visitTaskId: 8101,
      status: 'ended',
      scheduledDate: new Date().toISOString().slice(0, 10),
      scheduledTime: '10:00',
    },
    clientSnapshot: {
      name: 'زبون تجريبي',
      mobile: '0999999999',
      address: {
        governorate: 'دمشق',
        district: 'المزة',
        neighborhood: 'حي تجريبي',
      },
    },
    contractSnapshot: {
      contractNumber: 'TEST-001',
      deviceModelName: 'Golden Demo',
    },
    offers: [
      {
        id: 1,
        deviceName: 'فلتر تجريبي',
        cashPrice: 1000000,
        installmentPrice: 1200000,
        customerResponse: 'pending',
      },
    ],
    preOffers: [
      {
        id: 1,
        deviceName: 'فلتر تجريبي',
        cashPrice: 1000000,
        installmentPrice: 1200000,
        customerResponse: 'pending',
      },
    ],
  };
}

function StatusBadge({ value }: { value: 'available' | 'missing' | 'external' }) {
  const meta = {
    available: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    missing: 'border-rose-200 bg-rose-50 text-rose-700',
    external: 'border-amber-200 bg-amber-50 text-amber-700',
  }[value];
  const label = {
    available: 'موجود',
    missing: 'ناقص',
    external: 'بمسار خارجي',
  }[value];
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${meta}`}>{label}</span>;
}

function CreatePreviewModal({ item, onClose }: { item: TaskLabItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" dir="rtl">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-800">مودل إنشاء: {item.label}</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">{item.taskType}</p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </header>
        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-black text-slate-700">حالة مودل الإنشاء</span>
              <StatusBadge value={item.createModel} />
            </div>
            {item.notes && <p className="text-sm text-slate-500">{item.notes}</p>}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-black text-slate-700">الحقول المتوقعة</h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {item.createFields.map((field) => (
                <div key={field} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {field}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
            هذا زر معاينة فقط. لا ينشئ بيانات ولا يحتاج seed.
          </div>
        </div>
      </div>
    </div>
  );
}

function MissingResultModal({ item, onClose }: { item: TaskLabItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" dir="rtl">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-800">مودل نتيجة ناقص: {item.label}</h2>
            <p className="mt-1 font-mono text-xs text-slate-400">{item.taskType}</p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </header>
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>لا يوجد مودل نتيجة موصول لهذا النوع حالياً.</span>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-black text-slate-700">الحقول التي غالباً نحتاجها</h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {item.resultFields.map((field) => (
                <div key={field} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {field}
                </div>
              ))}
            </div>
          </div>
          {item.notes && <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">{item.notes}</p>}
        </div>
      </div>
    </div>
  );
}

export default function TaskEvaluationLab() {
  const [createPreview, setCreatePreview] = useState<TaskLabItem | null>(null);
  const [resultPreview, setResultPreview] = useState<TaskLabItem | null>(null);

  const grouped = useMemo(() => {
    return VISIBLE_TASKS.reduce<Record<string, TaskLabItem[]>>((acc, item) => {
      acc[item.group] = acc[item.group] ?? [];
      acc[item.group].push(item);
      return acc;
    }, {});
  }, []);

  const resultTask = resultPreview ? makeMockTask(resultPreview) : null;
  const ActiveResultModal = resultPreview?.ResultModal;

  return (
    <div className="space-y-6 p-6" dir="rtl">
      <PageHeader
        title="مختبر تقييم مودلات المهام"
        subtitle="صفحة مؤقتة للمعاينة فقط: لا تنشئ بيانات، لا تقرأ من الباك، وتستخدم بيانات وهمية لفتح مودلات النتائج."
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500 text-white shadow-sm">
            <Beaker className="h-5 w-5" />
          </div>
        }
      />

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        زر الإنشاء يعرض الحقول المتوقعة فقط. زر تسجيل النتيجة يفتح المودل الحقيقي إذا كان موجوداً، أو يوضح الحقول الناقصة إذا لم يكن موجوداً.
      </div>

      {Object.entries(grouped).map(([group, items]) => (
        <section key={group} className="space-y-3">
          <h2 className="text-lg font-black text-slate-800">{group}</h2>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {items.map((item) => (
              <article key={item.taskType} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-slate-800">{item.label}</h3>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-600">{item.taskType}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">الإنشاء</span>
                      <StatusBadge value={item.createModel} />
                      <span className="text-xs font-bold text-slate-500">النتيجة</span>
                      <StatusBadge value={item.resultModel === 'available' ? 'available' : 'missing'} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {item.resultFields.slice(0, 4).map((field) => (
                        <span key={field} className="rounded-full bg-slate-50 px-2 py-1 text-xs text-slate-500">
                          {field}
                        </span>
                      ))}
                    </div>
                    {item.notes && <p className="mt-2 text-xs text-slate-400">{item.notes}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" icon={FilePlus2} onClick={() => setCreatePreview(item)}>
                      إنشاء
                    </Button>
                    <Button size="sm" variant="secondary" icon={item.resultModel === 'available' ? ClipboardCheck : Eye} onClick={() => setResultPreview(item)}>
                      تسجيل النتيجة
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {createPreview && <CreatePreviewModal item={createPreview} onClose={() => setCreatePreview(null)} />}

      {resultPreview && resultPreview.resultModel === 'missing' && (
        <MissingResultModal item={resultPreview} onClose={() => setResultPreview(null)} />
      )}

      {resultPreview && resultTask && resultPreview.resultKind === 'emergency' && (
        <EmergencyResultModal
          taskId={Number(resultTask.id)}
          visitTaskId={Number(resultTask.activeVisit.visitTaskId)}
          visitId={Number(resultTask.activeVisit.id)}
          contractId={resultTask.contractId}
          onClose={() => setResultPreview(null)}
          onSaved={() => setResultPreview(null)}
        />
      )}

      {resultPreview && resultTask && resultPreview.resultKind === 'standard' && ActiveResultModal && (
        <ActiveResultModal
          visitId={Number(resultTask.activeVisit.id)}
          taskId={Number(resultTask.activeVisit.visitTaskId)}
          task={resultTask}
          preOffers={resultTask.preOffers}
          onClose={() => setResultPreview(null)}
          onSaved={() => setResultPreview(null)}
        />
      )}
    </div>
  );
}
