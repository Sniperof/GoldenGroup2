import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ZoneMapColumnKey } from '@golden-crm/shared';
import { getOpenTaskDetailPath } from '../../lib/taskRoutes';
import { TASK_COLUMNS, type TaskListRow } from './zoneMapAggregate';

// «عرض المهام» table: rows arrive already in priority order (listTasks); they
// are shown in one group per task type, each with a header that sums it up.

const TONE: Partial<Record<ZoneMapColumnKey, { dot: string; band: string; text: string }>> = {
  collection: { dot: 'bg-emerald-500', band: 'bg-emerald-50/70 border-emerald-400', text: 'text-emerald-800' },
  emergency: { dot: 'bg-rose-500', band: 'bg-rose-50/70 border-rose-400', text: 'text-rose-800' },
  periodic: { dot: 'bg-sky-500', band: 'bg-sky-50/70 border-sky-400', text: 'text-sky-800' },
  return: { dot: 'bg-amber-500', band: 'bg-amber-50/70 border-amber-400', text: 'text-amber-800' },
  delivery: { dot: 'bg-indigo-500', band: 'bg-indigo-50/70 border-indigo-400', text: 'text-indigo-800' },
  demo: { dot: 'bg-violet-500', band: 'bg-violet-50/70 border-violet-400', text: 'text-violet-800' },
};
const DEFAULT_TONE = { dot: 'bg-slate-400', band: 'bg-slate-50 border-slate-300', text: 'text-slate-700' };

const fmtDate = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : null);
const fmtAmount = (n: number) => n.toLocaleString('en-US');
const typeLabel = (key: ZoneMapColumnKey, fallback: string) => TASK_COLUMNS.find(c => c.key === key)?.label ?? fallback;
const Dash = () => <span className="text-slate-300">—</span>;

interface Props {
  rows: TaskListRow[];
  selectedStation: number | null; // NO_AREA sentinel for «بدون منطقة»
  noArea: number;
  onSelectStation: (id: number) => void;
  ownerName: Map<number, string>;
}

const COLS = 9;

// A branch can have tens of thousands of open tasks: each group renders its
// first PAGE rows and grows by PAGE on request. Group headers sum the whole group.
const PAGE = 100;

