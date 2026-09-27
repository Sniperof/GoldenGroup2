import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarCheck, CheckCircle2, ChevronLeft, Circle, Clock3,
  Crosshair, History, Loader2, MapPin, Phone, RefreshCw, Sparkles, Users2, Zap,
} from '../../components/ui/icons';
import { api } from '../../lib/api';
import DateField from '../../components/ui/DateField';
import InstantVisitModal from '../../components/fieldVisits/InstantVisitModal';
import { useAuthStore } from '../../hooks/useAuthStore';

/**
 * «زياراتي» مساحة تنفيذ شخصية، وليست شاشة إدارة الزيارات في الفرع.
 * التخطيط لا يتجاوز اليوم التالي، لذلك تركز الواجهة على اليوم وغداً وتتيح
 * الرجوع إلى يوم سابق محدد من دون تحميل تاريخ مفتوح وغير محدود.
 */

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'مجدولة', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  in_progress: { label: 'قيد التنفيذ', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ended: { label: 'بانتظار الإغلاق', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  completed: { label: 'مكتملة', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  not_completed: { label: 'غير مكتملة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { label: 'ملغاة', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const DONE_STATUSES = new Set(['completed', 'cancelled']);
type ViewKey = 'today' | 'tomorrow' | 'past';

function localIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function formatDay(date: string, includeWeekday = true) {
  return new Intl.DateTimeFormat('ar-SY', {
    weekday: includeWeekday ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00`));
}

interface MyVisitRow {
  id: number;
  visitType: string;
  status: string;
  scheduledDate: string;
  scheduledTime: string | null;
  clientId: number;
  clientName: string | null;
  clientMobile: string | null;
  addressShort: string | null;
  supervisorName: string | null;
  technicianName: string | null;
  traineeName: string | null;
  taskCount: number;
  hasPendingStartAlert: boolean;
}

function teamName(row: MyVisitRow) {
  if (row.supervisorName) return `فريق ${row.supervisorName}`;
  if (row.technicianName) return `فريق ${row.technicianName}`;
  return 'الفريق غير محدد';
}

function visitRank(row: MyVisitRow) {
  if (row.status === 'in_progress') return 0;
  if (row.hasPendingStartAlert) return 1;
  if (!DONE_STATUSES.has(row.status)) return 2;
  return 3;
}

export default function MyVisitsPage() {
  const navigate = useNavigate();
  const today = localIso();
  const tomorrow = localIso(1);
  const yesterday = localIso(-1);
  const [view, setView] = useState<ViewKey>('today');
  const [pastDate, setPastDate] = useState(yesterday);
  const [rowsByDate, setRowsByDate] = useState<Record<string, MyVisitRow[]>>({});
  const [loadingDates, setLoadingDates] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  const [instantOpen, setInstantOpen] = useState(false);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canCreateInstant = hasPermission('field_visits.create_instant');
  const activeDate = view === 'today' ? today : view === 'tomorrow' ? tomorrow : pastDate;

  const loadDates = useCallback(async (dates: string[]) => {
    const uniqueDates = [...new Set(dates.filter(Boolean))];
    if (!uniqueDates.length) return;
    setLoadingDates((current) => new Set([...current, ...uniqueDates]));
    setError(null);
    const results = await Promise.allSettled(uniqueDates.map(async (date) => ({
      date,
      rows: await api.fieldVisits.myVisits({ date }) as MyVisitRow[],
    })));
    const successful = results
      .filter((result): result is PromiseFulfilledResult<{ date: string; rows: MyVisitRow[] }> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (successful.length) {
      setRowsByDate((current) => {
        const next = { ...current };
        successful.forEach(({ date, rows }) => { next[date] = rows; });
        return next;
      });
    }
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) setError((failed.reason as { message?: string })?.message ?? 'تعذر تحميل زياراتي');
    setLoadingDates((current) => {
      const next = new Set(current);
      uniqueDates.forEach((date) => next.delete(date));
      return next;
    });
  }, []);

  useEffect(() => { void loadDates([today, tomorrow]); }, [loadDates, today, tomorrow]);
  useEffect(() => {
    if (view === 'past') void loadDates([pastDate]);
  }, [loadDates, pastDate, view]);

  const allRows = rowsByDate[activeDate] ?? [];
  const rows = useMemo(() => {
    const visible = focusOnly && view !== 'past'
      ? allRows.filter((row) => !DONE_STATUSES.has(row.status))
      : allRows;
    return [...visible].sort((a, b) => {
      const rank = visitRank(a) - visitRank(b);
      return rank || (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99');
    });
  }, [allRows, focusOnly, view]);

  const counts = useMemo(() => {
    const summarize = (date: string) => {
      const dateRows = rowsByDate[date] ?? [];
      return { total: dateRows.length, remaining: dateRows.filter((row) => !DONE_STATUSES.has(row.status)).length };
    };
    return { today: summarize(today), tomorrow: summarize(tomorrow), past: summarize(pastDate) };
  }, [pastDate, rowsByDate, today, tomorrow]);

  const activeLoading = loadingDates.has(activeDate);
  const viewMeta = view === 'today'
    ? { eyebrow: 'تركيز اليوم', title: 'خطتك لهذا اليوم', description: 'ابدأ بالزيارة الجارية ثم انتقل حسب الوقت المحدد.' }
    : view === 'tomorrow'
      ? { eyebrow: 'استعداد مبكر', title: 'زيارات الغد', description: 'راجع الفريق والعنوان والمهام قبل بدء يومك.' }
      : { eyebrow: 'سجل الزيارات', title: 'الزيارات السابقة', description: 'اختر يوماً سابقاً لمراجعة ما تم وما بقي دون إغلاق.' };

  return (
    <div className="min-h-full bg-slate-50/70 p-4 sm:p-6 lg:p-8" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-lg shadow-teal-600/20">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">زياراتي</h1>
              <p className="mt-1 text-sm text-slate-500">مساحة عملك اليومية للزيارات المسندة إلى فريقك</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void loadDates([activeDate])} disabled={activeLoading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${activeLoading ? 'animate-spin' : ''}`} /> تحديث
            </button>
            {canCreateInstant && (
              <button type="button" onClick={() => setInstantOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-amber-400">
                <Zap className="h-4 w-4" /> زيارة فورية
              </button>
            )}
          </div>
        </header>

        <InstantVisitModal open={instantOpen} onClose={() => setInstantOpen(false)}
          onCreated={(visitId) => { setInstantOpen(false); navigate(`/field-visits/${visitId}`); }} />

        <nav className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm" aria-label="نطاق الزيارات">
          {([
            { key: 'today' as const, label: 'اليوم', detail: formatDay(today, false), count: counts.today.remaining, icon: Crosshair },
            { key: 'tomorrow' as const, label: 'غداً', detail: formatDay(tomorrow, false), count: counts.tomorrow.total, icon: CalendarCheck },
            { key: 'past' as const, label: 'السابقة', detail: 'حسب التاريخ', count: counts.past.total, icon: History },
          ]).map((item) => {
            const Icon = item.icon;
            const selected = view === item.key;
            return (
              <button key={item.key} type="button" onClick={() => setView(item.key)}
                className={`relative flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-right transition sm:justify-start sm:px-4 ${selected ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
                <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-teal-300' : 'text-slate-400'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{item.label}</span>
                  <span className={`hidden truncate text-xs sm:block ${selected ? 'text-slate-300' : 'text-slate-400'}`}>{item.detail}</span>
                </span>
                <span className={`mr-auto hidden min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-bold sm:inline ${selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>{item.count}</span>
              </button>
            );
          })}
        </nav>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-l from-teal-50/80 via-white to-white px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-teal-700"><Sparkles className="h-4 w-4" /> {viewMeta.eyebrow}</div>
                <h2 className="text-lg font-extrabold text-slate-900">{viewMeta.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{viewMeta.description}</p>
              </div>
              {view === 'past' ? (
                <DateField value={pastDate} onChange={(value) => { if (value && value <= yesterday) setPastDate(value); }} max={yesterday}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              ) : (
                <button type="button" onClick={() => setFocusOnly((current) => !current)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${focusOnly ? 'border-teal-600 bg-teal-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'}`}>
                  <Crosshair className="h-4 w-4" /> {focusOnly ? 'التركيز مفعّل' : 'ركّز على المتبقي'}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:mx-6">
              <span>{error}</span>
              <button type="button" onClick={() => void loadDates([activeDate])} className="shrink-0 font-bold underline">إعادة المحاولة</button>
            </div>
          )}

          {activeLoading && !(activeDate in rowsByDate) ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> جارٍ ترتيب زياراتك…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-20 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><CalendarCheck className="h-7 w-7" /></div>
              <h3 className="font-bold text-slate-700">{focusOnly && allRows.length ? 'أنجزت كل زيارات هذا اليوم' : 'لا توجد زيارات في هذا اليوم'}</h3>
              <p className="mt-1 text-sm text-slate-400">{focusOnly && allRows.length ? 'يمكنك إلغاء وضع التركيز لمراجعة الزيارات المنجزة.' : 'ستظهر هنا الزيارات المسندة إلى فريقك.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((row) => {
                const status = STATUS_LABELS[row.status] ?? { label: row.status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
                const done = DONE_STATUSES.has(row.status);
                const inProgress = row.status === 'in_progress';
                return (
                  <article key={row.id} role="button" tabIndex={0} onClick={() => navigate(`/field-visits/${row.id}`)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(`/field-visits/${row.id}`); }}
                    className={`group cursor-pointer px-4 py-4 transition hover:bg-slate-50/80 sm:px-6 ${done ? 'opacity-70' : ''}`}>
                    <div className="flex gap-3 sm:gap-4">
                      <div className="pt-0.5">
                        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : inProgress ? (
                          <span className="relative flex h-5 w-5 items-center justify-center"><span className="absolute h-5 w-5 animate-ping rounded-full bg-indigo-300 opacity-40" /><span className="relative h-3 w-3 rounded-full bg-indigo-600" /></span>
                        ) : <Circle className="h-5 w-5 text-slate-300 transition group-hover:text-teal-500" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className={`truncate font-bold ${done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-900'}`}>{row.clientName || 'زبون غير محدد'}</h3>
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${status.cls}`}>{status.label}</span>
                              {row.hasPendingStartAlert && <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700"><AlertTriangle className="h-3 w-3" /> تحتاج إجراء</span>}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 sm:text-sm">
                              <span className="inline-flex items-center gap-1.5 font-bold text-slate-700"><Clock3 className="h-4 w-4 text-teal-600" /> {row.scheduledTime?.slice(0, 5) ?? 'دون وقت محدد'}</span>
                              {row.addressShort && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{row.addressShort}</span>}
                              {row.clientMobile && <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-4 w-4" />{row.clientMobile}</span>}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                              <span className="inline-flex items-center gap-1"><Users2 className="h-3.5 w-3.5" />{teamName(row)}</span>
                              <span>{row.taskCount} {row.taskCount === 1 ? 'مهمة' : 'مهام'}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-xs font-bold text-teal-700 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">فتح الزيارة <ChevronLeft className="h-4 w-4" /></div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex items-center justify-center gap-2 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" /> الجدولة المستقبلية متاحة حتى يوم غد فقط</div>
      </div>
    </div>
  );
}
