import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Crosshair, Loader2, Map as MapIcon, MapPin, Route as RouteIcon, Search, X,
} from '../../components/ui/icons';
import type { ZoneMapColumnKey, ZoneMapResponse } from '@golden-crm/shared';
import { api } from '../../lib/api';
import { getOpenTaskDetailPath } from '../../lib/taskRoutes';
import { usePermissions } from '../../hooks/usePermissions';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import DateField from '../../components/ui/DateField';
import ZoneMapCanvas, { type MapLine, type MapPin as MapPinData } from './ZoneMapCanvas';
import {
  aggregateAreas, aggregateRoutes, GeoIndex, REQUEST_COLUMNS, routeContainsArea, TASK_COLUMNS,
  type AreaRow, type GroupLevel, type ZoneMapFilters,
} from './zoneMapAggregate';

// Local calendar date (NOT UTC) — planning day defaults to tomorrow.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ALL_COLUMNS: ZoneMapColumnKey[] = [...TASK_COLUMNS, ...REQUEST_COLUMNS].map(c => c.key);
type SortKey = 'visits' | ZoneMapColumnKey | `owner:${number}`;
type View = 'areas' | 'routes';
// Selection key for the «no known area» row (real geo ids are positive).
const NO_AREA = -1;

function extractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/API Error \d+: (.*)$/s);
  if (match) {
    try { const parsed = JSON.parse(match[1]); if (parsed?.error) return parsed.error; } catch { /* fall through */ }
  }
  return msg;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${active ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}

