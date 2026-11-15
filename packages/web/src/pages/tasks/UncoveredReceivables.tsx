// «ذمم بلا مهمة تحصيل» — every installment that still owes money but has NO
// active collection task (never created / last one cancelled / last one completed
// with balance left). Detection surface: read scope = tasks.collection.view
// (server-scoped + the external branch filter); the create action reuses the
// system's own collection-task creation (open_tasks.edit on the row's branch).
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ClipboardPlus, DollarSign, Loader2, Search, XCircle } from '../../components/ui/icons';
import PageHeader from '../../components/ui/PageHeader';
import DateField from '../../components/ui/DateField';
import Select from '../../components/ui/Select';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import BranchScopeIndicator from '../../components/BranchScopeIndicator';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchListScope } from '../../hooks/useBranchListScope';
import { alertDialog, confirmDialog } from '../../lib/dialogs';
import {
  api,
  type UncoveredReceivableKind,
  type UncoveredReceivableReason,
  type UncoveredReceivableRow,
  type UncoveredReceivablesSummary,
} from '../../lib/api';

const BATCH_LIMIT = 50;

const KIND_LABELS: Record<UncoveredReceivableKind, string> = {
  contract: 'قسط عقد',
  maintenance: 'قسط صيانة',
  warranty: 'قسط كفالة ذهبية',
};

const REASON_META: Record<UncoveredReceivableReason, { label: string; hint: string; style: string; card: string }> = {
  never_created: {
    label: 'لم تُنشأ مهمة',
    hint: 'لا توجد أي مهمة تحصيل لهذا القسط',
    style: 'bg-rose-50 text-rose-700 border-rose-200',
    card: 'border-rose-200 bg-rose-50/60',
  },
  task_cancelled: {
    label: 'المهمة ملغاة',
    hint: 'آخر مهمة تحصيل أُلغيت ولم تُستبدل',
    style: 'bg-amber-50 text-amber-700 border-amber-200',
    card: 'border-amber-200 bg-amber-50/60',
  },
  task_completed_with_balance: {
    label: 'أُغلقت مع بقاء رصيد',
    hint: 'آخر مهمة أُغلقت والقسط ما زال عليه رصيد بلا متابعة',
    style: 'bg-violet-50 text-violet-700 border-violet-200',
    card: 'border-violet-200 bg-violet-50/60',
  },
};

const TASK_STATUS_LABELS: Record<string, string> = {
  cancelled: 'ملغاة',
  completed: 'مكتملة',
  closed: 'مغلقة',
};

function money(n: number | null | undefined) {
  return `${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ل.س`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB').format(new Date(value));
}

function sourceHref(r: UncoveredReceivableRow): string | null {
  if (r.sourceType === 'contract') return `/contracts/${r.sourceId}`;
  if (r.sourceType === 'maintenance_task') return `/tasks/group/maintenance/${r.sourceId}`;
  if (r.deviceId) return `/installed-devices/${r.deviceId}`;
  return null;
}

const rowId = (r: UncoveredReceivableRow) => `${r.kind}:${r.installmentId}`;

