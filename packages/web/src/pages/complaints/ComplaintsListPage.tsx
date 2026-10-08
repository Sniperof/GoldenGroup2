import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquareWarning, Plus, Search, Loader2 } from 'lucide-react';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import PageHeader from '../../components/ui/PageHeader';
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
    <div dir="rtl" className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Title + create — shared PageHeader, same as the other list pages */}
      <PageHeader
        title="إدارة الشكاوى"
        subtitle="نطاق مستقل لمعالجة الشكاوى ومتابعة حالاتها"
        actions={hasPermission('complaints.create_internal') && (
          <Button icon={Plus} className="w-full sm:w-auto" onClick={() => navigate('/complaints/new')}>تسجيل شكوى</Button>
        )}
      />

      {/* External (server-side) filter bar — same card/search/Select styling as
          the Clients page; behaviour unchanged (type/status refetch, search on
          Enter or the button). */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void load()}
              placeholder="رقم الشكوى، الاسم أو الهاتف"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-sm focus:border-sky-500 focus:outline-none transition-all focus:bg-white"
            />
          </div>
          <Select
            className="w-full sm:w-44"
            value={type}
            onChange={setType}
            ariaLabel="نوع الشكوى"
            options={[{ value: '', label: 'كل الأنواع' }, ...Object.entries(TYPES).map(([value, label]) => ({ value, label }))]}
          />
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={setStatus}
            ariaLabel="حالة الشكوى"
            options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]}
          />
          <Button variant="secondary" className="w-full sm:w-auto" onClick={() => void load()}>بحث</Button>
        </div>
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
