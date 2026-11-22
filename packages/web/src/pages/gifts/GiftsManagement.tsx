import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, FileText, Gift, ListFilter, PackageCheck, Settings2, UserCheck } from '../../components/ui/icons';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Tabs from '../../components/ui/Tabs';
import GiftRecordsTable from '../../components/gifts/GiftRecordsTable';
import GiftDefinitionsPanel from '../../components/gifts/GiftDefinitionsPanel';
import {
  giftConditionStatusLabels,
  giftStatusLabels,
  type GiftConditionStatus,
  type GiftRecord,
  type GiftRecordStatus,
} from '../../data/gifts';
import { api } from '../../lib/api';
import PageJump from '../../components/ui/PageJump';

const PAGE_SIZE = 25;

type StatusFilter = 'all' | GiftRecordStatus;
type ConditionFilter = 'all' | GiftConditionStatus;
type GiftManagementTab = 'records' | 'definitions';

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Gift;
  tone: string;
}) {
  return (
    <Card padding="sm" className="min-h-[84px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
        </div>
        <div className={`rounded-lg p-2 ${tone}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

export default function GiftsManagement() {
  const [activeTab, setActiveTab] = useState<GiftManagementTab>('records');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [condition, setCondition] = useState<ConditionFilter>('all');
  const [records, setRecords] = useState<GiftRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState({ approvedForDelivery: 0, deliveryTaskCreated: 0, delivered: 0, pendingCondition: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Debounce the search box; any filter change returns to page 1.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchInput.trim();
      setSearch(current => {
        if (current !== next) setPage(1);
        return next;
      });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    api.gifts.records.listPaged({
      status: status === 'all' ? undefined : status,
      conditionStatus: condition === 'all' ? undefined : condition,
      search: search || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(result => {
        if (!active) return;
        setRecords(result.rows);
        setTotal(result.total);
        setKpis(result.kpis);
      })
      .catch((err: any) => {
        if (!active) return;
        setRecords([]);
        setTotal(0);
        setLoadError(err?.message ?? 'تعذر تحميل سجلات الهدايا من الخادم');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [condition, status, search, page, reloadToken]);

  const refreshRecords = () => setReloadToken(token => token + 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="h-full overflow-y-auto bg-slate-50" dir="rtl">
      <div className="space-y-5 p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="إدارة الهدايا"
          subtitle="مركز متابعة الوعود والاستحقاق والتسليم وتعريف أنواع الهدايا"
          icon={<Gift className="h-7 w-7 text-sky-600" />}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="معتمدة للتسليم" value={kpis.approvedForDelivery} icon={PackageCheck} tone="bg-sky-50 text-sky-700" />
          <SummaryTile label="لها مهمة تسليم" value={kpis.deliveryTaskCreated} icon={ClipboardCheck} tone="bg-indigo-50 text-indigo-700" />
          <SummaryTile label="تم تسليمها" value={kpis.delivered} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" />
          <SummaryTile label="تحتاج تحقق شرط" value={kpis.pendingCondition} icon={UserCheck} tone="bg-amber-50 text-amber-700" />
        </div>

        <Tabs
          tabs={[
            { id: 'records', label: 'سجلات الهدايا', icon: Gift, count: total },
            { id: 'definitions', label: 'تعريفات الهدايا', icon: Settings2 },
          ]}
          activeKey={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'records' && (
          <Card padding="md">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-base font-bold text-slate-800">
                  <ListFilter className="h-5 w-5 text-slate-400" />
                  فلترة سجلات الهدايا
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {loading ? 'جاري تحميل سجلات الهدايا...' : loadError ?? 'تقرأ هذه الشاشة سجلات الهدايا من قاعدة البيانات وتعرض الوعد والاستحقاق والتسليم.'}
                </p>
              </div>
              <div className="flex flex-col gap-2 lg:items-end">
              <Link
                  to="/contracts/new"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-sky-200 px-3 text-xs font-bold text-sky-700 hover:bg-sky-50"
              >
                <FileText className="h-4 w-4" />
                إضافة وعد من عقد
              </Link>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-xs font-bold text-slate-500">
                  بحث
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="المستفيد، رقم العقد، الهدية، رقم السجل"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                  />
                </label>
                <label className="text-xs font-bold text-slate-500">
                  حالة السجل
                  <select
                    value={status}
                    onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                  >
                    <option value="all">كل الحالات</option>
                    {Object.entries(giftStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-500">
                  تحقق الشرط
                  <select
                    value={condition}
                    onChange={(event) => { setCondition(event.target.value as ConditionFilter); setPage(1); }}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                  >
                    <option value="all">كل الحالات</option>
                    {Object.entries(giftConditionStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
              </div>
            </div>

            <GiftRecordsTable records={records} onChanged={refreshRecords} />

            {total > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-xs font-bold text-slate-500">
                  عرض {(page - 1) * PAGE_SIZE + 1}-{Math.min(total, page * PAGE_SIZE)} من {total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold disabled:opacity-30"
                  >السابق</button>
                  <span className="rounded-lg border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-black text-sky-700">{page}</span>
                  <button
                    type="button"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold disabled:opacity-30"
                  >التالي</button>
                  {totalPages > 1 && <PageJump current={page} total={totalPages} onJump={setPage} />}
                </div>
              </div>
            )}
          </Card>
        )}

        {activeTab === 'definitions' && <GiftDefinitionsPanel />}
      </div>
    </div>
  );
}
