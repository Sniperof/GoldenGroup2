import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Calendar, Crosshair, ListChecks, Loader2, Map as MapIcon, MapPin, Route as RouteIcon, Search, Users, X,
} from '../../components/ui/icons';
import type { ZoneMapColumnKey, ZoneMapResponse } from '@golden-crm/shared';
import { api } from '../../lib/api';
import { getOpenTaskDetailPath } from '../../lib/taskRoutes';
import { usePermissions } from '../../hooks/usePermissions';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import DateField from '../../components/ui/DateField';
import { hasGoogleMapsKey } from '../../lib/googleMaps';
import { computeRoadRoute, formatDistance, formatDuration, type RoadRoute } from '../../lib/googleRoutes';
import ZoneMapTaskTable from './ZoneMapTaskTable';
import ZoneMapCanvas, { type MapLine, type MapPin as MapPinData } from './ZoneMapCanvas';
import {
  aggregateAreas, aggregateRoutes, GeoIndex, isBranchOwned, listTasks, REQUEST_COLUMNS, routeContainsArea, TASK_COLUMNS,
  type AreaRow, type ZoneMapFilters,
} from './zoneMapAggregate';

// Local calendar date (NOT UTC) — planning day defaults to tomorrow.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Requests (not yet tasks) are hidden from the study for now.
const ALL_COLUMNS: ZoneMapColumnKey[] = TASK_COLUMNS.map(c => c.key);
type SortKey = 'visits' | 'owned' | ZoneMapColumnKey | `owner:${number}`;
// More picked employees than this → one «عروض الموظفين» total column instead.
const MAX_OWNER_COLUMNS = 5;
type View = 'areas' | 'routes' | 'tasks';
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

