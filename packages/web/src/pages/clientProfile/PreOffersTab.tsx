// Read-only audit view of every device-demo pre-offer ever prepared for a
// customer, plus the outcome of the visit that presented each one. Helps
// planners decide what to propose next given prior reactions.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles, ExternalLink, BadgeDollarSign, Calendar, User, Tag, Plus } from 'lucide-react';

import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { OutcomeChip, type PreOfferOutcomeState } from '../../components/preOffers/OutcomeChip';
import DeviceOfferModal from '../../components/clients/DeviceOfferModal';
import StandaloneDeviceOffersModal from '../../components/clients/StandaloneDeviceOffersModal';
import type { Client } from '../../lib/types';
import Button from '../../components/ui/Button';

interface Props {
  client: Client;
}

interface Entry {
  sourceKind?: 'task' | 'standalone';
  preOfferId: number | null;
  customerPreOfferId?: number | null;
  openTaskId: number | null;
  taskStatus: string;
  taskCreatedAt: string | null;
  taskDueDate: string | null;
  deviceModelId: number | null;
  deviceModelName: string | null;
  offerType: 'cash' | 'installment' | string;
  currency: string;
  quantity: number;
  totalAmount: number | null;
  firstPaymentAmount: number | null;
  installmentMonths: number | null;
  discountPercentage: number | null;
  appliedDeviceDiscountId: number | null;
  closedByEmployeeId: number | null;
  closedByEmployeeName: string | null;
  noClosingReason: string | null;
  outcome: {
    state: PreOfferOutcomeState;
    visitTaskResultId: number | null;
    finalDecisionCode: string | null;
    closedAt: string | null;
    closedByEmployeeId: number | null;
    closedByEmployeeName: string | null;
    actualOfferAmount: number | null;
    contractId: number | null;
    contractNumber: string | null;
  };
}

interface Response {
  customerId: number;
  entries: Entry[];
  summary: {
    total: number;
    notPresentedYet: number;
    needsFollowUp: number;
    accepted: number;
    notChosen: number;
    rejected: number;
  };
}

// Match the look and feel of PurchaseHistoryTab / PartsStockTab.
function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
  } catch { return value; }
}

function fmtMoney(value?: number | null, currency = 'SYP') {
  if (value == null) return '—';
  return `${Number(value).toLocaleString('en-US')} ${currency}`;
}

// Filter chip definitions. "الكل" wraps the entire list.
// "بانتظار رد" sits between as a composite of the two sub-states.
type FilterKey = 'all' | 'not_presented_yet' | 'needs_follow_up' | 'accepted' | 'not_chosen' | 'rejected';
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all',                 label: 'الكل' },
  { key: 'not_presented_yet',   label: 'لم تُعرض بعد' },
  { key: 'needs_follow_up',     label: 'بانتظار متابعة' },
  { key: 'accepted',            label: 'مقبولة' },
  { key: 'not_chosen',          label: 'لم يُختر' },
  { key: 'rejected',            label: 'مرفوضة' },
];