export default function ZoneMapStudy() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canPlace = hasPermission('planning.zone_study.manage');

  const [date, setDate] = useState(getPlanningDate);
  const [data, setData] = useState<ZoneMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>('areas');
  const [level, setLevel] = useState<GroupLevel>(3);
  const [columns, setColumns] = useState<Set<ZoneMapColumnKey>>(() => new Set(ALL_COLUMNS));
  const [demoBranch, setDemoBranch] = useState(true);
  const [demoOwnerIds, setDemoOwnerIds] = useState<Set<number>>(new Set());
  const [showRoutes, setShowRoutes] = useState(true);
  const [routeId, setRouteId] = useState<number | null>(null);
  const [routeSearch, setRouteSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('visits');
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const [placing, setPlacing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.zoneMap.get(date);
      setData(res);
      // Every owner starts selected: the first picture is "everything".
      setDemoOwnerIds(new Set(res.owners.map(o => o.hrUserId)));
    } catch (err) {
      setError(extractError(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const geo = useMemo(() => new GeoIndex(data?.areas ?? []), [data]);
  const filters: ZoneMapFilters = useMemo(() => ({ columns, demoBranch, demoOwnerIds }), [columns, demoBranch, demoOwnerIds]);
  const areaRows = useMemo(() => (data ? aggregateAreas(data, geo, filters, level) : []), [data, geo, filters, level]);
  const routeRows = useMemo(() => (data ? aggregateRoutes(data, geo, filters) : []), [data, geo, filters]);

  const owners = data?.owners ?? [];
  const selectedOwners = owners.filter(o => demoOwnerIds.has(o.hrUserId));
  const visibleColumns = [...TASK_COLUMNS, ...REQUEST_COLUMNS].filter(c => columns.has(c.key));

  const sortValue = useCallback((row: AreaRow): number => {
    if (sort === 'visits') return row.visitCount;
    if (sort.startsWith('owner:')) return row.demoByOwner[Number(sort.slice(6))] ?? 0;
    return row.columnCounts[sort as ZoneMapColumnKey] ?? 0;
  }, [sort]);

  const activeRoute = routeRows.find(r => r.routeId === routeId) ?? null;
  // Areas view: with a route picked, only that route's stations are listed.
  const shownAreaRows = useMemo(() => {
    const rows = activeRoute ? activeRoute.stations.map(s => s.row) : areaRows;
    return [...rows].sort((a, b) =>
      Number(a.geoUnitId == null) - Number(b.geoUnitId == null)
      || sortValue(b) - sortValue(a)
      || a.name.localeCompare(b.name, 'ar'));
  }, [activeRoute, areaRows, sortValue]);

  const searchHit = useMemo(() => {
    const q = routeSearch.trim();
    if (!q) return null;
    return data?.areas.filter(a => a.name.includes(q)).map(a => a.geoUnitId) ?? [];
  }, [routeSearch, data]);
  const shownRouteRows = useMemo(() => {
    const rows = searchHit == null
      ? routeRows
      : routeRows.filter(r => searchHit.some(id => routeContainsArea(r.stations.map(s => s.geoUnitId), id, geo)));
    return [...rows].sort((a, b) => sortValue(b.total) - sortValue(a.total) || a.name.localeCompare(b.name, 'ar'));
  }, [routeRows, searchHit, geo, sortValue]);

  const pins: MapPinData[] = shownAreaRows
    .filter(r => r.geoUnitId != null && r.center && r.visitCount + r.requests.length > 0)
    .map(r => ({
      id: r.geoUnitId!,
      lat: r.center!.lat,
      lng: r.center!.lng,
      count: r.visitCount,
      title: `${r.name}: ${r.visitCount} زيارة`,
      accent: Object.keys(r.demoByOwner).length > 0,
    }));
  const lines: MapLine[] = (showRoutes ? routeRows : activeRoute ? [activeRoute] : []).map(r => ({
    id: r.routeId,
    label: r.name,
    active: r.routeId === routeId,
    points: r.stations.filter(s => s.center).map(s => [s.center!.lat, s.center!.lng] as [number, number]),
  }));
  const missingCenters = shownAreaRows.filter(r => r.geoUnitId != null && !r.center && r.visitCount + r.requests.length > 0);
  const noAreaRow = areaRows.find(r => r.geoUnitId == null) ?? null;

  const detailRow: AreaRow | null =
    shownAreaRows.find(r => (r.geoUnitId ?? NO_AREA) === selectedArea) ?? areaRows.find(r => (r.geoUnitId ?? NO_AREA) === selectedArea) ?? null;

  const toggleColumn = (key: ZoneMapColumnKey) => setColumns(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleOwner = (id: number) => setDemoOwnerIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handlePlace = async (lat: number, lng: number) => {
    if (placing == null) return;
    const geoUnitId = placing;
    setPlacing(null);
    try {
      const res = await api.zoneMap.setCenter(geoUnitId, { lat, lng });
      setData(prev => prev && ({
        ...prev,
        areas: prev.areas.map(a => (a.geoUnitId === geoUnitId ? { ...a, center: res.center } : a)),
      }));
      setSelectedArea(geoUnitId);
    } catch (err) {
      setError(extractError(err));
    }
  };

  const countCell = (row: AreaRow, key: ZoneMapColumnKey) => {
    const n = row.columnCounts[key] ?? 0;
    return <span className={n > 0 ? 'font-bold text-slate-700' : 'text-slate-300'}>{n}</span>;
  };
  const sortableTh = (key: SortKey, label: React.ReactNode) => (
    <DataTable.Th align="center" onClick={() => setSort(key)} className={`cursor-pointer select-none ${sort === key ? 'text-sky-700' : ''}`}>
      {label}{sort === key ? ' ▼' : ''}
    </DataTable.Th>
  );
  const numberCells = (row: AreaRow) => (<>
    <DataTable.Td align="center"><span className="font-bold text-sky-700">{row.visitCount}</span></DataTable.Td>
    <DataTable.Td align="center" className="text-slate-500">{row.sharedVisitCount}</DataTable.Td>
    {visibleColumns.map(c => <DataTable.Td key={c.key} align="center">{countCell(row, c.key)}</DataTable.Td>)}
    {columns.has('demo') && demoBranch && <DataTable.Td align="center">{row.demoBranchCount || <span className="text-slate-300">0</span>}</DataTable.Td>}
    {columns.has('demo') && selectedOwners.map(o => (
      <DataTable.Td key={o.hrUserId} align="center">
        {row.demoByOwner[o.hrUserId] ? <span className="font-bold text-violet-700">{row.demoByOwner[o.hrUserId]}</span> : <span className="text-slate-300">0</span>}
      </DataTable.Td>
    ))}
  </>);
  const numberHeads = (<>
    {sortableTh('visits', 'الزيارات')}
    <DataTable.Th align="center" title="زيارات تجمع أكثر من نوع مهمة">مشتركة</DataTable.Th>
    {visibleColumns.map(c => <Fragment key={c.key}>{sortableTh(c.key, c.label)}</Fragment>)}
    {columns.has('demo') && demoBranch && <DataTable.Th align="center">عروض الفرع</DataTable.Th>}
    {columns.has('demo') && selectedOwners.map(o => (
      <Fragment key={o.hrUserId}>{sortableTh(`owner:${o.hrUserId}`, `عروض ${o.name}`)}</Fragment>
    ))}
  </>);

  return (
    <div className="p-4 sm:p-6 lg:p-8" dir="rtl">
      <PageHeader
        className="mb-5"
        title="دراسة النطاقات — الخريطة"
        subtitle="صورة شغل يوم التخطيط قبل جدولة الفرق: أين الزيارات، وأي نوع شغل فيها، وأين تقع عروض كل موظف. للقراءة فقط."
        icon={<div className="p-2 rounded-xl bg-sky-50 text-sky-600"><MapIcon className="w-6 h-6" /></div>}
        actions={
          <button
            type="button"
            onClick={() => navigate('/planning/schedule')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500"
          >
            جدولة الفرق <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        }
      />

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="font-bold text-slate-700">يوم التخطيط</span>
          <DateField value={date} onChange={setDate} className="rounded-lg border border-slate-200 pl-2.5 py-1.5 text-sm" />
        </label>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {(['areas', 'routes'] as View[]).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg ${view === v ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'}`}>
              {v === 'areas' ? 'النطاقات المؤهلة' : 'استكشاف النطاقات'}
            </button>
          ))}
        </div>
        {view === 'areas' && (
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
            {([3, 4] as GroupLevel[]).map(l => (
              <button key={l} type="button" onClick={() => setLevel(l)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg ${level === l ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500'}`}>
                {l === 3 ? 'حسب الناحية' : 'حسب الحي'}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_300px] gap-4 mb-4">
        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-4 text-sm">
          <div>
            <p className="font-bold text-slate-700 mb-2">أنواع المهام</p>
            <div className="flex flex-wrap gap-1.5">
              {TASK_COLUMNS.map(c => <Chip key={c.key} active={columns.has(c.key)} onClick={() => toggleColumn(c.key)}>{c.label}</Chip>)}
            </div>
            <p className="font-bold text-slate-700 mt-3 mb-2">طلبات لم تتحول لمهام</p>
            <div className="flex flex-wrap gap-1.5">
              {REQUEST_COLUMNS.map(c => <Chip key={c.key} active={columns.has(c.key)} onClick={() => toggleColumn(c.key)}>{c.label}</Chip>)}
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <button type="button" className="text-sky-600 font-bold" onClick={() => setColumns(new Set(ALL_COLUMNS))}>الكل</button>
              <button type="button" className="text-slate-500 font-bold" onClick={() => setColumns(new Set())}>لا شيء</button>
            </div>
          </div>

          {columns.has('demo') && (
            <div>
              <p className="font-bold text-slate-700 mb-2">عروض الجهاز لمن</p>
              <label className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={demoBranch} onChange={e => setDemoBranch(e.target.checked)} />
                <span>ملكية الفرع</span>
              </label>
              {owners.length === 0 && <p className="text-xs text-slate-400">لا عروض مملوكة لموظفين في هذا اليوم.</p>}
              {owners.map(o => (
                <label key={o.hrUserId} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={demoOwnerIds.has(o.hrUserId)} onChange={() => toggleOwner(o.hrUserId)} />
                  <span>{o.name}</span>
                  {o.roleName && <span className="text-xs text-slate-400">{o.roleName}</span>}
                </label>
              ))}
              {owners.length > 0 && (
                <div className="mt-1 flex gap-2 text-xs">
                  <button type="button" className="text-sky-600 font-bold" onClick={() => setDemoOwnerIds(new Set(owners.map(o => o.hrUserId)))}>كل الموظفين</button>
                  <button type="button" className="text-slate-500 font-bold" onClick={() => setDemoOwnerIds(new Set())}>بلا موظفين</button>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="font-bold text-slate-700 mb-2 flex items-center gap-1"><RouteIcon className="w-4 h-4" /> خطوط السير</p>
            <label className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={showRoutes} onChange={e => setShowRoutes(e.target.checked)} />
              <span>إظهار كل الخطوط على الخريطة</span>
            </label>
            <select
              value={routeId ?? ''}
              onChange={e => setRouteId(e.target.value ? Number(e.target.value) : null)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">كل مناطق الفرع</option>
              {routeRows.map(r => <option key={r.routeId} value={r.routeId}>{r.name}</option>)}
            </select>
            {routeRows.length === 0 && <p className="mt-1 text-xs text-slate-400">لا خطوط سير ضمن تغطية الفرع.</p>}
          </div>
        </div>

        {/* Map */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 relative min-h-[440px]">
          <ZoneMapCanvas
            pins={pins}
            lines={lines}
            selectedId={selectedArea}
            onSelect={setSelectedArea}
            onPlace={placing != null ? handlePlace : null}
            fitKey={`${date}|${level}|${routeId ?? ''}|${data?.areas.filter(a => a.center).length ?? 0}`}
          />
          {placing != null && (
            <div className="absolute top-4 right-4 left-4 z-[1000] rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-bold text-amber-800 flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> انقر على الخريطة لتحديد مركز «{geo.name(placing)}»
              <button type="button" className="mr-auto text-amber-700" onClick={() => setPlacing(null)}><X className="w-4 h-4" /></button>
            </div>
          )}
          {!loading && pins.length === 0 && placing == null && (
            <div className="absolute inset-x-6 bottom-6 z-[1000] rounded-lg bg-white/95 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              لا دبابيس على الخريطة: المناطق التي فيها شغل لم يُحدَّد مركزها بعد. حدّدها من قائمة «مناطق بلا مركز».
            </div>
          )}
        </div>

        {/* Detail / missing centers */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-sm max-h-[560px] overflow-y-auto">
          {detailRow ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold text-slate-800 flex items-center gap-1"><MapPin className="w-4 h-4 text-sky-600" />{detailRow.name}</p>
                <button type="button" onClick={() => setSelectedArea(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {detailRow.visitCount} زيارة · منها {detailRow.sharedVisitCount} مشتركة{detailRow.requests.length ? ` · ${detailRow.requests.length} طلب` : ''}
              </p>
              {canPlace && detailRow.geoUnitId != null && (
                <button type="button" onClick={() => setPlacing(detailRow.geoUnitId)} className="mb-3 text-xs font-bold text-sky-600 inline-flex items-center gap-1">
                  <Crosshair className="w-3.5 h-3.5" /> {detailRow.center ? 'تعديل مركز المنطقة' : 'تحديد مركز المنطقة'}
                </button>
              )}
              <ul className="space-y-2">
                {detailRow.visits.map(v => (
                  <li key={v.key} className="rounded-lg border border-slate-100 p-2">
                    <Link to={`/clients/${v.clientId}`} className="font-bold text-slate-700 hover:text-sky-600">{v.clientName}</Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.tasks.map(t => {
                        const path = getOpenTaskDetailPath(t.taskType, t.taskId);
                        const label = `${t.taskLabel}${t.deviceLabel ? ` · ${t.deviceLabel}` : ''}${t.overdue ? ' · متأخرة' : ''}`;
                        const cls = `rounded px-1.5 py-0.5 text-xs ${t.overdue ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`;
                        return path ? <Link key={t.taskId} to={path} className={`${cls} hover:underline`}>{label}</Link> : <span key={t.taskId} className={cls}>{label}</span>;
                      })}
                    </div>
                  </li>
                ))}
                {detailRow.requests.map(r => (
                  <li key={`r${r.requestId}`} className="rounded-lg border border-dashed border-slate-200 p-2">
                    <Link to={`/service-requests/${r.requestId}`} className="text-xs font-bold text-slate-600 hover:text-sky-600">
                      {REQUEST_COLUMNS.find(c => c.key === r.column)?.label} · {r.clientName ?? r.refNumber ?? `#${r.requestId}`}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <p className="font-bold text-slate-700 mb-1">مناطق بلا مركز</p>
              <p className="text-xs text-slate-400 mb-3">فيها شغل لكن لا دبوس لها على الخريطة. تظهر في الجدول بكل الأحوال.</p>
              {missingCenters.length === 0 && <p className="text-xs text-slate-400">كل المناطق المعروضة لها مركز.</p>}
              <ul className="space-y-1">
                {missingCenters.map(r => (
                  <li key={r.geoUnitId} className="flex items-center justify-between gap-2">
                    <button type="button" className="text-slate-700 hover:text-sky-600 text-right" onClick={() => setSelectedArea(r.geoUnitId)}>
                      {r.name} <span className="text-xs text-slate-400">({r.visitCount})</span>
                    </button>
                    {canPlace && (
                      <button type="button" onClick={() => setPlacing(r.geoUnitId)} className="text-xs font-bold text-sky-600 inline-flex items-center gap-1">
                        <Crosshair className="w-3.5 h-3.5" /> تحديد
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {noAreaRow && noAreaRow.visitCount > 0 && (
                <button type="button" className="mt-4 text-xs font-bold text-rose-600" onClick={() => setSelectedArea(NO_AREA)}>
                  {noAreaRow.visitCount} زيارة بدون منطقة — عنوانها ناقص (تظهر في آخر الجدول)
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
        {view === 'routes' && (
          <div className="p-3 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={routeSearch}
              onChange={e => setRouteSearch(e.target.value)}
              placeholder="ابحث عن ناحية أو حي لعرض المسارات التي تمر بها"
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </div>
        )}
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.Th>{view === 'areas' ? (level === 3 ? 'الناحية' : 'الحي') : 'المسار'}</DataTable.Th>
              {view === 'routes' && <DataTable.Th>المحطات</DataTable.Th>}
              {numberHeads}
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {view === 'areas' && shownAreaRows.map(row => (
              <DataTable.Row
                key={row.geoUnitId ?? 'none'}
                className={`cursor-pointer hover:bg-slate-50/60 ${(row.geoUnitId ?? NO_AREA) === selectedArea ? 'bg-sky-50/60' : ''}`}
                onClick={() => setSelectedArea(row.geoUnitId ?? NO_AREA)}
              >
                <DataTable.Td className={`font-bold ${row.geoUnitId == null ? 'text-rose-600' : 'text-slate-800'}`}>
                  {row.name}{row.geoUnitId != null && !row.center && <span className="mr-1 text-xs font-normal text-slate-400">(بلا مركز)</span>}
                </DataTable.Td>
                {numberCells(row)}
              </DataTable.Row>
            ))}
            {view === 'routes' && shownRouteRows.map(route => (
              <DataTable.Row
                key={route.routeId}
                className={`cursor-pointer hover:bg-slate-50/60 ${route.routeId === routeId ? 'bg-orange-50/60' : ''}`}
                onClick={() => setRouteId(route.routeId === routeId ? null : route.routeId)}
              >
                <DataTable.Td className="font-bold text-slate-800">{route.name}</DataTable.Td>
                <DataTable.Td className="text-xs text-slate-500">{route.stations.map(s => s.name).join(' ← ')}</DataTable.Td>
                {numberCells(route.total)}
              </DataTable.Row>
            ))}
          </DataTable.Body>
        </DataTable>
        {!loading && view === 'areas' && shownAreaRows.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">لا شغل بهذه الفلاتر في يوم التخطيط.</p>
        )}
        {!loading && view === 'routes' && shownRouteRows.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">لا مسارات مطابقة.</p>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-400 leading-relaxed">
        <span className="font-bold">قراءة الأرقام:</span> الزيارة = زبون في موقع عمل واحد، تُعدّ مرة مهما تعددت مهامه. أعمدة الأنواع تعدّ الزبائن (أو الأجهزة لمهام الجهاز) لكل نوع، لذلك لا يساوي مجموعها عدد الزيارات — عمود «مشتركة» يبيّن الزيارات التي تجمع أكثر من نوع. الطلبات لا تدخل في الزيارات لأنها لم تتحول لمهام بعد. المهام المؤهلة ليوم التخطيط فقط.
      </p>
    </div>
  );
}