function Card({ icon, title, actions, className = '', children }: { icon: React.ReactNode; title: string; actions?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`bg-white rounded-xl shadow-sm border border-slate-200 p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-bold text-slate-800">{icon}{title}</h3>
        {actions && <div className="flex items-center gap-2 text-xs font-bold">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function CountBadge({ n }: { n: number }) {
  return <span className={`shrink-0 text-xs tabular-nums ${n > 0 ? 'font-bold text-slate-500' : 'text-slate-300'}`}>{n}</span>;
}

// A task type as a toggle pill; a type with no work today stays listed but muted.
function TypePill({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  const tone = active
    ? count > 0 ? 'border-sky-600 bg-sky-600 text-white' : 'border-sky-200 bg-sky-50 text-sky-400'
    : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50';
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${tone}`}>
      {children}
      <span className={`rounded-full px-1.5 tabular-nums text-[11px] ${active && count > 0 ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
    </button>
  );
}

// Selectable owner: the branch, or one employee with their role.
function OwnerTile({ active, onClick, avatar, name, sub, count, tone }: {
  active: boolean; onClick: () => void; avatar: React.ReactNode; name: string; sub: string; count: number; tone: 'sky' | 'violet';
}) {
  const on = tone === 'sky' ? 'border-sky-300 bg-sky-50' : 'border-violet-300 bg-violet-50';
  const dot = tone === 'sky' ? 'bg-sky-600 text-white' : 'bg-violet-600 text-white';
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-right transition-colors ${active ? on : 'border-slate-200 bg-white opacity-60 hover:opacity-100'}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? dot : 'bg-slate-100 text-slate-400'}`}>{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-slate-800">{name}</span>
        <span className="block truncate text-[11px] text-slate-500">{sub}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${active ? 'bg-white text-slate-700' : 'bg-slate-100 text-slate-400'}`}>{count}</span>
    </button>
  );
}

function RouteOption({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-right ${active ? 'bg-sky-50 font-bold text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-sky-600' : 'bg-slate-200'}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null && <CountBadge n={count} />}
    </button>
  );
}

export default function ZoneMapStudy() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canPlace = hasPermission('planning.zone_study.manage');

  const [date, setDate] = useState(getPlanningDate);
  const [data, setData] = useState<ZoneMapResponse | null>(null);
  // Bumped on every load: the map re-fits to the pins then, not when a center is placed.
  const [loadSeq, setLoadSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>('areas');
  const [columns, setColumns] = useState<Set<ZoneMapColumnKey>>(() => new Set(ALL_COLUMNS));
  const [branchOwned, setBranchOwned] = useState(true);
  const [ownerIds, setOwnerIds] = useState<Set<number>>(new Set());
  const [showRoutes, setShowRoutes] = useState(true);
  const [routeId, setRouteId] = useState<number | null>(null);
  const [routeSearch, setRouteSearch] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [panelTab, setPanelTab] = useState<'detail' | 'missing'>('detail');
  const [road, setRoad] = useState<{ key: string; route: RoadRoute } | null>(null);
  const [roadLoading, setRoadLoading] = useState(false);
  const [roadError, setRoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('visits');
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  // Picking an area (map, table or the no-center list) shows its work.
  useEffect(() => { if (selectedArea != null) setPanelTab('detail'); }, [selectedArea]);
  const [placing, setPlacing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.zoneMap.get(date);
      setData(res);
      setLoadSeq(s => s + 1);
      // Every owner starts selected: the first picture is "everything".
      setOwnerIds(new Set(res.owners.map(o => o.hrUserId)));
    } catch (err) {
      setError(extractError(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const geo = useMemo(() => new GeoIndex(data?.areas ?? []), [data]);
  const filters: ZoneMapFilters = useMemo(() => ({ columns, branchOwned, ownerIds }), [columns, branchOwned, ownerIds]);
  const areaRows = useMemo(() => (data ? aggregateAreas(data, geo, filters) : []), [data, geo, filters]);
  const routeRows = useMemo(() => (data ? aggregateRoutes(data, geo, filters) : []), [data, geo, filters]);

  const owners = useMemo(
    () => [...(data?.owners ?? [])].sort((a, b) => (a.roleName ?? '').localeCompare(b.roleName ?? '', 'ar') || a.name.localeCompare(b.name, 'ar')),
    [data],
  );
  // Sidebar counts (tasks, the day's whole picture — not narrowed by the filters).
  const { typeCounts, branchCount, ownerCounts } = useMemo(() => {
    const types: Partial<Record<ZoneMapColumnKey, number>> = {};
    const byOwner: Record<number, number> = {};
    let branch = 0;
    (data?.tasks ?? []).forEach(t => {
      types[t.column] = (types[t.column] ?? 0) + 1;
      if (isBranchOwned(t)) branch++;
      else t.ownerHrUserIds.forEach(id => { byOwner[id] = (byOwner[id] ?? 0) + 1; });
    });
    return { typeCounts: types, branchCount: branch, ownerCounts: byOwner };
  }, [data]);
  const selectedOwners = owners.filter(o => ownerIds.has(o.hrUserId));
  // Table columns: only the selected types that have work today — a column of
  // zeros is empty space. Demos split into the branch's and the employees':
  // one column per picked employee while few are picked, else one total
  // (who owns what is then in the area detail).
  const visibleColumns = TASK_COLUMNS.filter(c => columns.has(c.key) && (typeCounts[c.key] ?? 0) > 0);
  const demoShown = columns.has('demo') && (typeCounts.demo ?? 0) > 0;
  const showBranchDemos = demoShown && branchOwned;
  const ownerColumns = demoShown && selectedOwners.length <= MAX_OWNER_COLUMNS ? selectedOwners : [];
  const showOwnedTotal = demoShown && selectedOwners.length > MAX_OWNER_COLUMNS;
  const ownerName = useMemo(() => new Map(owners.map(o => [o.hrUserId, o.name])), [owners]);
  const shownOwners = useMemo(() => {
    const q = ownerSearch.trim();
    return q ? owners.filter(o => o.name.includes(q) || (o.roleName ?? '').includes(q)) : owners;
  }, [owners, ownerSearch]);

  const sortValue = useCallback((row: AreaRow): number => {
    if (sort === 'visits') return row.visitCount;
    if (sort === 'owned') return row.demoOwnedCount;
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
  // «عرض المهام»: with a route picked, only the tasks on its stations.
  const taskRows = useMemo(
    () => (data ? listTasks(data, geo, filters, activeRoute?.stations.map(s => s.geoUnitId) ?? null) : []),
    [data, geo, filters, activeRoute],
  );

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
  // Road path of the picked route (Google Routes: shortest, no traffic), as in
  // the route builder: on request, between station centers, dropped as soon as
  // the placed stations change. Not stored.
  const activeStraight = useMemo(
    () => activeRoute?.stations.filter(s => s.center).map(s => [s.center!.lat, s.center!.lng] as [number, number]) ?? [],
    [activeRoute],
  );
  const roadKey = `${routeId ?? ''}|${JSON.stringify(activeStraight)}`;
  const currentRoad = road?.key === roadKey ? road.route : null;
  const canRoad = hasGoogleMapsKey() && activeStraight.length >= 2;
  useEffect(() => { setRoadError(null); }, [roadKey]);
  const computeRoad = async () => {
    const key = roadKey;
    setRoadLoading(true);
    setRoadError(null);
    try {
      setRoad({ key, route: await computeRoadRoute(activeStraight) });
    } catch (err) {
      setRoadError((err as Error)?.message || 'تعذّر حساب المسار');
    } finally {
      setRoadLoading(false);
    }
  };

  const lines: MapLine[] = (showRoutes ? routeRows : activeRoute ? [activeRoute] : []).map(r => ({
    id: r.routeId,
    label: r.name,
    active: r.routeId === routeId,
    points: r.routeId === routeId && currentRoad
      ? currentRoad.path
      : r.stations.filter(s => s.center).map(s => [s.center!.lat, s.center!.lng] as [number, number]),
  }));
  // With a route picked: every station without a center, in route order — a
  // station with no work today still needs one for the route line to draw.
  // Otherwise: the areas that carry work but have no pin.
  const missingCenters = activeRoute
    ? activeRoute.stations.filter(s => !s.center).map(s => s.row)
    : shownAreaRows.filter(r => r.geoUnitId != null && !r.center && r.visitCount + r.requests.length > 0);
  const noAreaRow = areaRows.find(r => r.geoUnitId == null) ?? null;

  const detailRow: AreaRow | null =
    shownAreaRows.find(r => (r.geoUnitId ?? NO_AREA) === selectedArea) ?? areaRows.find(r => (r.geoUnitId ?? NO_AREA) === selectedArea) ?? null;

  const toggleColumn = (key: ZoneMapColumnKey) => setColumns(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleOwner = (id: number) => setOwnerIds(prev => {
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
      // Placing a route's stations one after another: stay on the list.
      if (!activeRoute) setSelectedArea(geoUnitId);
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
    {showBranchDemos && <DataTable.Td align="center">{row.demoBranchCount || <span className="text-slate-300">0</span>}</DataTable.Td>}
    {ownerColumns.map(o => (
      <DataTable.Td key={o.hrUserId} align="center">
        {row.demoByOwner[o.hrUserId] ? <span className="font-bold text-violet-700">{row.demoByOwner[o.hrUserId]}</span> : <span className="text-slate-300">0</span>}
      </DataTable.Td>
    ))}
    {showOwnedTotal && (
      <DataTable.Td align="center">
        {row.demoOwnedCount ? <span className="font-bold text-violet-700">{row.demoOwnedCount}</span> : <span className="text-slate-300">0</span>}
      </DataTable.Td>
    )}
  </>);
  const numberHeads = (<>
    {sortableTh('visits', 'الزيارات')}
    <DataTable.Th align="center" title="زيارات تجمع أكثر من نوع مهمة">مشتركة</DataTable.Th>
    {visibleColumns.map(c => <Fragment key={c.key}>{sortableTh(c.key, c.label)}</Fragment>)}
    {showBranchDemos && <DataTable.Th align="center">عروض الفرع</DataTable.Th>}
    {ownerColumns.map(o => (
      <Fragment key={o.hrUserId}>{sortableTh(`owner:${o.hrUserId}`, <span title={o.roleName ?? undefined}>عروض {o.name}</span>)}</Fragment>
    ))}
    {showOwnedTotal && sortableTh('owned', <span title={selectedOwners.map(o => o.name).join('، ')}>عروض الموظفين ({selectedOwners.length})</span>)}
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

      {/* Toolbar: planning day + view, then the task types as one horizontal row of pills */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-4">
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-slate-100">
          <label className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="font-bold text-slate-700">يوم التخطيط</span>
            <DateField value={date} onChange={setDate} className="rounded-lg border border-slate-200 pl-2.5 py-1.5 text-sm" />
          </label>
          <div className="flex-1" />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="flex items-center gap-1 text-xs font-bold text-slate-500 ml-1"><ListChecks className="w-4 h-4" /> أنواع المهام</span>
          {TASK_COLUMNS.filter(c => c.key !== 'other' || typeCounts.other).map(c => (
            <TypePill key={c.key} active={columns.has(c.key)} count={typeCounts[c.key] ?? 0} onClick={() => toggleColumn(c.key)}>
              {c.label}
            </TypePill>
          ))}
          <div className="mr-auto flex items-center gap-3 text-xs font-bold">
            <button type="button" className="text-sky-600 hover:underline" onClick={() => setColumns(new Set(ALL_COLUMNS))}>الكل</button>
            <button type="button" className="text-slate-400 hover:underline" onClick={() => setColumns(new Set())}>لا شيء</button>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[290px_minmax(0,1fr)_320px] gap-4 mb-4">
        {/* Ownership, then routes */}
        <div className="flex flex-col gap-4 text-sm xl:h-[640px]">
          <Card
            icon={<Users className="w-4 h-4 text-violet-600" />}
            title="الملكية"
            className="shrink-0"
            actions={<>
              <button type="button" className="text-sky-600 hover:underline" onClick={() => { setBranchOwned(true); setOwnerIds(new Set(owners.map(o => o.hrUserId))); }}>الكل</button>
              <button type="button" className="text-slate-400 hover:underline" onClick={() => { setBranchOwned(false); setOwnerIds(new Set()); }}>لا شيء</button>
            </>}
          >
            <OwnerTile
              active={branchOwned}
              onClick={() => setBranchOwned(v => !v)}
              avatar={<Building2 className="w-4 h-4" />}
              name="ملكية الفرع"
              sub="كل المهام عدا عروض الموظفين"
              count={branchCount}
              tone="sky"
            />
            <div className="mt-3 mb-1.5 flex items-center justify-between text-[11px] font-bold text-slate-400">
              <span>ملكية الموظفين — عروض الأجهزة</span>
              {owners.length > 0 && <span>{selectedOwners.length} من {owners.length}</span>}
            </div>
            {owners.length === 0 && <p className="text-xs text-slate-400">لا عروض مملوكة لموظفين في هذا اليوم.</p>}
            {owners.length > 6 && (
              <div className="relative mb-1.5">
                <Search className="absolute right-2 top-1.5 w-3.5 h-3.5 text-slate-400" />
                <input
                  value={ownerSearch}
                  onChange={e => setOwnerSearch(e.target.value)}
                  placeholder="ابحث عن موظف أو دور"
                  className="w-full rounded-lg border border-slate-200 py-1 pr-7 pl-2 text-xs"
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {shownOwners.map(o => (
                <OwnerTile
                  key={o.hrUserId}
                  active={ownerIds.has(o.hrUserId)}
                  onClick={() => toggleOwner(o.hrUserId)}
                  avatar={o.name.trim().charAt(0)}
                  name={o.name}
                  sub={o.roleName ?? '—'}
                  count={ownerCounts[o.hrUserId] ?? 0}
                  tone="violet"
                />
              ))}
              {owners.length > 0 && shownOwners.length === 0 && <p className="text-xs text-slate-400">لا نتائج.</p>}
            </div>
          </Card>

          <Card
            icon={<RouteIcon className="w-4 h-4 text-sky-600" />}
            title="خطوط السير"
            className="flex flex-col xl:flex-1 xl:min-h-0"
            actions={
              <label className="flex items-center gap-1 text-slate-500 font-normal cursor-pointer">
                <input type="checkbox" checked={showRoutes} onChange={e => setShowRoutes(e.target.checked)} className="accent-sky-600" />
                إظهار الكل
              </label>
            }
          >
            <RouteOption active={routeId == null} onClick={() => setRouteId(null)}>كل مناطق الفرع</RouteOption>
            <div className="max-h-56 overflow-y-auto xl:max-h-none xl:flex-1 xl:min-h-0">
              {[...routeRows].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(r => (
                <RouteOption key={r.routeId} active={routeId === r.routeId} onClick={() => setRouteId(r.routeId)} count={r.total.visitCount}>
                  {r.name}
                </RouteOption>
              ))}
            </div>
            {routeRows.length === 0 && <p className="text-xs text-slate-400">لا خطوط سير ضمن تغطية الفرع.</p>}
          </Card>
        </div>

        {/* Map */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 relative h-[440px] xl:h-[640px]">
          <ZoneMapCanvas
            pins={pins}
            lines={lines}
            selectedId={selectedArea}
            onSelect={setSelectedArea}
            onPlace={placing != null ? handlePlace : null}
            fitKey={`${loadSeq}|${routeId ?? ''}`}
          />
          {placing != null && (
            <div className="absolute top-4 right-4 left-4 z-[1000] rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-bold text-amber-800 flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> انقر على الخريطة لتحديد مركز «{geo.label(placing)}»
              <button type="button" className="mr-auto text-amber-700" onClick={() => setPlacing(null)}><X className="w-4 h-4" /></button>
            </div>
          )}
          {activeRoute && placing == null && (
            <div className="absolute top-4 left-4 z-[1000] w-72 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm">
              <p className="mb-1 flex items-center gap-1 font-bold text-slate-800">
                <RouteIcon className="w-3.5 h-3.5 text-orange-600" /> {activeRoute.name}
              </p>
              {!canRoad ? (
                <p className="text-slate-500">
                  {hasGoogleMapsKey() ? 'يلزم محطتان لهما مركز على الأقل لحساب المسار.' : 'حساب المسار على الطرق يحتاج خرائط Google.'}
                </p>
              ) : currentRoad ? (
                <>
                  <p className="font-bold text-slate-700">على الطرق: {formatDistance(currentRoad.distanceMeters)} · {formatDuration(currentRoad.durationSec)} قيادة</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    أقصر مسار بلا ازدحام بين مراكز المحطات{activeStraight.length < activeRoute.stations.length ? ' — المحطات التي بلا مركز غير داخلة' : ''}.
                  </p>
                  <button type="button" onClick={() => setRoad(null)} className="mt-1 font-bold text-slate-500 hover:text-slate-700">عرض الخط المستقيم</button>
                </>
              ) : roadLoading ? (
                <p className="flex items-center gap-1 text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ حساب المسار على الطرق…</p>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-slate-500">{roadError ? `تعذّر الحساب: ${roadError}` : 'الخط الظاهر مستقيم بين المحطات.'}</p>
                  <button type="button" onClick={() => void computeRoad()}
                    className="shrink-0 rounded-lg bg-orange-600 px-2.5 py-1 font-bold text-white hover:bg-orange-500">
                    {roadError ? 'إعادة المحاولة' : 'ارسم المسار'}
                  </button>
                </div>
              )}
            </div>
          )}
          {!loading && pins.length === 0 && placing == null && (
            <div className="absolute inset-x-6 bottom-6 z-[1000] rounded-lg bg-white/95 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              لا دبابيس على الخريطة: المناطق التي فيها شغل لم يُحدَّد مركزها بعد. حدّدها من تبويب «بلا مركز».
            </div>
          )}
        </div>

        {/* Area panel: the selected area's work, or the areas still without a center */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 text-sm flex flex-col max-h-[640px] xl:h-[640px]">
          <div className="p-2 border-b border-slate-100">
            <div className="grid grid-cols-2 rounded-lg bg-slate-50 p-0.5 text-xs font-bold">
              <button type="button" onClick={() => setPanelTab('detail')}
                className={`rounded-lg px-2 py-1.5 ${panelTab === 'detail' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500'}`}>
                مهام المنطقة
              </button>
              <button type="button" onClick={() => setPanelTab('missing')}
                className={`rounded-lg px-2 py-1.5 ${panelTab === 'missing' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500'}`}>
                بلا مركز{missingCenters.length > 0 && <span className="mr-1 rounded-full bg-amber-100 px-1.5 text-amber-700">{missingCenters.length}</span>}
              </button>
            </div>
          </div>
          <div className="p-4 overflow-y-auto flex-1">
          {panelTab === 'detail' ? (detailRow ? (
            <div>
              <div className="flex items-center justify-between mb-1">
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
                    {detailRow.geoUnitId == null && v.geoUnitId != null && (
                      <p className="text-xs text-amber-700">عنوان ناقص: {geo.label(v.geoUnitId)} — بلا حي</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.tasks.map(t => {
                        const path = getOpenTaskDetailPath(t.taskType, t.taskId);
                        const owner = t.ownerHrUserIds.map(id => ownerName.get(id)).filter(Boolean).join('، ');
                        const label = `${t.taskLabel}${t.deviceLabel ? ` · ${t.deviceLabel}` : ''}${owner ? ` · ${owner}` : ''}${t.overdue ? ' · متأخرة' : ''}`;
                        const cls = `rounded px-1.5 py-0.5 text-xs ${t.overdue ? 'bg-rose-50 text-rose-700' : owner ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`;
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
            <div className="py-10 text-center text-xs text-slate-400">
              <MapPin className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              اختر منطقة من الخريطة أو من الجدول لعرض زبائنها ومهامهم.
              {noAreaRow && noAreaRow.visitCount > 0 && (
                <button type="button" className="mt-4 block w-full text-xs font-bold text-rose-600" onClick={() => setSelectedArea(NO_AREA)}>
                  {noAreaRow.visitCount} زيارة بدون منطقة — بلا عنوان أو على ناحية بلا حيها
                </button>
              )}
            </div>
          )) : (
            <div>
              <p className="font-bold text-slate-700 mb-1">
                {activeRoute ? `محطات «${activeRoute.name}» بلا مركز` : 'مناطق فيها شغل بلا مركز'}
              </p>
              <p className="text-xs text-slate-400 mb-3">
                {activeRoute
                  ? `${activeRoute.stations.length - missingCenters.length} من ${activeRoute.stations.length} محطة لها مركز. يُرسم الخط بين المحطات التي لها مركز فقط.`
                  : 'لا دبوس لها على الخريطة، وتظهر في الجدول بكل الأحوال.'}
              </p>
              {missingCenters.length === 0 && (
                <p className="text-xs text-slate-400">{activeRoute ? 'كل محطات الخط لها مركز.' : 'كل المناطق المعروضة لها مركز.'}</p>
              )}
              <ul className="space-y-0.5">
                {missingCenters.map(r => (
                  <li key={r.geoUnitId} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                    <button type="button" className="min-w-0 truncate text-slate-700 hover:text-sky-600 text-right" onClick={() => setSelectedArea(r.geoUnitId)}>
                      {r.name} <span className="text-xs text-slate-400">({r.visitCount})</span>
                    </button>
                    {canPlace && (
                      <button type="button" onClick={() => setPlacing(r.geoUnitId)} className="shrink-0 text-xs font-bold text-sky-600 inline-flex items-center gap-1">
                        <Crosshair className="w-3.5 h-3.5" /> تحديد
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Table: three views of the same filtered picture */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
        <div className="flex items-end gap-1 border-b border-slate-200 px-3 pt-2">
          {([
            ['areas', 'النطاقات المؤهلة', shownAreaRows.length],
            ['routes', 'استكشاف النطاقات', shownRouteRows.length],
            ['tasks', 'عرض المهام', taskRows.length],
          ] as [View, string, number][]).map(([v, label, n]) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${view === v ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {label}
              <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${view === v ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
            </button>
          ))}
          {view === 'tasks' && activeRoute && (
            <span className="mr-auto mb-2 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700">
              مهام محطات «{activeRoute.name}» فقط
            </span>
          )}
        </div>
        {view === 'tasks' ? (
          <>
            <ZoneMapTaskTable
              rows={taskRows}
              selectedStation={selectedArea}
              noArea={NO_AREA}
              onSelectStation={setSelectedArea}
              ownerName={ownerName}
            />
            {!loading && taskRows.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">لا مهام بهذه الفلاتر في يوم التخطيط.</p>
            )}
          </>
        ) : (<>
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
              <DataTable.Th>{view === 'areas' ? 'المنطقة' : 'المسار'}</DataTable.Th>
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
        </>)}
      </div>

      <p className="mt-3 text-xs text-slate-400 leading-relaxed">
        <span className="font-bold">قراءة الأرقام:</span> الزيارة = زبون في موقع عمل واحد، تُعدّ مرة مهما تعددت مهامه. أعمدة الأنواع تعدّ الزبائن (أو الأجهزة لمهام الجهاز) لكل نوع، لذلك لا يساوي مجموعها عدد الزيارات — عمود «مشتركة» يبيّن الزيارات التي تجمع أكثر من نوع. الطلبات لا تدخل في الزيارات لأنها لم تتحول لمهام بعد. المهام المؤهلة ليوم التخطيط فقط.
      </p>
    </div>
  );
}
