import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileSearch, ReceiptText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { api, type AccountStatementResponse } from '../../lib/api';

interface Props {
  client: { id: number };
}

type TypeFilter = 'all' | 'contracts' | 'maintenance' | 'installments';

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string; types?: string }> = [
  { id: 'all', label: 'الكل' },
  {
    id: 'contracts',
    label: 'عقود',
    types: 'contract_payment,contract_discount,refund',
  },
  { id: 'maintenance', label: 'مهمات', types: 'maintenance_payment' },
  { id: 'installments', label: 'أقساط', types: 'contract_installment' },
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

  const openSource = (sourceType: string | null, sourceId: number | null) => {
    if (!sourceId) return;
    if (sourceType === 'contract') {
      navigate(`/contracts/${sourceId}`);
    } else if (sourceType === 'maintenance_request') {
      navigate('/tasks/group/maintenance');
    }
  };

  if (loading && !data) {
    return <StatementSkeleton />;
  }

  const summary = data?.summary ?? {
    total_owed: 0,
    total_paid: 0,
    current_balance: 0,
    overdue_amount: 0,
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">إجمالي العليه</p>
          <p className="mt-2 text-2xl font-black text-red-600">{formatMoney(summary.total_owed)}</p>
          {summary.overdue_amount > 0 && (
            <p className="mt-2 text-xs font-bold text-red-500">
              المتأخر: {formatMoney(summary.overdue_amount)}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">إجمالي الدفع</p>
          <p className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(summary.total_paid)}</p>
        </div>
        <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">الرصيد الحالي</p>
          <p className={`mt-2 text-2xl font-black ${
            summary.current_balance < 0 ? 'text-red-600' : 'text-emerald-600'
          }`}>
            {formatMoney(summary.current_balance)}
          </p>
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

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading && (
          <div className="h-1 overflow-hidden bg-sky-100">
            <div className="h-full w-1/2 animate-pulse bg-sky-500" />
          </div>
        )}
        {data && data.entries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-right text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">الوصف</th>
                  <th className="px-4 py-3">المرجع</th>
                  <th className="px-4 py-3">مدين (عليه)</th>
                  <th className="px-4 py-3">دائن (دفع)</th>
                  <th className="px-4 py-3">الرصيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.entries.map(entry => {
                  const isFutureInstallment =
                    entry.entry_type === 'contract_installment' &&
                    new Date(entry.entry_date).getTime() > today.getTime();
                  const canNavigate = Boolean(entry.source_id);
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => openSource(entry.source_type, entry.source_id)}
                      onContextMenu={event => {
                        if (!canNavigate) return;
                        event.preventDefault();
                        openSource(entry.source_type, entry.source_id);
                      }}
                      className={`${isFutureInstallment ? 'bg-slate-50' : 'bg-white'} ${
                        canNavigate ? 'cursor-pointer hover:bg-sky-50' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-600" dir="ltr">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-800">{entry.description}</td>
                      <td className="px-4 py-3 text-slate-500">{entry.reference_no || '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-black text-red-600">
                        {entry.debit_amount > 0 ? formatMoney(entry.debit_amount) : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-black text-emerald-600">
                        {entry.credit_amount > 0 ? formatMoney(entry.credit_amount) : '-'}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 font-black ${
                        entry.running_balance < 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}>
                        {formatMoney(entry.running_balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !loading && !error ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-4 py-10 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <FileSearch className="h-7 w-7" />
            </div>
            <p className="font-black text-slate-700">لا توجد حركات مالية مسجلة</p>
          </div>
        ) : null}
      </div>

      <p className="flex items-center gap-2 text-xs font-bold text-slate-400">
        <ReceiptText className="h-4 w-4" />
        اضغط على الحركة لفتح مصدرها.
      </p>
    </div>
  );
}
