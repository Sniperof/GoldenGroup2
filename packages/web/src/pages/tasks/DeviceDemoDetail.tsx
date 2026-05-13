import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Monitor, Loader2, ChevronRight, AlertCircle,
  UserRound, Phone, MapPin, Users, Wrench,
  FileText, Clock, Tag, Activity, Send, Calendar,
  PhoneCall, MessageSquare, CheckCircle2, RotateCcw, ShoppingCart,
} from 'lucide-react';
import { api } from '../../lib/api';
import ClientCardPopup from '../../components/ClientCardPopup';
import { OPEN_TASK_STATUS_LABELS } from '@golden-crm/shared';

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border border-sky-200',
  in_contact_list: 'bg-blue-50 text-blue-700 border border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  in_visit: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  completed: 'bg-green-50 text-green-700 border border-green-100',
  cancelled: 'bg-slate-200 text-slate-600 border border-slate-300',
  needs_reschedule: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

type DetailTabKey = 'overview' | 'client' | 'offer' | 'communication' | 'result';

const TAB_LABELS: Record<DetailTabKey, string> = {
  overview: 'نظرة عامة',
  client: 'بيانات الزبون',
  offer: 'تفاصيل العرض',
  communication: 'التواصل والمتابعة',
  result: 'النتيجة',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'يدوي',
  system: 'تلقائي',
  telemarketing: 'يدوي',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change: 'تغيير الحالة',
  note_added: 'إضافة ملاحظة',
  needs_reschedule: 'تحتاج إعادة جدولة',
  assigned: 'إسناد',
  reassigned: 'نقل المهمة',
  call_made: 'مكالمة',
  priority_changed: 'تغيير الأولوية',
  team_assigned: 'تعيين الفريق',
  offer_presented: 'تقديم عرض',
  customer_response: 'رد الزبون',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  status_change: 'bg-blue-100 text-blue-700',
  note_added: 'bg-slate-100 text-slate-600',
  needs_reschedule: 'bg-amber-100 text-amber-700',
  assigned: 'bg-emerald-100 text-emerald-700',
  reassigned: 'bg-indigo-100 text-indigo-700',
  call_made: 'bg-sky-100 text-sky-700',
  priority_changed: 'bg-rose-100 text-rose-700',
  team_assigned: 'bg-purple-100 text-purple-700',
  offer_presented: 'bg-violet-100 text-violet-700',
  customer_response: 'bg-teal-100 text-teal-700',
};

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('ar-SY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-SY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatMoney(value: any, currency: string | undefined) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '—';
  const formatted = numberValue.toLocaleString('ar-SY');
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatCreationSource(source: string | null | undefined) {
  if (!source) return '—';
  if (source === 'system') return 'تلقائي';
  if (source === 'manual' || source === 'telemarketing') return 'يدوي';
  return SOURCE_LABELS[source] ?? source;
}

function getEventTypeLabel(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

function getEventTypeColor(eventType: string) {
  return EVENT_TYPE_COLORS[eventType] ?? 'bg-slate-100 text-slate-600';
}

function getOutcomeLabel(outcome: string | null | undefined) {
  if (!outcome) return '—';
  return OUTCOME_LABELS[outcome] ?? outcome;
}

const OFFER_TYPE_LABELS: Record<string, string> = {
  cash: 'كاش',
  installment: 'تقسيط',
};

const CUSTOMER_RESPONSE_LABELS: Record<string, { label: string; className: string }> = {
  accepted: { label: 'تم البيع', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  rejected: { label: 'مرفوض', className: 'bg-rose-50 text-rose-700 border-rose-100' },
  extension_requested: { label: 'طلب مهلة', className: 'bg-amber-50 text-amber-700 border-amber-100' },
};

const NO_CLOSING_REASON_LABELS: Record<string, string> = {
  '': 'بدون سبب',
  not_closed: 'لم يتم التسكير',
  follow_up: 'متابعة لاحقة',
  customer_busy: 'العميل مشغول',
  price_issue: 'سبب سعري',
  other: 'أخرى',
};

const CALL_TYPE_LABELS: Record<string, string> = {
  inbound: 'واردة',
  outbound: 'صادرة',
  follow_up: 'متابعة',
  missed: 'فائتة',
};

const CALL_OUTCOME_LABELS: Record<string, string> = {
  answered: 'تم الرد',
  no_answer: 'لم يرد',
  busy: 'مشغول',
  callback: 'طلب معاودة الاتصال',
  interested: 'مهتم',
  not_interested: 'غير مهتم',
};

function getOfferTypeLabel(offerType: string | null | undefined) {
  if (!offerType) return '—';
  return OFFER_TYPE_LABELS[offerType] ?? offerType;
}

function getCustomerResponseMeta(value: string | null | undefined) {
  if (!value) return { label: 'بانتظار الرد', className: 'bg-slate-50 text-slate-600 border-slate-100' };
  return CUSTOMER_RESPONSE_LABELS[value] ?? { label: value, className: 'bg-slate-50 text-slate-600 border-slate-100' };
}

function getNoClosingReasonLabel(value: string | null | undefined) {
  if (value === null || value === undefined) return '—';
  return NO_CLOSING_REASON_LABELS[value] ?? value;
}

function getClosingStateMeta(offer: any) {
  if (offer?.closedByEmployeeName) {
    return {
      label: 'مغلق',
      detail: `بواسطة ${offer.closedByEmployeeName}`,
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };
  }
  if (offer?.closedByEmployeeId) {
    return {
      label: 'مغلق',
      detail: `بواسطة موظف #${offer.closedByEmployeeId}`,
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    };
  }
  if (offer?.noClosingReason) {
    return {
      label: 'غير مغلق',
      detail: getNoClosingReasonLabel(offer.noClosingReason),
      className: 'bg-amber-50 text-amber-700 border-amber-100',
    };
  }
  return {
    label: 'بانتظار الإغلاق',
    detail: '—',
    className: 'bg-slate-50 text-slate-600 border-slate-100',
  };
}

function getDeviceLabel(offer: any) {
  return offer?.deviceName || `جهاز #${offer?.deviceModelId ?? '—'}`;
}

function normalizePreOfferRow(offer: any) {
  const responseMeta = getCustomerResponseMeta(offer?.customerResponse);
  const closingMeta = getClosingStateMeta(offer);
  return {
    id: offer?.id,
    deviceName: getDeviceLabel(offer),
    offerTypeLabel: getOfferTypeLabel(offer?.offerType),
    quantityLabel: offer?.quantity ?? '—',
    amountLabel: formatMoney(offer?.totalAmount, offer?.currency),
    discountLabel: Number(offer?.discountPercentage || 0) > 0 ? `${offer.discountPercentage}%` : '—',
    responseLabel: responseMeta.label,
    responseClassName: responseMeta.className,
    closingLabel: closingMeta.label,
    closingDetail: closingMeta.detail,
    closingClassName: closingMeta.className,
  };
}

function getCallTypeLabel(value: string | null | undefined) {
  if (!value) return '—';
  return CALL_TYPE_LABELS[value] ?? value;
}

function getCallOutcomeLabel(value: string | null | undefined) {
  if (!value) return '—';
  return CALL_OUTCOME_LABELS[value] ?? value;
}

function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-slate-500">
      <Icon className="w-8 h-8 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-600">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function Card({ title, icon: Icon, children, className = '' }: { title: string; icon: any; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}>
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5 gap-4">
      <span className="text-xs text-slate-400 font-bold shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{value === null || value === undefined || value === '' ? '—' : value}</span>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${active
        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span>{label}</span>
    </button>
  );
}

function TabAlert({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
      <p className="font-bold mb-1 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {title}
      </p>
      <ul className="list-disc pr-5 space-y-1">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const OUTCOME_LABELS: Record<string, string> = {
  offer_presented: 'تم تقديم العرض',
  device_sold: 'تم البيع',
  needs_reschedule: 'تحتاج إعادة جدولة',
  cancelled: 'ملغاة',
};

function TaskResultSection({ task, preOffers = [] }: { task: any; preOffers?: any[] }) {
  const hasVisitOffers = Array.isArray(task.offers) && task.offers.length > 0;
  const offersToShow: any[] = hasVisitOffers ? task.offers : preOffers;
  const resultLabel = task.outcome
    ? getOutcomeLabel(task.outcome)
    : task.result ?? null;
  const normalizedOffers = offersToShow.map(normalizePreOfferRow);

  return (
    <Card title="نتيجة المهمة" icon={CheckCircle2}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5 mb-4">
        <InfoLine label="النتيجة" value={resultLabel || 'غير مسجلة بعد'} />
        <InfoLine label="الحالة" value={OPEN_TASK_STATUS_LABELS[task.status as keyof typeof OPEN_TASK_STATUS_LABELS] ?? task.status ?? '—'} />
        <InfoLine label="تاريخ الإتمام" value={task.completedAt ? formatDateTime(task.completedAt) : '—'} />
        <InfoLine label="سبب عدم الإغلاق" value={task.noClosingReason ? getNoClosingReasonLabel(task.noClosingReason) : '—'} />
        <div className="md:col-span-2">
          <InfoLine label="ملاحظات" value={task.resultNotes || '—'} />
        </div>
      </div>

      {offersToShow.length > 0 ? (
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-bold text-slate-500 mb-2">
            {hasVisitOffers ? 'العروض المقدمة' : 'العروض المسبقة'} ({offersToShow.length})
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-right border-separate border-spacing-0">
              <thead>
                <tr className="text-xs font-bold text-slate-500">
                  <th className="px-3 py-2 border-b border-slate-200">#</th>
                  <th className="px-3 py-2 border-b border-slate-200">الجهاز</th>
                  <th className="px-3 py-2 border-b border-slate-200">نوع العرض</th>
                  <th className="px-3 py-2 border-b border-slate-200">الكمية</th>
                  <th className="px-3 py-2 border-b border-slate-200">الإجمالي</th>
                  <th className="px-3 py-2 border-b border-slate-200">الحسم</th>
                  <th className="px-3 py-2 border-b border-slate-200">رد الزبون</th>
                  <th className="px-3 py-2 border-b border-slate-200">الإغلاق</th>
                </tr>
              </thead>
              <tbody>
                {normalizedOffers.map((offer: any, i: number) => (
                  <tr key={offer.id ?? i} className="text-sm text-slate-700">
                    <td className="px-3 py-3 border-b border-slate-100">{i + 1}</td>
                    <td className="px-3 py-3 border-b border-slate-100 font-medium">{offer.deviceName}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.offerTypeLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.quantityLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.amountLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">{offer.discountLabel}</td>
                    <td className="px-3 py-3 border-b border-slate-100">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${offer.responseClassName}`}>
                        {offer.responseLabel}
                      </span>
                    </td>
                    <td className="px-3 py-3 border-b border-slate-100">
                      <div className={`inline-flex flex-col gap-0.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${offer.closingClassName}`}>
                        <span>{offer.closingLabel}</span>
                        <span className="font-normal opacity-80">{offer.closingDetail}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={ShoppingCart}
          title="لا توجد عروض مرتبطة بعد"
          description="سيظهر هنا ملخص العروض التي أُثبتت للمهمة، سواء من الزيارة أو من العروض المسبقة."
        />
      )}
    </Card>
  );
}

export default function DeviceDemoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = Number(id);

  const [task, setTask] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [preOffers, setPreOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientPopupId, setClientPopupId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabKey>('overview');
  const [priorityDraft, setPriorityDraft] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [priorityError, setPriorityError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [noteError, setNoteError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [taskData, activityData, devicesData, callsData] = await Promise.all([
          api.openTasks.get(taskId),
          api.openTasks.getActivity(taskId).catch(() => [] as any[]),
          api.openTasks.getDevices(taskId).catch(() => [] as any[]),
          api.openTasks.getCalls(taskId).catch(() => [] as any[]),
        ]);
        if (!active) return;
        const taskPreOffers = taskData?.preOffers || taskData?.pre_offers || [];
        setTask(taskData);
        setActivity(activityData);
        setDevices(devicesData);
        setCalls(callsData);
        setPreOffers(taskPreOffers);
        setPriorityDraft(taskData?.priority ?? '');
      } catch (err: any) {
        if (!active) return;
        setError(err.message || 'فشل في تحميل بيانات المهمة');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [taskId]);

  const handleSubmitNote = async () => {
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    setNoteError('');
    try {
      const newEntry = await api.openTasks.addActivity(taskId, { eventType: 'note_added', newValue: noteText.trim() });
      setActivity(prev => [newEntry, ...prev]);
      setNoteText('');
    } catch (err: any) {
      setNoteError(err.message || 'فشل في إضافة الملاحظة');
    } finally {
      setSubmittingNote(false);
    }
  };

  const notes = activity.filter((a) => a.eventType === 'note_added');

  const handlePriorityChange = async (next: '' | 'high' | 'medium' | 'low') => {
    if (!task?.id) return;
    const previous = priorityDraft;
    setPriorityDraft(next);
    setPrioritySaving(true);
    setPriorityError('');
    try {
      const updated = await api.openTasks.update(task.id, { priority: next || null });
      setTask(updated);
      setPriorityDraft(updated?.priority ?? next);
    } catch (err: any) {
      setPriorityDraft(previous);
      setPriorityError(err.message || 'فشل في تحديث الأولوية');
    } finally {
      setPrioritySaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <p className="text-sm font-medium">جارٍ تحميل بيانات المهمة...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500" dir="rtl">
        <AlertCircle className="w-10 h-10 text-rose-400 mb-3" />
        <p className="text-sm font-medium">{error || 'المهمة غير موجودة'}</p>
        <button
          onClick={() => navigate('/tasks/device-demo')}
          className="mt-4 text-sky-600 font-bold text-sm flex items-center gap-2 hover:underline"
        >
          <ChevronRight className="w-4 h-4" />
          العودة لقائمة عروض الأجهزة
        </button>
      </div>
    );
  }

  const statusLabel = OPEN_TASK_STATUS_LABELS[task.status as keyof typeof OPEN_TASK_STATUS_LABELS] ?? task.status;
  const statusColor = TASK_STATUS_COLORS[task.status] ?? 'bg-slate-100 text-slate-600 border border-slate-200';
  const client = task.clientSnapshot;
  const team = task.teamSnapshot;
  const creationSourceLabel = formatCreationSource(task.source);
  const visitDate = task.scheduledDate || task.visitDate || null;
  const visitTime = task.scheduledTime || task.visitTime || null;
  const preOfferRows = preOffers || [];
  const normalizedPreOfferRows = preOfferRows.map(normalizePreOfferRow);
  const activityCount = activity.length;
  const callCount = calls.length;
  const noteCount = notes.length;
  const deviceCount = devices.length;

  const overviewIssues: string[] = [];
  if (!task.createdByName) overviewIssues.push('منشئ المهمة غير موجود أو ناقص');
  if (!task.source) overviewIssues.push('مصدر الإنشاء غير محدد');
  if (!task.dueDate) overviewIssues.push('تاريخ الاستحقاق غير محدد');
  if (!visitDate && !visitTime && !task.marketingVisitId) overviewIssues.push('تفاصيل الزيارة غير مرتبطة بعد');
  if (!task.priority) overviewIssues.push('الأولوية غير محددة');

  const clientIssues: string[] = [];
  if (!client) clientIssues.push('بيانات الزبون غير متوفرة');
  if (!client?.mobile && !task.clientMobile) clientIssues.push('رقم الهاتف غير متوفر');
  if (!client?.address?.detailed && !task.clientDetailedAddress) clientIssues.push('العنوان التفصيلي غير متوفر');

  const offerIssues: string[] = [];
  if (!team) offerIssues.push('الفريق المكلف غير معيّن');
  if (preOfferRows.length === 0) offerIssues.push('لا توجد عروض مسبقة مسجلة');

  const communicationIssues: string[] = [];
  if (calls.length === 0) communicationIssues.push('لا توجد مكالمات تيلماركتر');
  if (activity.length === 0) communicationIssues.push('لا يوجد سجل نشاط بعد');
  if (notes.length === 0) communicationIssues.push('لا توجد ملاحظات بعد');

  const hasResult = Boolean(task.result || task.outcome || preOfferRows.length > 0 || (Array.isArray(task.offers) && task.offers.length > 0));

  return (
    <div className="h-full flex flex-col bg-slate-50/50 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => navigate('/tasks/device-demo')}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
              عروض الأجهزة
            </button>
            <span className="text-slate-300">/</span>
            <div className="flex items-center gap-2 flex-wrap">
              <Monitor className="w-5 h-5 text-indigo-500" />
              <span className="text-sm font-bold text-slate-800">تفاصيل مهمة عرض الجهاز #{task.id}</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => task.clientId && setClientPopupId(task.clientId)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors"
            >
              <UserRound className="w-3.5 h-3.5" />
              {client?.name || task.clientName || 'الزبون'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100">
            <Tag className="w-3 h-3" />
            عرض جهاز
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {formatDateTime(task.createdAt)}
          </span>
          {task.branchName && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3 h-3" />
              {task.branchName}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap gap-2">
          <TabButton active={activeTab === 'overview'} label={TAB_LABELS.overview} onClick={() => setActiveTab('overview')} />
          <TabButton active={activeTab === 'client'} label={TAB_LABELS.client} onClick={() => setActiveTab('client')} />
          <TabButton active={activeTab === 'offer'} label={TAB_LABELS.offer} onClick={() => setActiveTab('offer')} />
          <TabButton active={activeTab === 'communication'} label={TAB_LABELS.communication} onClick={() => setActiveTab('communication')} />
          <TabButton active={activeTab === 'result'} label={TAB_LABELS.result} onClick={() => setActiveTab('result')} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
          {activeTab === 'overview' && (
            <>
              <TabAlert title="ملاحظات على بيانات النظرة العامة" items={overviewIssues} />
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <Card title="ملخص المهمة" icon={Activity}>
                  <div className="space-y-1.5">
                    <InfoLine label="الحالة" value={<span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${statusColor}`}>{statusLabel}</span>} />
                    <div className="flex items-start justify-between py-1.5 gap-4">
                      <span className="text-xs text-slate-400 font-bold shrink-0">الأولوية</span>
                      <div className="flex flex-col items-end gap-1">
                        <select
                          value={priorityDraft}
                          onChange={(event) => handlePriorityChange(event.target.value as '' | 'high' | 'medium' | 'low')}
                          disabled={prioritySaving}
                          className={`min-w-36 rounded-lg border px-2.5 py-1.5 text-xs font-bold outline-none transition-colors ${priorityDraft ? (PRIORITY_COLORS[priorityDraft] ?? 'bg-slate-100 text-slate-600 border-slate-200') : 'bg-white text-slate-500 border-slate-200'}`}
                        >
                          <option value="">غير محددة</option>
                          <option value="high">{PRIORITY_LABELS.high}</option>
                          <option value="medium">{PRIORITY_LABELS.medium}</option>
                          <option value="low">{PRIORITY_LABELS.low}</option>
                        </select>
                        {prioritySaving && <span className="text-[11px] text-slate-400">جارٍ الحفظ...</span>}
                        {priorityError && <span className="text-[11px] text-rose-600">{priorityError}</span>}
                      </div>
                    </div>
                    <InfoLine label="السبب" value={task.reason || '—'} />
                    <InfoLine label="النتيجة" value={task.outcome ? getOutcomeLabel(task.outcome) : task.result || '—'} />
                  </div>
                </Card>

                <Card title="الجدولة والزيارة" icon={Calendar}>
                  <div className="space-y-1.5">
                    <InfoLine label="تاريخ الاستحقاق" value={task.dueDate ? formatDate(task.dueDate) : '—'} />
                    <InfoLine label="تاريخ الزيارة" value={visitDate ? formatDate(visitDate) : '—'} />
                    <InfoLine label="وقت الزيارة" value={visitTime || '—'} />
                    <InfoLine label="الفرع" value={task.branchName || '—'} />
                  </div>
                </Card>

                <Card title="بيانات الإنشاء" icon={FileText}>
                  <div className="space-y-1.5">
                    <InfoLine label="تاريخ الإنشاء" value={formatDateTime(task.createdAt)} />
                    <InfoLine label="آخر تحديث" value={formatDateTime(task.updatedAt)} />
                    <InfoLine label="منشئ المهمة" value={task.createdByName || '—'} />
                    <InfoLine label="مصدر الإنشاء" value={creationSourceLabel} />
                  </div>
                </Card>

                <Card title="سجل سريع" icon={Clock}>
                  <div className="space-y-1.5">
                    <InfoLine label="الأجهزة المرتبطة" value={deviceCount} />
                    <InfoLine label="المكالمات" value={callCount} />
                    <InfoLine label="الأنشطة" value={activityCount} />
                    <InfoLine label="الملاحظات" value={noteCount} />
                  </div>
                </Card>
              </div>
            </>
          )}

          {activeTab === 'client' && (
            <>
              <TabAlert title="ملاحظات على بيانات الزبون" items={clientIssues} />
              <Card title="لقطة الزبون" icon={UserRound}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                  <InfoLine
                    label="الاسم"
                    value={
                      <button
                        onClick={() => task.clientId && setClientPopupId(task.clientId)}
                        className="font-bold text-slate-800 hover:text-sky-700 hover:underline transition-colors"
                      >
                        {client?.name || task.clientName || '—'}
                      </button>
                    }
                  />
                  <InfoLine
                    label="الهاتف"
                    value={
                      <span className="font-mono text-slate-600" dir="ltr">
                        {client?.mobile || task.clientMobile || '—'}
                      </span>
                    }
                  />
                  <InfoLine label="المحافظة" value={client?.address?.governorate || task.clientGovernorate || '—'} />
                  <InfoLine label="المنطقة" value={client?.address?.district || task.clientDistrict || '—'} />
                  <InfoLine label="الناحية" value={client?.address?.subArea || '—'} />
                  <InfoLine label="الحي" value={client?.address?.neighborhood || task.clientNeighborhood || '—'} />
                  <div className="md:col-span-2">
                    <InfoLine label="العنوان التفصيلي" value={client?.address?.detailed || task.clientDetailedAddress || '—'} />
                  </div>
                  {client?.contacts?.length > 0 && (
                    <div className="md:col-span-2 mt-2 space-y-2">
                      <p className="text-xs font-bold text-slate-400">أرقام التواصل</p>
                      <div className="flex flex-wrap gap-2">
                        {client.contacts.map((c: any, i: number) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700" dir="ltr">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {c.number}
                            {c.label && <span className="text-slate-400 font-sans">({c.label})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}

          {activeTab === 'offer' && (
            <>
              <TabAlert title="ملاحظات على تفاصيل العرض" items={offerIssues} />

              <Card title="الفريق المكلف" icon={Users}>
                {team ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      { key: 'supervisor', label: 'مشرف', icon: UserRound, name: team.supervisor?.name, bg: 'bg-indigo-50', text: 'text-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                      { key: 'technician', label: 'فني', icon: Wrench, name: team.technician?.name, bg: 'bg-sky-50', text: 'text-sky-500', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
                      { key: 'trainee', label: 'متدرب', icon: Users, name: team.trainee?.name, bg: 'bg-amber-50', text: 'text-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
                    ].filter((item) => item.name).map((item) => (
                      <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.bg}`}>
                            <item.icon className={`w-4 h-4 ${item.text}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-500">{item.label}</p>
                            <p className="text-sm font-semibold text-slate-800 truncate">{item.name}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${item.badge}`}>{item.label}</span>
                      </div>
                    ))}
                    {team.supervisor || team.technician || team.trainee ? null : (
                      <div className="md:col-span-3">
                        <EmptyState icon={Users} title="لا توجد أسماء داخل الفريق" description="الفريق مرتبط بالمهمة لكن أسماء الأدوار لم تُسجل بعد." />
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyState icon={Users} title="لم يتم تعيين فريق لهذه المهمة" description="عند تعيين الفريق ستظهر أسماء المشرف والفني والمتدرب هنا." />
                )}
              </Card>

              <Card title="العروض المسبقة" icon={ShoppingCart}>
                {normalizedPreOfferRows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-right border-separate border-spacing-0">
                      <thead>
                        <tr className="text-xs font-bold text-slate-500">
                          <th className="px-3 py-2 border-b border-slate-200">#</th>
                          <th className="px-3 py-2 border-b border-slate-200">الجهاز</th>
                          <th className="px-3 py-2 border-b border-slate-200">نوع العرض</th>
                          <th className="px-3 py-2 border-b border-slate-200">الكمية</th>
                          <th className="px-3 py-2 border-b border-slate-200">الإجمالي</th>
                          <th className="px-3 py-2 border-b border-slate-200">الحسم</th>
                          <th className="px-3 py-2 border-b border-slate-200">رد الزبون</th>
                          <th className="px-3 py-2 border-b border-slate-200">الإغلاق</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizedPreOfferRows.map((offer: any, index: number) => (
                          <tr key={offer.id || index} className="text-sm text-slate-700">
                            <td className="px-3 py-3 border-b border-slate-100">{index + 1}</td>
                            <td className="px-3 py-3 border-b border-slate-100 font-medium">{offer.deviceName}</td>
                            <td className="px-3 py-3 border-b border-slate-100">{offer.offerTypeLabel}</td>
                            <td className="px-3 py-3 border-b border-slate-100">{offer.quantityLabel}</td>
                            <td className="px-3 py-3 border-b border-slate-100">{offer.amountLabel}</td>
                            <td className="px-3 py-3 border-b border-slate-100">{offer.discountLabel}</td>
                            <td className="px-3 py-3 border-b border-slate-100">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${offer.responseClassName}`}>
                                {offer.responseLabel}
                              </span>
                            </td>
                            <td className="px-3 py-3 border-b border-slate-100">
                              <div className={`inline-flex flex-col gap-0.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${offer.closingClassName}`}>
                                <span>{offer.closingLabel}</span>
                                <span className="font-normal opacity-80">{offer.closingDetail}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={ShoppingCart} title="لا توجد عروض مسبقة مسجلة" description="ستظهر العروض المسبقة هنا مع نوع العرض، الحالة، وسبب الإغلاق بشكل منسق." />
                )}
              </Card>

            </>
          )}

          {activeTab === 'communication' && (
            <>
              <TabAlert title="ملاحظات على التواصل والمتابعة" items={communicationIssues} />

              <Card title="المكالمات" icon={PhoneCall}>
                {calls.length > 0 ? (
                  <div className="space-y-3">
                    {calls.map((call: any) => (
                      <div key={call.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-sm font-bold text-slate-700">{call.telemarketerName || '—'}</span>
                          <span className="text-xs text-slate-400">{formatDateTime(call.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">{getCallTypeLabel(call.callType)}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">{getCallOutcomeLabel(call.outcome)}</span>
                        </div>
                        {call.notes ? (
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">{call.notes}</p>
                        ) : (
                          <p className="text-xs text-slate-400">لا توجد ملاحظات للمكالمة</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={PhoneCall}
                    title="لا توجد مكالمات مرتبطة بهذه المهمة"
                    description="عند تسجيل مكالمات جديدة ستظهر هنا مع النوع والنتيجة والملاحظات إن وجدت."
                  />
                )}
              </Card>

              <Card title="السجل" icon={Activity}>
                {activity.length > 0 ? (
                  <div className="space-y-4">
                    {activity.map((entry: any) => (
                      <div key={entry.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                            {entry.eventType === 'note_added' && <MessageSquare className="w-3.5 h-3.5 text-slate-500" />}
                            {entry.eventType === 'status_change' && <RotateCcw className="w-3.5 h-3.5 text-blue-500" />}
                            {entry.eventType === 'call_made' && <PhoneCall className="w-3.5 h-3.5 text-sky-500" />}
                            {entry.eventType === 'team_assigned' && <Users className="w-3.5 h-3.5 text-purple-500" />}
                            {entry.eventType === 'assigned' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                            {entry.eventType === 'offer_presented' && <ShoppingCart className="w-3.5 h-3.5 text-violet-500" />}
                            {entry.eventType === 'customer_response' && <MessageSquare className="w-3.5 h-3.5 text-teal-500" />}
                            {!['note_added', 'status_change', 'call_made', 'team_assigned', 'assigned', 'offer_presented', 'customer_response'].includes(entry.eventType) && (
                              <Activity className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </div>
                          <div className="w-px flex-1 bg-slate-100 mt-1" />
                        </div>
                        <div className="pb-4 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${getEventTypeColor(entry.eventType)}`}>
                              {getEventTypeLabel(entry.eventType)}
                            </span>
                            <span className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
                          </div>
                          {entry.performedByName && (
                            <p className="text-xs text-slate-500 mb-1">
                              {entry.performedByName}
                              {entry.role && <span className="text-slate-400"> · {entry.role}</span>}
                            </p>
                          )}
                          {entry.eventType === 'status_change' && entry.oldValue && entry.newValue && (
                            <p className="text-xs text-slate-700">
                              <span className="line-through text-slate-400">{OPEN_TASK_STATUS_LABELS[entry.oldValue as keyof typeof OPEN_TASK_STATUS_LABELS] ?? entry.oldValue}</span>
                              {' → '}
                              <span className="font-bold">{OPEN_TASK_STATUS_LABELS[entry.newValue as keyof typeof OPEN_TASK_STATUS_LABELS] ?? entry.newValue}</span>
                            </p>
                          )}
                          {entry.eventType === 'note_added' && entry.newValue && (
                            <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-2 border border-slate-100 mt-1">{entry.newValue}</p>
                          )}
                          {entry.eventType === 'call_made' && (
                            <p className="text-xs text-slate-600">{entry.newValue || 'مكالمة مسجلة'}</p>
                          )}
                          {entry.reason && <p className="text-xs text-slate-500 mt-1">السبب: {entry.reason}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={Activity}
                    title="لا توجد أحداث مسجلة بعد"
                    description="ستظهر هنا تغييرات الحالة، الإسناد، تقديم العروض، والملاحظات بمجرد حفظها."
                  />
                )}
              </Card>

              <Card title="الملاحظات" icon={MessageSquare}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={3}
                      placeholder="أضف ملاحظة..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    />
                    {noteError && <p className="text-xs text-rose-600">{noteError}</p>}
                    <button
                      onClick={handleSubmitNote}
                      disabled={submittingNote || !noteText.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submittingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      إضافة الملاحظة
                    </button>
                  </div>

                  {notes.length > 0 ? (
                    <div className="border-t border-slate-100 pt-4 space-y-3">
                      {notes.map((note: any) => (
                        <div key={note.id} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-slate-700">
                              {note.performedByName || '—'}
                              {note.role && <span className="font-normal text-slate-400"> · {note.role}</span>}
                            </span>
                            <span className="text-xs text-slate-400">{formatDateTime(note.createdAt)}</span>
                          </div>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.newValue}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={MessageSquare}
                      title="لا توجد ملاحظات بعد"
                      description="اكتب الملاحظة الأولى لتظهر هنا مع اسم المنفذ وتاريخ الإضافة."
                    />
                  )}
                </div>
              </Card>
            </>
          )}

          {activeTab === 'result' && (
            <>
              <TabAlert title="ملاحظات على النتيجة" items={hasResult ? [] : ['لا توجد نتيجة مسجلة بعد']} />
              <Card title="ملخص النتيجة" icon={CheckCircle2}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                  <InfoLine label="النتيجة" value={task.outcome ? getOutcomeLabel(task.outcome) : task.result || 'غير مسجلة بعد'} />
                  <InfoLine label="الحالة" value={statusLabel} />
                  <InfoLine label="تاريخ الإتمام" value={task.completedAt ? formatDateTime(task.completedAt) : '—'} />
                  <InfoLine label="سبب عدم الإغلاق" value={task.noClosingReason ? getNoClosingReasonLabel(task.noClosingReason) : '—'} />
                  <div className="md:col-span-2">
                    <InfoLine label="ملاحظات النتيجة" value={task.resultNotes || '—'} />
                  </div>
                </div>
              </Card>
              <TaskResultSection task={task} preOffers={preOfferRows} />
            </>
          )}
        </div>
      </div>

      {clientPopupId !== null && (
        <ClientCardPopup
          clientId={clientPopupId}
          onClose={() => setClientPopupId(null)}
        />
      )}
    </div>
  );
}
