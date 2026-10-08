import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquareWarning, Plus, Search, Loader2 } from 'lucide-react';
import Button from '../../components/ui/Button';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import { usePermissions } from '../../hooks/usePermissions';
import { complaintsApi } from './complaintsApi';

const STATUS: Record<string, string> = { new: 'جديدة', triaged: 'تم الفرز', assigned: 'معيّنة', in_progress: 'قيد المعالجة', awaiting_complainant: 'بانتظار المشتكي', resolved: 'محلولة', closed: 'مغلقة', rejected: 'مرفوضة', withdrawn: 'مسحوبة' };
const TYPES: Record<string, string> = { technical: 'فنية', device: 'جهاز', general: 'عامة' };
const PRIORITY: Record<string, string> = { critical: 'حرجة', high: 'عالية', normal: 'عادية', low: 'منخفضة' };

const columns: ColumnDef<any>[] = [
  { key: 'complaintId', label: 'رقم الشكوى', sortable: true, render: (r) => <span className="font-mono font-semibold text-slate-700">{r.complaintId}</span> },
  { key: 'complaintType', label: 'النوع', render: (r) => <span className="text-sm text-slate-600">{TYPES[r.complaintType] ?? r.complaintType}</span> },
  { key: 'sourceChannel', label: 'المصدر', render: (r) => <span className="text-sm text-slate-600">{r.sourceChannel}</span> },
  { key: 'requesterName', label: 'مقدم الشكوى', sortable: true, render: (r) => <span className="text-sm font-medium text-slate-700">{r.requesterName}</span> },
  {
    key: 'complaintDate', label: 'تاريخ التقديم', sortable: true,
    render: (r) => <span className="text-sm text-slate-600">{new Date(r.complaintDate).toLocaleDateString('ar-SY')}</span>,
    getValue: (r) => new Date(r.complaintDate).getTime(),
  },
  {
    key: 'status', label: 'الحالة', sortable: true,
    render: (r) => <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 border border-sky-100">{STATUS[r.status] ?? r.status}</span>,
    getValue: (r) => STATUS[r.status] ?? r.status,
  },
  { key: 'priority', label: 'الأولوية', render: (r) => <span className="text-sm text-slate-600">{PRIORITY[r.priority] ?? r.priority}</span> },
  { key: 'handlingBranchName', label: 'فرع المعالجة', render: (r) => <span className="text-sm text-slate-600">{r.handlingBranchName ?? 'غير معيّن'}</span> },
];

export default function ComplaintsListPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ page: '1', pageSize: '100' });
      if (search) q.set('search', search);
      if (status) q.set('status', status);
      if (type) q.set('type', type);
      const r = await complaintsApi.list(q);
      setItems(r.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  // Server-side filters: refetch when type/status change (search fires on Enter/button).
  useEffect(() => { void load(); }, [status, type]);

  return (
    <div dir="rtl" className="p-6 space-y-5">
      {/* Title + create */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-50 p-3 text-amber-600"><MessageSquareWarning /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">إدارة الشكاوى</h1>
            <p className="text-sm text-slate-500">نطاق مستقل لمعالجة الشكاوى ومتابعة حالاتها</p>
          </div>
        </div>
        {hasPermission('complaints.create_internal') && <Button icon={Plus} onClick={() => navigate('/complaints/new')}>تسجيل شكوى</Button>}
      </div>

      {/* External (server-side) filter bar — unchanged behaviour */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && void load()} placeholder="رقم الشكوى، الاسم أو الهاتف" className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3" />
        </div>
        <select value={type} onChange={e => setType(e.target.value)} className="rounded-lg border border-slate-200 px-3">
          <option value="">كل الأنواع</option>
          {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-3">
          <option value="">كل الحالات</option>
          {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <Button variant="secondary" onClick={() => void load()}>بحث</Button>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-red-700">{error}</div>}

      {/* Unified list table (SmartTable): sort + pagination + CSV export + mobile cards */}
      {initialLoad ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div>
      ) : (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <SmartTable<any>
            title="سجل الشكاوى"
            icon={MessageSquareWarning}
            data={items}
            columns={columns}
            getId={(r) => r.id}
            hideFilterBar
            tableMinWidth={950}
            onRowClick={(r) => navigate(`/complaints/${r.id}`)}
            actions={(r) => (
              <Link to={`/complaints/${r.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-medium text-sky-600 hover:underline">
                التفاصيل
              </Link>
            )}
            emptyIcon={MessageSquareWarning}
            emptyMessage="لا توجد شكاوى مطابقة"
            exportFileName="complaints"
          />
        </div>
      )}
    </div>
  );
}