export default function UncoveredReceivables() {
  const { user, hasPermission } = useAuthStore();
  const isSuperAdmin = user?.isSuperAdmin === true;
  const canView = isSuperAdmin || hasPermission('tasks.collection.view');
  const canCreate = isSuperAdmin || hasPermission('open_tasks.edit');
  const branchScope = useBranchListScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientId = Number(searchParams.get('clientId')) || null;

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<UncoveredReceivableKind | ''>('');
  const [reason, setReason] = useState<UncoveredReceivableReason | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [rows, setRows] = useState<UncoveredReceivableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<UncoveredReceivablesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);

  // Debounced free-text search.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.uncoveredReceivables.list({
      branchId: branchScope.effectiveBranchId ?? null,
      kind, reason, overdueOnly, dueFrom, dueTo, search, clientId,
      page, pageSize, sortDir,
    })
      .then((d) => {
        if (cancelled) return;
        setRows(d.rows);
        setTotal(d.total);
        setSummary(d.summary);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? 'فشل التحميل'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canView, branchScope.effectiveBranchId, kind, reason, overdueOnly, dueFrom, dueTo, search, clientId, page, pageSize, sortDir, reloadKey]);

  const createTasks = async (items: UncoveredReceivableRow[]) => {
    if (items.length === 0 || creating) return;
    if (items.length > BATCH_LIMIT) {
      await alertDialog({ title: 'عدد كبير', message: `يمكن إنشاء ${BATCH_LIMIT} مهمة كحد أقصى في المرة الواحدة. حدّد عدداً أقل.` });
      return;
    }
    const sum = items.reduce((acc, r) => acc + Number(r.remainingSyp || 0), 0);
    const ok = await confirmDialog({
      title: 'إنشاء مهمة تحصيل',
      message: items.length === 1
        ? `إنشاء مهمة تحصيل للقسط رقم ${items[0].installmentNumber} (${items[0].sourceLabel}) للزبون ${items[0].clientName ?? `#${items[0].clientId}`} بمبلغ متبقٍّ ${money(items[0].remainingSyp)}؟`
        : `إنشاء ${items.length} مهمة تحصيل (مهمة لكل قسط) بمجموع متبقٍّ ${money(sum)}؟`,
      confirmText: 'إنشاء',
    });
    if (!ok) return;
    setCreating(true);
    try {
      const res = await api.uncoveredReceivables.createTasks(items.map((r) => ({ kind: r.kind, installmentId: r.installmentId })));
      const skippedLines = res.results
        .filter((r) => r.status === 'skipped')
        .slice(0, 8)
        .map((r) => `• قسط #${r.installmentId}: ${r.message ?? r.code}${r.existingTaskId ? ` (مهمة #${r.existingTaskId})` : ''}`);
      await alertDialog({
        title: res.created > 0 ? 'تم الإنشاء' : 'لم تُنشأ مهام',
        message: [
          `أُنشئت ${res.created} مهمة تحصيل${res.skipped > 0 ? `، وتُخطّي ${res.skipped}` : ''}.`,
          ...skippedLines,
        ].join('\n'),
        tone: res.created > 0 ? 'default' : 'danger',
      });
    } catch (e: any) {
      await alertDialog({ title: 'تعذر الإنشاء', message: e?.message ?? 'فشل إنشاء مهام التحصيل', tone: 'danger' });
    } finally {
      setCreating(false);
      setReloadKey((k) => k + 1);
    }
  };

  const columns: ColumnDef<UncoveredReceivableRow>[] = useMemo(() => [
    {
      key: 'client', label: 'الزبون',
      exportValue: (r) => `${r.clientName ?? ''} ${r.clientMobile ?? ''}`.trim(),
      render: (r) => (
        <div className="flex flex-col">
          <Link to={`/clients/${r.clientId}`} className="text-sm font-bold text-sky-700 hover:underline">{r.clientName ?? `زبون #${r.clientId}`}</Link>
          {r.clientMobile && <span className="text-xs text-slate-400" dir="ltr">{r.clientMobile}</span>}
        </div>
      ),
    },
    {
      key: 'branchName', label: 'الفرع',
      exportValue: (r) => r.branchName ?? '',
      render: (r) => <span className="text-sm text-slate-600">{r.branchName ?? '—'}</span>,
    },
    {
      key: 'source', label: 'المصدر',
      exportValue: (r) => `${KIND_LABELS[r.kind]} — ${r.sourceLabel}`,
      render: (r) => {
        const href = sourceHref(r);
        return (
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-400">{KIND_LABELS[r.kind]}</span>
            {href
              ? <Link to={href} className="text-sm font-bold text-sky-700 hover:underline">{r.sourceLabel}</Link>
              : <span className="text-sm text-slate-700">{r.sourceLabel}</span>}
          </div>
        );
      },
    },
    {
      key: 'installmentNumber', label: 'القسط',
      exportValue: (r) => r.installmentNumber,
      render: (r) => <span className="text-sm font-bold text-slate-700">#{r.installmentNumber}</span>,
    },
    {
      key: 'dueDate', label: 'الاستحقاق', sortable: true,
      exportValue: (r) => r.dueDate,
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-sm text-slate-600" dir="ltr">{formatDate(r.dueDate)}</span>
          {r.overdueDays > 0
            ? <span className="text-xs font-bold text-red-600">متأخر {r.overdueDays} يوم</span>
            : <span className="text-xs text-slate-400">غير متأخر</span>}
        </div>
      ),
    },
    {
      key: 'remainingSyp', label: 'المتبقي',
      exportValue: (r) => r.remainingSyp,
      render: (r) => (
        <div className="flex flex-col">
          <span className="whitespace-nowrap text-sm font-black text-red-600">{money(r.remainingSyp)}</span>
          {r.usdDue && (
            <span className="whitespace-nowrap text-xs text-slate-500">
              <span dir="ltr">${Number(r.usdDue.remainingUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              {r.usdDue.dueTodaySyp != null && <> · مستحق اليوم {money(r.usdDue.dueTodaySyp)}</>}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'reason', label: 'السبب',
      exportValue: (r) => REASON_META[r.reason].label,
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${REASON_META[r.reason].style}`}>{REASON_META[r.reason].label}</span>
          {r.lastTaskId && (
            <Link to={`/tasks/group/collection/${r.lastTaskId}`} className="text-[11px] text-slate-500 hover:text-sky-700 hover:underline">
              آخر مهمة #{r.lastTaskId} · {TASK_STATUS_LABELS[r.lastTaskStatus ?? ''] ?? r.lastTaskStatus} · {formatDate(r.lastTaskAt)}
            </Link>
          )}
        </div>
      ),
    },
  ], []);

  if (!canView) return <Navigate to="/" replace />;

  const clearFilters = () => {
    setSearchInput(''); setSearch(''); setKind(''); setReason(''); setOverdueOnly(false);
    setDueFrom(''); setDueTo(''); setPage(1);
    if (clientId) setSearchParams({}, { replace: true });
  };
  const hasFilters = Boolean(searchInput || kind || reason || overdueOnly || dueFrom || dueTo || clientId);
  const totalBucket = summary?.total;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6" dir="rtl">
      <PageHeader
        title="ذمم بلا مهمة تحصيل"
        subtitle="أقساط عليها رصيد مستحق ولا توجد لها مهمة تحصيل نشطة — لم تُنشأ لها مهمة، أو أُلغيت مهمتها، أو أُغلقت مع بقاء رصيد. أقساط العقود الفعّالة وأقساط الصيانة والكفالة الذهبية المعتمدة."
        icon={<div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center"><DollarSign className="w-5 h-5 text-rose-600" /></div>}
      />

      {summary && totalBucket && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => { setReason(''); setPage(1); }}
            className={`rounded-2xl border p-4 text-start transition-shadow hover:shadow-sm ${reason === '' ? 'border-slate-400 bg-white ring-2 ring-slate-200' : 'border-slate-200 bg-white'}`}
          >
            <div className="text-xs font-bold text-slate-500">الإجمالي</div>
            <div className="mt-1 text-2xl font-black text-slate-800">{totalBucket.count.toLocaleString('en-US')} قسط</div>
            <div className="text-sm font-black text-red-600">{money(totalBucket.amountSyp)}</div>
            <div className="mt-1 text-xs text-slate-400">منها متأخر {totalBucket.overdueCount.toLocaleString('en-US')} · {money(totalBucket.overdueAmountSyp)}</div>
          </button>
          {(Object.keys(REASON_META) as UncoveredReceivableReason[]).map((key) => {
            const b = summary.byReason[key];
            const meta = REASON_META[key];
            return (
              <button
                key={key}
                type="button"
                title={meta.hint}
                onClick={() => { setReason(reason === key ? '' : key); setPage(1); }}
                className={`rounded-2xl border p-4 text-start transition-shadow hover:shadow-sm ${meta.card} ${reason === key ? 'ring-2 ring-sky-300' : ''}`}
              >
                <div className="text-xs font-bold text-slate-600">{meta.label}</div>
                <div className="mt-1 text-xl font-black text-slate-800">{b.count.toLocaleString('en-US')} قسط</div>
                <div className="text-sm font-bold text-slate-700">{money(b.amountSyp)}</div>
                <div className="mt-1 text-xs text-slate-500">{meta.hint}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="بحث (اسم الزبون / الجوال / رقم العقد / المصدر)..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:bg-white"
            />
          </div>
          <label className="space-y-1 min-w-[160px]">
            <span className="block text-xs font-bold text-slate-500">النوع</span>
            <Select<string>
              className="w-full"
              value={kind}
              onChange={(v) => { setKind(v as UncoveredReceivableKind | ''); setPage(1); }}
              ariaLabel="النوع"
              options={[
                { value: '', label: `كل الأنواع${summary ? ` (${summary.total.count})` : ''}` },
                ...(Object.keys(KIND_LABELS) as UncoveredReceivableKind[]).map((k) => ({
                  value: k, label: `${KIND_LABELS[k]}${summary ? ` (${summary.byKind[k].count})` : ''}`,
                })),
              ]}
            />
          </label>
          <label className="space-y-1 min-w-[160px]">
            <span className="block text-xs font-bold text-slate-500">السبب</span>
            <Select<string>
              className="w-full"
              value={reason}
              onChange={(v) => { setReason(v as UncoveredReceivableReason | ''); setPage(1); }}
              ariaLabel="السبب"
              options={[
                { value: '', label: 'كل الأسباب' },
                ...(Object.keys(REASON_META) as UncoveredReceivableReason[]).map((k) => ({ value: k, label: REASON_META[k].label })),
              ]}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-bold text-slate-500">استحقاق من</span>
            <DateField value={dueFrom} onChange={(v) => { setDueFrom(v); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-bold text-slate-500">إلى</span>
            <DateField value={dueTo} onChange={(v) => { setDueTo(v); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 py-2.5 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1); }} className="h-4 w-4 rounded border-slate-300" />
            المتأخرة فقط
          </label>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="flex items-center gap-1 py-2.5 text-xs font-bold text-slate-500 hover:text-red-600">
              <XCircle className="w-4 h-4" /> مسح الكل
            </button>
          )}
        </div>
        {clientId && (
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-bold text-sky-700">
              زبون محدد: <Link to={`/clients/${clientId}`} className="hover:underline">#{clientId}</Link>
              <button type="button" aria-label="إزالة" onClick={() => setSearchParams({}, { replace: true })}><XCircle className="w-3.5 h-3.5" /></button>
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          <AlertTriangle className="w-4 h-4" />{error}
        </div>
      )}

      <div className={`relative transition-opacity ${loading || creating ? 'opacity-60 pointer-events-none' : ''}`}>
        {(loading || creating) && (
          <div className="absolute inset-x-0 top-24 z-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-sky-500" /></div>
        )}
        <SmartTable<UncoveredReceivableRow>
          title="الأقساط بلا مهمة تحصيل"
          icon={DollarSign}
          scopeIndicator={<BranchScopeIndicator />}
          hideFilterBar
          data={rows}
          columns={columns}
          getId={rowId}
          tableMinWidth={1100}
          emptyIcon={DollarSign}
          emptyMessage="لا توجد ذمم بلا مهمة تحصيل ضمن المرشّح"
          server={{
            totalCount: total,
            page,
            itemsPerPage: pageSize,
            onPageChange: setPage,
            onItemsPerPageChange: (n) => { setPageSize(n); setPage(1); },
            sortKey: 'dueDate',
            sortDir,
            onSortChange: (_key, dir) => { setSortDir(dir === 'desc' ? 'desc' : 'asc'); setPage(1); },
          }}
          bulkActions={canCreate ? [{
            label: `إنشاء مهام تحصيل (حتى ${BATCH_LIMIT})`,
            icon: ClipboardPlus,
            variant: 'primary',
            onClick: (items) => { void createTasks(items); },
          }] : undefined}
          actions={canCreate ? (r) => (
            <button
              type="button"
              onClick={() => { void createTasks([r]); }}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500"
            >
              <ClipboardPlus className="w-3.5 h-3.5" /><span>إنشاء مهمة تحصيل</span>
            </button>
          ) : undefined}
        />
      </div>
    </div>
  );
}
