import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, FileText, Gift, ListFilter, PackageCheck, Settings2, UserCheck } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Tabs from '../../components/ui/Tabs';
import GiftRecordsTable from '../../components/gifts/GiftRecordsTable';
import GiftDefinitionsPanel from '../../components/gifts/GiftDefinitionsPanel';
import {
  giftConditionStatusLabels,
  giftStatusLabels,
  type GiftConditionStatus,
  type GiftRecordPrototype,
  type GiftRecordStatus,
} from '../../data/giftsPrototype';
import { api } from '../../lib/api';

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
  const [records, setRecords] = useState<GiftRecordPrototype[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    api.gifts.records.list({
      status: status === 'all' ? undefined : status,
      conditionStatus: condition === 'all' ? undefined : condition,
    })
      .then(rows => {
        if (!active) return;
        setRecords(rows);
      })
      .catch((err: any) => {
        if (!active) return;
        setRecords([]);
        setLoadError(err?.message ?? 'تعذر تحميل سجلات الهدايا من الخادم');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [condition, status, reloadToken]);

  const filteredRecords = records;
  const refreshRecords = () => setReloadToken(token => token + 1);

  const approvedCount = records.filter(record => record.status === 'approved_for_delivery').length;
  const taskCount = records.filter(record => record.status === 'delivery_task_created').length;
  const deliveredCount = records.filter(record => record.status === 'delivered' || record.status === 'delivered_manually').length;
  const pendingConditionCount = records.filter(record => record.conditionStatus === 'pending').length;

  return (
    <div className="h-full overflow-y-auto bg-slate-50" dir="rtl">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader
          title="إدارة الهدايا"
          subtitle="مركز متابعة الوعود والاستحقاق والتسليم وتعريف أنواع الهدايا"
          icon={<Gift className="h-7 w-7 text-sky-600" />}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="معتمدة للتسليم" value={approvedCount} icon={PackageCheck} tone="bg-sky-50 text-sky-700" />
          <SummaryTile label="لها مهمة تسليم" value={taskCount} icon={ClipboardCheck} tone="bg-indigo-50 text-indigo-700" />
          <SummaryTile label="تم تسليمها" value={deliveredCount} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700" />
          <SummaryTile label="تحتاج تحقق شرط" value={pendingConditionCount} icon={UserCheck} tone="bg-amber-50 text-amber-700" />
        </div>

        <Tabs
          tabs={[
            { id: 'records', label: 'سجلات الهدايا', icon: Gift, count: records.length },
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-500">
                  حالة السجل
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as StatusFilter)}
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
                    onChange={(event) => setCondition(event.target.value as ConditionFilter)}
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

            <GiftRecordsTable records={filteredRecords} onChanged={refreshRecords} />
          </Card>
        )}

        {activeTab === 'definitions' && <GiftDefinitionsPanel />}
      </div>
    </div>
  );
}
