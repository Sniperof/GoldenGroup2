import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Smartphone, Loader2, RefreshCw } from 'lucide-react';
import { APP_ACCOUNT_SOURCES, type AppAccountListRow, type AppAccountListResult } from '@golden-crm/shared';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import PageHeader from '../../components/ui/PageHeader';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';

export default function CustomerAppUsers() {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('app_accounts.view');
  const canViewClient = hasPermission('clients.view_list');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({ search: '', status: '', source: '', page: 1, limit: 25, sortKey: 'createdAt', sortDir: 'desc' as 'asc' | 'desc' });
  const [result, setResult] = useState<AppAccountListResult>({ items: [], totalCount: 0, limit: 25, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q => q.search === search.trim() ? q : { ...q, search: search.trim(), page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setLoading(true);
    setError('');
    api.appAccounts.list({
      search: query.search, status: query.status, source: query.source,
      limit: query.limit, offset: (query.page - 1) * query.limit,
      sortKey: query.sortKey, sortDir: query.sortDir,
    }).then(res => {
      if (!active) return;
      const lastPage = Math.max(1, Math.ceil(res.totalCount / query.limit));
      if (query.page > lastPage) {
        setQuery(q => ({ ...q, page: lastPage }));
        return;
      }
      setResult(res);
    }).catch((err: unknown) => {
      if (active) {
        setResult({ items: [], totalCount: 0, limit: query.limit, offset: 0 });
        setError(err instanceof Error ? err.message : 'تعذر تحميل مستخدمي التطبيق');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, query, refresh]);

  if (!canView) return <Navigate to="/" replace />;

  const sourceLabel = (source: string) => APP_ACCOUNT_SOURCES[source as keyof typeof APP_ACCOUNT_SOURCES] ?? source;
  const columns: ColumnDef<AppAccountListRow>[] = [
    { key: 'clientName', label: 'الزبون', sortable: true, render: row => canViewClient
      ? <Link to={`/clients/${row.clientId}`} className="font-semibold text-sky-700 hover:underline">{row.clientName}</Link>
      : <span className="font-semibold">{row.clientName}</span> },
    { key: 'primaryMobile', label: 'رقم الدخول', sortable: true, render: row => <span dir="ltr" className="font-mono">{row.primaryMobile}</span> },
    { key: 'branchName', label: 'الفرع', sortable: true, render: row => row.branchName ?? '—' },
    { key: 'status', label: 'حالة الحساب', sortable: true, render: row => <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {row.status === 'active' ? 'مفعّل' : 'موقوف'}
    </span> },
    { key: 'createdSource', label: 'مصدر الإنشاء', sortable: true, render: row => sourceLabel(row.createdSource) },
    { key: 'createdAt', label: 'تاريخ الإنشاء', sortable: true, render: row => new Date(row.createdAt).toLocaleString('ar-SY') },
    { key: 'suspendedReason', label: 'سبب الإيقاف', render: row => row.suspendedReason ?? '—' },
  ];

  const controlClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700';
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <PageHeader title="مستخدمو تطبيق الزبائن" subtitle="حسابات تطبيق الزبائن المفعّلة والموقوفة في جميع الفروع."
          icon={<Smartphone className="h-6 w-6 text-sky-600" />}
          actions={<button type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)} className={`${controlClass} flex items-center gap-2 disabled:opacity-50`}>
            <RefreshCw className="h-4 w-4" /> تحديث
          </button>} />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-slate-600">البحث
            <input value={search} maxLength={150} onChange={e => setSearch(e.target.value)} placeholder="اسم الزبون أو رقم الدخول" className={controlClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">حالة الحساب
            <select value={query.status} onChange={e => setQuery(q => ({ ...q, status: e.target.value, page: 1 }))} className={controlClass}>
              <option value="">كل الحالات</option><option value="active">مفعّل</option><option value="suspended">موقوف</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">مصدر الإنشاء
            <select value={query.source} onChange={e => setQuery(q => ({ ...q, source: e.target.value, page: 1 }))} className={controlClass}>
              <option value="">كل المصادر</option>
              {Object.entries(APP_ACCOUNT_SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {loading && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الحسابات…</div>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {!loading && !error && <SmartTable<AppAccountListRow> title="قائمة مستخدمي تطبيق الزبائن" icon={Smartphone}
          data={result.items} columns={columns} getId={row => row.id} hideFilterBar
          emptyMessage="لا توجد حسابات تطبيق مطابقة للبحث والفلاتر" fillEmptyRows={false}
          server={{ totalCount: result.totalCount, page: query.page, itemsPerPage: query.limit,
            onPageChange: page => setQuery(q => ({ ...q, page })),
            onItemsPerPageChange: limit => setQuery(q => ({ ...q, limit, page: 1 })),
            sortKey: query.sortKey, sortDir: query.sortDir,
            onSortChange: (key, dir) => setQuery(q => ({ ...q, sortKey: dir ? key : 'createdAt', sortDir: dir ?? 'desc', page: 1 })),
          }} />}
      </div>
    </div>
  );
}