export default function ZoneMapTaskTable({ rows, selectedStation, noArea, onSelectStation, ownerName }: Props) {
  const [limits, setLimits] = useState<Partial<Record<ZoneMapColumnKey, number>>>({});
  // New filters → start every group from its first page again.
  useEffect(() => { setLimits({}); }, [rows]);
  const groups: { column: ZoneMapColumnKey; rows: TaskListRow[] }[] = [];
  rows.forEach(r => {
    const last = groups.at(-1);
    if (last && last.column === r.task.column) last.rows.push(r);
    else groups.push({ column: r.task.column, rows: [r] });
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold text-slate-500">
          <tr className="border-b border-slate-200 whitespace-nowrap">
            <th className="w-20 px-3 py-2.5 text-start">رقم المهمة</th>
            <th className="w-28 px-3 py-2.5 text-start">نوع المهمة</th>
            <th className="px-3 py-2.5 text-start">الزبون / الجهاز</th>
            <th className="px-3 py-2.5 text-start">المحطة / خطوط السير</th>
            <th className="w-32 px-3 py-2.5 text-start">تاريخ الاستحقاق</th>
            <th className="w-32 px-3 py-2.5 text-start">تاريخ المتابعة</th>
            <th className="w-20 px-3 py-2.5 text-center">المحاولات</th>
            <th className="w-28 px-3 py-2.5 text-end">المبلغ (ل.س)</th>
            <th className="w-36 px-3 py-2.5 text-start">المالك</th>
          </tr>
        </thead>
        {groups.map(g => {
          const tone = TONE[g.column] ?? DEFAULT_TONE;
          const late = g.rows.filter(r => r.daysLate > 0).length;
          const amount = g.rows.reduce((s, r) => s + (r.task.expectedAmount ?? 0), 0);
          const limit = limits[g.column] ?? PAGE;
          const hidden = g.rows.length - limit;
          return (
            <tbody key={g.column}>
              <tr>
                <td colSpan={COLS} className={`border-y border-r-4 px-3 py-2 ${tone.band}`}>
                  <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${tone.text}`}>
                    <span className="text-sm font-bold">{typeLabel(g.column, g.rows[0].task.taskLabel)}</span>
                    <span><b className="tabular-nums">{g.rows.length}</b> مهمة</span>
                    {late > 0 && <span className="text-rose-700"><b className="tabular-nums">{late}</b> متأخرة</span>}
                    {amount > 0 && <span>المتوقع: <b className="tabular-nums">{fmtAmount(amount)}</b> ل.س</span>}
                  </div>
                </td>
              </tr>
              {g.rows.slice(0, limit).map(({ task: t, station, stationId, routeNames, daysLate }) => {
                const path = getOpenTaskDetailPath(t.taskType, t.taskId);
                const owner = t.ownerHrUserIds.map(id => ownerName.get(id)).filter(Boolean).join('، ');
                const selected = (stationId ?? noArea) === selectedStation;
                const followUp = t.status === 'needs_follow_up';
                return (
                  <tr
                    key={t.taskId}
                    onClick={() => onSelectStation(stationId ?? noArea)}
                    className={`cursor-pointer border-b border-slate-100 align-middle transition-colors ${selected ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {path
                        ? <Link to={path} onClick={e => e.stopPropagation()} className="font-bold text-sky-700 hover:underline">#{t.taskId}</Link>
                        : <span className="text-slate-500">#{t.taskId}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                        <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                        {t.taskLabel}
                      </span>
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5">
                      <Link to={`/clients/${t.clientId}`} onClick={e => e.stopPropagation()} className="block truncate font-bold text-slate-800 hover:text-sky-600">
                        {t.clientName}
                      </Link>
                      {t.deviceLabel && <span className="block truncate text-xs text-slate-400">{t.deviceLabel}</span>}
                    </td>
                    <td className="max-w-[240px] px-3 py-2.5">
                      <span className={`block truncate ${stationId == null ? 'font-bold text-rose-600' : 'text-slate-700'}`}>{station}</span>
                      {routeNames.length > 0
                        ? <span className="block truncate text-xs text-slate-400" title={routeNames.join('، ')}>خط: {routeNames.join('، ')}</span>
                        : <span className="block text-xs text-slate-300">لا خط سير</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="block text-xs tabular-nums text-slate-700">{fmtDate(t.dueDate) ?? <Dash />}</span>
                      {daysLate > 0 && !followUp && <span className="text-[11px] font-bold text-rose-600">متأخرة {daysLate} يوم</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`block text-xs tabular-nums ${followUp ? 'font-bold text-amber-700' : 'text-slate-700'}`}>{fmtDate(t.followUpDate) ?? <Dash />}</span>
                      {followUp && (
                        <span className={`text-[11px] font-bold ${daysLate > 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                          {daysLate > 0 ? `متابعة متأخرة ${daysLate} يوم` : 'بانتظار المتابعة'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs tabular-nums">{t.attemptCount > 0 ? <b className="text-slate-700">{t.attemptCount}</b> : <Dash />}</td>
                    <td className="px-3 py-2.5 text-end text-xs tabular-nums">{t.expectedAmount != null ? <b className="text-slate-700">{fmtAmount(t.expectedAmount)}</b> : <Dash />}</td>
                    <td className="px-3 py-2.5">
                      {owner
                        ? <span className="inline-block max-w-[130px] truncate rounded-full bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700">{owner}</span>
                        : <span className="text-xs text-slate-400">الفرع</span>}
                    </td>
                  </tr>
                );
              })}
              {hidden > 0 && (
                <tr className="border-b border-slate-100">
                  <td colSpan={COLS} className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => setLimits(prev => ({ ...prev, [g.column]: limit + PAGE }))}
                      className="text-xs font-bold text-sky-700 hover:underline"
                    >
                      عرض {Math.min(PAGE, hidden)} أخرى — يُعرض {limit} من {g.rows.length}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
