import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileSearch, ReceiptText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { api, type AccountStatementEntry, type AccountStatementResponse } from '../../lib/api';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';

interface Props {
  client: { id: number };
}

type TypeFilter = 'all' | 'contracts' | 'maintenance' | 'installation';

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string; types?: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'contracts', label: 'عقود', types: 'contract,contract_installment,contract_payment' },
  { id: 'maintenance', label: 'صيانة', types: 'emergency_maintenance,periodic_maintenance' },
  { id: 'installation', label: 'تركيب', types: 'installation' },
];

function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftMonths(date: Date, months: number): Date {
  const shifted = new Date(date);
  shifted.setMonth(shifted.getMonth() + months);
  return shifted;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB').format(new Date(value));
}

function formatMoney(value: number): string {
  return `${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ل.س`;
}

function StatementSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map(item => (
          <div key={item} className="h-28 rounded-2xl bg-slate-200" />
        ))}
      </div>
      <div className="h-20 rounded-2xl bg-slate-200" />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {[0, 1, 2, 3, 4].map(item => (
          <div key={item} className="h-14 border-b border-slate-100 bg-slate-50 last:border-0" />
        ))}
      </div>
    </div>
  );
}

export function AccountStatementTab({ client }: Props) {
  const navigate = useNavigate();
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => toInputDate(shiftMonths(today, -6)));
  const [to, setTo] = useState(() => toInputDate(shiftMonths(today, 6)));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [data, setData] = useState<AccountStatementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const selectedTypes = TYPE_FILTERS.find(filter => filter.id === typeFilter)?.types;

    setLoading(true);
    setError(null);
    api.clients.getAccountStatement(client.id, { from, to, types: selectedTypes })
      .then(result => {
        if (active) setData(result);
      })
      .catch(err => {
        console.error('[AccountStatementTab] fetch failed:', err);
        if (active) {
          setData(null);
          setError('تعذر تحميل كشف الحساب. يرجى المحاولة مرة أخرى.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client.id, from, to, typeFilter]);

  const openSource = (entry: AccountStatementEntry) => {
    if (entry.contract_id) {
      navigate(`/contracts/${entry.contract_id}`);
    } else if (entry.source_type === 'emergency_maintenance' || entry.source_type === 'periodic_maintenance') {
      navigate('/tasks/group/maintenance');
    }
  };

  if (loading && !data) {
    return <StatementSkeleton />;
  }

  const summary = data?.summary ?? {
    current_balance: 0,
    total_paid: 0,
    upcoming_total: 0,
    overdue_amount: 0,
  };

  // Columns mirror the original raw table 1:1 (design-only migration to <SmartTable>).
  const columns: ColumnDef<AccountStatementEntry>[] = [
    { key: 'entry_date', label: 'التاريخ', render: e => <span className="block whitespace-nowrap font-bold text-slate-600" dir="ltr">{formatDate(e.entry_date)}</span> },
    { key: 'description', label: 'الوصف', render: e => <span className="text-sm font-bold text-slate-800">{e.description}</span> },
    { key: 'reference_no', label: 'المرجع', render: e => <span className="text-sm text-slate-500">{e.reference_no || '-'}</span> },
    { key: 'debit_amount', label: 'مدين (عليه)', render: e => <span className="whitespace-nowrap font-black text-red-600">{e.debit_amount > 0 ? formatMoney(e.debit_amount) : '-'}</span> },
    { key: 'credit_amount', label: 'دائن (دفع)', render: e => <span className="whitespace-nowrap font-black text-emerald-600">{e.credit_amount > 0 ? formatMoney(e.credit_amount) : '-'}</span> },
    { key: 'running_balance', label: 'الرصيد', render: e => <span className={`whitespace-nowrap font-black ${e.running_balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatMoney(e.running_balance)}</span> },
  ];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">المستحق الآن</p>
          <p className={`mt-2 text-2xl font-black ${
            summary.current_balance > 0 ? 'text-red-600' : 'text-emerald-600'
          }`}>
            {formatMoney(summary.current_balance)}
          </p>
          {summary.overdue_amount > 0 && (
            <p className="mt-2 text-xs font-bold text-red-500">
              منه متأخر: {formatMoney(summary.overdue_amount)}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">إجمالي المدفوع</p>
          <p className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(summary.total_paid)}</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">الاستحقاقات القادمة</p>
          <p className="mt-2 text-2xl font-black text-amber-600">{formatMoney(summary.upcoming_total)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="text-xs font-bold text-slate-500">
            من
            <input
              type="date"
              value={from}
              max={to}
              onChange={event => setFrom(event.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-sky-500"
              dir="ltr"
            />
          </label>
          <label className="text-xs font-bold text-slate-500">
            إلى
            <input
              type="date"
              value={to}
              min={from}
              onChange={event => setTo(event.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-sky-500"
              dir="ltr"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map(filter => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setTypeFilter(filter.id)}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                typeFilter === filter.id
                  ? 'bg-sky-600 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      <SmartTable<AccountStatementEntry>
        title="كشف الحساب"
        icon={ReceiptText}
        data={data?.entries ?? []}
        columns={columns}
        getId={e => e.id}
        onRowClick={entry => openSource(entry)}
        rowClassName={e => e.is_upcoming ? 'bg-amber-50/50 hover:bg-sky-50' : ''}
        hideFilterBar
        tableMinWidth={850}
        emptyIcon={FileSearch}
        emptyMessage="لا توجد حركات مالية مسجلة"
      />

      <p className="flex items-center gap-2 text-xs font-bold text-slate-400">
        <ReceiptText className="h-4 w-4" />
        اضغط على الحركة لفتح مصدرها.
      </p>
    </div>
  );
}