export function PreOffersTab({ client }: Props) {
  const navigate = useNavigate();
  const hasPermission = useAuthStore(s => s.hasPermission);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [hasActiveTask, setHasActiveTask] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.customers.getPreOffers(client.id);
      setData(res as Response);
      const tasks = await api.openTasks.listByClient(client.id).catch(() => []);
      setHasActiveTask(tasks.some((task: any) => {
        const taskType = task.taskType ?? task.task_type ?? task.openTaskType;
        return taskType === 'device_demo' && !['completed', 'cancelled', 'closed'].includes(task.status);
      }));
    } catch (err) {
      console.error('[PreOffersTab] fetch failed:', err);
      setData(null);
      setHasActiveTask(false);
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data.entries;
    return data.entries.filter(e => e.outcome.state === filter);
  }, [data, filter]);

  const hasActiveDeviceDemo = useMemo(() => {
    if (hasActiveTask) return true;
    if (!data) return false;
    return data.entries.some(e => e.openTaskId && !['completed', 'cancelled', 'closed'].includes(e.taskStatus));
  }, [data, hasActiveTask]);

  const createButton = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" icon={Plus} onClick={() => setStandaloneOpen(true)}>
        إنشاء عروض أجهزة
      </Button>
      <Button
        icon={Plus}
        onClick={() => setCreateOpen(true)}
        disabled={hasActiveDeviceDemo}
        title={hasActiveDeviceDemo ? 'توجد مهمة عرض جهاز نشطة لهذا الزبون' : undefined}
      >
        إنشاء عرض جهاز
      </Button>
    </div>
  );

  const createModal = createOpen ? (
    <DeviceOfferModal
      isOpen={createOpen}
      onClose={() => setCreateOpen(false)}
      client={client}
      onCreated={(created) => {
        setCreateOpen(false);
        fetchData();
        if (created?.id) {
          navigate(hasPermission('tasks.demo.view')
            ? `/tasks/device-demo/${created.id}`
            : '/tasks/group/my-customers');
        }
      }}
    />
  ) : null;

  const standaloneModal = standaloneOpen ? (
    <StandaloneDeviceOffersModal
      isOpen={standaloneOpen}
      onClose={() => setStandaloneOpen(false)}
      client={client}
      onCreated={() => {
        setStandaloneOpen(false);
        fetchData();
      }}
    />
  ) : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-bold">جاري تحميل العروض المسبقة...</p>
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="space-y-4 max-w-7xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">العروض المسبقة</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">
              العروض المُحضَّرة قبل الزيارة ضمن مهام عرض جهاز، ونتيجة رد الزبون على كل عرض.
            </p>
          </div>
          {createButton}
        </header>
        <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center flex flex-col items-center justify-center shadow-sm">
          <Sparkles className="w-12 h-12 text-slate-300 mb-4" />
          <h4 className="text-base text-slate-600 font-black mb-2">لا توجد عروض مسبقة مسجلة</h4>
          <p className="text-xs text-slate-400 font-bold max-w-md">
            لم يُحضَّر أي عرض جهاز لهذا الزبون بعد. ستظهر العروض هنا فور إنشاء مهمة عرض جهاز عبر "عرض جهاز" في الإجراءات السريعة.
          </p>
        </div>
        {createModal}
        {standaloneModal}
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="space-y-4 max-w-7xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">العروض المسبقة</h3>
          <p className="text-xs text-slate-400 font-bold mt-1">
            العروض المُحضَّرة قبل الزيارة ضمن مهام عرض جهاز، ونتيجة رد الزبون على كل عرض.
          </p>
        </div>
        {createButton}
      </header>

      {/* Summary KPI cards — same visual language as PurchaseHistoryTab. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <SummaryCard icon={<Sparkles className="w-4 h-4" />} label="إجمالي العروض"  value={s.total}            color="sky" />
        <SummaryCard icon={<Calendar className="w-4 h-4" />} label="لم تُعرض بعد"   value={s.notPresentedYet}  color="slate" />
        <SummaryCard icon={<Calendar className="w-4 h-4" />} label="بانتظار متابعة" value={s.needsFollowUp}    color="amber" />
        <SummaryCard icon={<BadgeDollarSign className="w-4 h-4" />} label="مقبولة → عقد" value={s.accepted}    color="emerald" />
        <SummaryCard icon={<Tag className="w-4 h-4" />}     label="لم يُختر / مرفوض" value={s.notChosen + s.rejected} color="rose" />
      </div>
      {createModal}
      {standaloneModal}

      {/* Filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filter === f.key
                ? 'bg-sky-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Main table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-black sticky top-0">
              <tr>
                <th className="text-right py-3 px-4">الجهاز المُقترح</th>
                <th className="text-right py-3 px-4">نوع الدفع</th>
                <th className="text-right py-3 px-4">المبلغ الكلي</th>
                <th className="text-right py-3 px-4">تفاصيل القسط</th>
                <th className="text-right py-3 px-4">الحسم</th>
                <th className="text-right py-3 px-4">موظف التسكير</th>
                <th className="text-right py-3 px-4">تاريخ التحضير</th>
                <th className="text-right py-3 px-4">النتيجة</th>
                <th className="text-right py-3 px-4">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-400 italic">
                    لا عروض تطابق الفلتر الحالي.
                  </td>
                </tr>
              )}
              {filtered.map(e => (
                <tr
                  key={e.preOfferId ?? `standalone-${e.customerPreOfferId}`}
                  onClick={() => e.openTaskId && navigate(`/tasks/device-demo/${e.openTaskId}`)}
                  className={`border-t border-slate-50 transition-colors ${e.openTaskId ? 'cursor-pointer hover:bg-sky-50/40' : 'bg-slate-50/40'}`}
                >
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-800">{e.deviceModelName ?? '—'}</div>
                    {e.quantity > 1 && (
                      <div className="text-xs text-slate-400 mt-0.5">× {e.quantity}</div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      e.offerType === 'cash'
                        ? 'bg-sky-50 text-sky-700'
                        : 'bg-violet-50 text-violet-700'
                    }`}>
                      {e.offerType === 'cash' ? 'نقدي' : 'أقساط'}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">
                    {fmtMoney(e.totalAmount, e.currency)}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {e.offerType === 'installment' && e.installmentMonths
                      ? <span className="text-xs">
                          أول دفعة {fmtMoney(e.firstPaymentAmount, e.currency)} · {e.installmentMonths} شهر
                        </span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    {e.discountPercentage && e.discountPercentage > 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
                        {e.discountPercentage}%
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 text-slate-700">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>{e.closedByEmployeeName ?? '—'}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{fmtDate(e.taskCreatedAt)}</td>
                  <td className="py-3 px-4">
                    <OutcomeChip
                      state={e.outcome.state}
                      contractId={e.outcome.contractId}
                      contractNumber={e.outcome.contractNumber}
                      noClosingReason={e.noClosingReason}
                      finalDecisionCode={e.outcome.finalDecisionCode}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 text-sky-600 font-bold">
                      فتح المهمة <ExternalLink className="w-3 h-3" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'sky' | 'slate' | 'amber' | 'emerald' | 'rose';
}

// Local helper, matches the design language used by sibling tabs.
const COLOR_MAP = {
  sky:     { wrap: 'bg-sky-50',     text: 'text-sky-600' },
  slate:   { wrap: 'bg-slate-50',   text: 'text-slate-600' },
  amber:   { wrap: 'bg-amber-50',   text: 'text-amber-600' },
  emerald: { wrap: 'bg-emerald-50', text: 'text-emerald-600' },
  rose:    { wrap: 'bg-rose-50',    text: 'text-rose-600' },
} as const;

function SummaryCard({ icon, label, value, color }: SummaryCardProps) {
  const c = COLOR_MAP[color];
  return (
    <div className="rounded-2xl border border-slate-100 shadow-sm px-4 py-4 bg-white">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-2xl ${c.wrap} flex items-center justify-center ${c.text}`}>
          {icon}
        </div>
        <div>
          <div className="text-xs text-slate-400 font-bold">{label}</div>
          <div className="text-lg font-black text-slate-800">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default PreOffersTab;
