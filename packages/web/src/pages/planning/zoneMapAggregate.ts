import type {
  ZoneMapArea,
  ZoneMapColumnKey,
  ZoneMapRequestItem,
  ZoneMapResponse,
  ZoneMapTaskItem,
} from '@golden-crm/shared';

// Pure aggregation for the zone map study — no React, no DOM.
// Unit of load is the VISIT: one client at one work location. A client with
// an emergency and a collection at the same place is one visit; the type
// columns count clients (or devices, for device-bound tasks) per type, so the
// type columns do not add up to the visit total — the «shared» count says how
// many visits carry more than one type.

export const TASK_COLUMNS: { key: ZoneMapColumnKey; label: string }[] = [
  { key: 'collection', label: 'تحصيل ذمة' },
  { key: 'emergency', label: 'طارئة' },
  { key: 'periodic', label: 'دورية' },
  { key: 'demo', label: 'عرض جهاز' },
  { key: 'gift', label: 'تسليم هدية' },
  { key: 'golden_warranty', label: 'عرض كفالة' },
  { key: 'warranty_card', label: 'تسليم بطاقة كفالة' },
  { key: 'delivery', label: 'تسليم' },
  { key: 'installation', label: 'تركيب' },
  { key: 'activation', label: 'تشغيل' },
  { key: 'retrieval', label: 'سحب' },
  { key: 'disconnection', label: 'فك' },
  { key: 'return', label: 'إرجاع' },
  // Any type outside the list (e.g. device_transfer); shown only when present.
  { key: 'other', label: 'أخرى' },
];

export const REQUEST_COLUMNS: { key: ZoneMapColumnKey; label: string }[] = [
  { key: 'request_device', label: 'طلب جهاز' },
  { key: 'request_water_check', label: 'طلب فحص مياه' },
  { key: 'request_periodic', label: 'طلب دورية' },
];

export interface ZoneMapFilters {
  columns: Set<ZoneMapColumnKey>;
  // Ownership: only a device demo can belong to an employee; every other task,
  // and a demo with no personal owner, belongs to the branch.
  branchOwned: boolean;
  ownerIds: Set<number>;
}

export interface VisitGroup {
  key: string;
  clientId: number;
  clientName: string;
  geoUnitId: number | null;
  tasks: ZoneMapTaskItem[];
}

export interface AreaRow {
  geoUnitId: number | null; // null = tasks with no known area
  name: string;
  center: { lat: number; lng: number } | null;
  visits: VisitGroup[];
  requests: ZoneMapRequestItem[];
  visitCount: number;
  sharedVisitCount: number;
  columnCounts: Partial<Record<ZoneMapColumnKey, number>>;
  demoBranchCount: number;
  demoOwnedCount: number; // clients with a demo owned by any (filtered-in) employee
  demoByOwner: Record<number, number>;
}

export interface RouteRow {
  routeId: number;
  name: string;
  stations: { geoUnitId: number; name: string; center: { lat: number; lng: number } | null; row: AreaRow }[];
  total: AreaRow;
}

export function taskPassesFilters(task: ZoneMapTaskItem, f: ZoneMapFilters): boolean {
  if (!f.columns.has(task.column)) return false;
  return isBranchOwned(task)
    ? f.branchOwned
    : task.ownerHrUserIds.some(id => f.ownerIds.has(id));
}

export function isBranchOwned(task: ZoneMapTaskItem): boolean {
  return task.column !== 'demo' || task.ownerHrUserIds.length === 0;
}

export class GeoIndex {
  readonly byId: Map<number, ZoneMapArea>;
  private readonly childrenOf = new Map<number, number[]>();

  constructor(areas: ZoneMapArea[]) {
    this.byId = new Map(areas.map(a => [a.geoUnitId, a]));
    areas.forEach(a => {
      if (a.parentId == null) return;
      const list = this.childrenOf.get(a.parentId) ?? [];
      list.push(a.geoUnitId);
      this.childrenOf.set(a.parentId, list);
    });
  }

  ancestorsOrSelf(id: number): number[] {
    const out: number[] = [];
    let cur: number | null | undefined = id;
    const guard = new Set<number>();
    while (cur != null && !guard.has(cur)) {
      guard.add(cur);
      out.push(cur);
      cur = this.byId.get(cur)?.parentId;
    }
    return out;
  }

  // The study's unit is the lowest administrative level: a حي, or a ناحية that
  // has no أحياء. Work recorded on a unit that has children (a ناحية without
  // its حي) is an incomplete address → null, the no-area row.
  leafOf(id: number | null): number | null {
    if (id == null) return null;
    return this.byId.get(id)?.hasChildren ? null : id;
  }

  // A حي reads with its ناحية: «القصور (مدينة بانياس)».
  label(id: number | null): string {
    if (id == null) return this.name(null);
    const unit = this.byId.get(id);
    const parent = unit?.parentId != null ? this.byId.get(unit.parentId) : undefined;
    return unit && unit.level >= 4 && parent ? `${unit.name} (${parent.name})` : this.name(id);
  }

  descendantsOrSelf(id: number): Set<number> {
    const out = new Set<number>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      (this.childrenOf.get(cur) ?? []).forEach(c => { if (!out.has(c)) { out.add(c); stack.push(c); } });
    }
    return out;
  }

  name(id: number | null): string {
    if (id == null) return 'بدون منطقة';
    return this.byId.get(id)?.name ?? `#${id}`;
  }
}

function emptyRow(geoUnitId: number | null, name: string, center: AreaRow['center']): AreaRow {
  return {
    geoUnitId, name, center, visits: [], requests: [],
    visitCount: 0, sharedVisitCount: 0, columnCounts: {}, demoBranchCount: 0, demoOwnedCount: 0, demoByOwner: {},
  };
}

// Fill counts from the raw tasks/requests gathered into a row.
function finalizeRow(row: AreaRow, tasks: ZoneMapTaskItem[], requests: ZoneMapRequestItem[]): AreaRow {
  const visits = new Map<string, VisitGroup>();
  const perColumn = new Map<ZoneMapColumnKey, Set<string>>();
  const demoBranch = new Set<number>();
  const demoOwner = new Map<number, Set<number>>();
  const demoOwned = new Set<number>();
  tasks.forEach(t => {
    const vKey = `${t.clientId}|${t.geoUnitId ?? 'x'}`;
    if (!visits.has(vKey)) {
      visits.set(vKey, { key: vKey, clientId: t.clientId, clientName: t.clientName, geoUnitId: t.geoUnitId, tasks: [] });
    }
    visits.get(vKey)!.tasks.push(t);
    const unitKey = t.countsBy === 'device' ? `d${t.deviceId ?? `t${t.taskId}`}` : `c${t.clientId}`;
    if (!perColumn.has(t.column)) perColumn.set(t.column, new Set());
    perColumn.get(t.column)!.add(unitKey);
    if (t.column === 'demo') {
      if (t.ownerHrUserIds.length === 0) demoBranch.add(t.clientId); else demoOwned.add(t.clientId);
      t.ownerHrUserIds.forEach(id => {
        if (!demoOwner.has(id)) demoOwner.set(id, new Set());
        demoOwner.get(id)!.add(t.clientId);
      });
    }
  });
  const reqPerColumn = new Map<ZoneMapColumnKey, number>();
  requests.forEach(r => reqPerColumn.set(r.column, (reqPerColumn.get(r.column) ?? 0) + 1));

  row.visits = [...visits.values()].sort((a, b) => b.tasks.length - a.tasks.length || a.clientName.localeCompare(b.clientName, 'ar'));
  row.requests = requests;
  row.visitCount = visits.size;
  row.sharedVisitCount = row.visits.filter(v => new Set(v.tasks.map(t => t.column)).size > 1).length;
  perColumn.forEach((set, key) => { row.columnCounts[key] = set.size; });
  reqPerColumn.forEach((n, key) => { row.columnCounts[key] = n; });
  row.demoBranchCount = demoBranch.size;
  row.demoOwnedCount = demoOwned.size;
  demoOwner.forEach((set, id) => { row.demoByOwner[id] = set.size; });
  return row;
}

export function aggregateAreas(
  data: ZoneMapResponse,
  geo: GeoIndex,
  filters: ZoneMapFilters,
): AreaRow[] {
  const tasksBy = new Map<number | null, ZoneMapTaskItem[]>();
  const reqsBy = new Map<number | null, ZoneMapRequestItem[]>();
  data.tasks.filter(t => taskPassesFilters(t, filters)).forEach(t => {
    const g = geo.leafOf(t.geoUnitId);
    if (!tasksBy.has(g)) tasksBy.set(g, []);
    tasksBy.get(g)!.push(t);
  });
  data.requests.filter(r => filters.columns.has(r.column)).forEach(r => {
    const g = geo.leafOf(r.geoUnitId);
    if (!reqsBy.has(g)) reqsBy.set(g, []);
    reqsBy.get(g)!.push(r);
  });
  const keys = new Set<number | null>([...tasksBy.keys(), ...reqsBy.keys()]);
  return [...keys].map(g => finalizeRow(
    emptyRow(g, geo.label(g), g == null ? null : geo.byId.get(g)?.center ?? null),
    tasksBy.get(g) ?? [],
    reqsBy.get(g) ?? [],
  ));
}

// Station matching is LITERAL, as in planning (RouteManager): a station serves
// work recorded on exactly that unit. A ناحية station does not pull its أحياء —
// each حي to be visited is its own station.
export function aggregateRoutes(data: ZoneMapResponse, geo: GeoIndex, filters: ZoneMapFilters): RouteRow[] {
  const tasks = data.tasks.filter(t => taskPassesFilters(t, filters) && t.geoUnitId != null);
  const requests = data.requests.filter(r => filters.columns.has(r.column) && r.geoUnitId != null);
  return data.routes.map(route => {
    const stations = route.stationGeoUnitIds.map(sid => {
      const st = tasks.filter(t => t.geoUnitId === sid);
      const sr = requests.filter(r => r.geoUnitId === sid);
      return {
        geoUnitId: sid,
        name: geo.label(sid),
        center: geo.byId.get(sid)?.center ?? null,
        row: finalizeRow(emptyRow(sid, geo.label(sid), geo.byId.get(sid)?.center ?? null), st, sr),
      };
    });
    const allTasks = new Map<number, ZoneMapTaskItem>();
    const allReqs = new Map<number, ZoneMapRequestItem>();
    stations.forEach(s => {
      s.row.visits.forEach(v => v.tasks.forEach(t => allTasks.set(t.taskId, t)));
      s.row.requests.forEach(r => allReqs.set(r.requestId, r));
    });
    return {
      routeId: route.id,
      name: route.name,
      stations,
      total: finalizeRow(emptyRow(null, route.name, null), [...allTasks.values()], [...allReqs.values()]),
    };
  });
}

// Routes passing through an area (route search): a station that is the area
// itself or a unit inside it. A ناحية station does not pass through its أحياء
// (literal matching), so searching one of those أحياء does not find it.
export function routeContainsArea(stationIds: number[], areaId: number, geo: GeoIndex): boolean {
  const inside = geo.descendantsOrSelf(areaId);
  return stationIds.some(s => inside.has(s));
}

// «عرض المهام»: one row per task, in the branch's working priority. Types not
// in the list (gift, golden warranty, other) follow, in TASK_COLUMNS order.
export const TASK_PRIORITY: ZoneMapColumnKey[] = [
  'collection', 'emergency', 'periodic', 'return', 'delivery',
  'demo', 'activation', 'installation', 'retrieval', 'disconnection',
];

export interface TaskListRow {
  task: ZoneMapTaskItem;
  station: string;      // the task's area (lowest level), or «بدون منطقة»
  stationId: number | null;
  routeNames: string[]; // routes with that exact area as a station (literal matching)
  daysLate: number;     // vs the planning day; 0 when not late
}

function priorityRank(column: ZoneMapColumnKey): number {
  const i = TASK_PRIORITY.indexOf(column);
  return i >= 0 ? i : TASK_PRIORITY.length + TASK_COLUMNS.findIndex(c => c.key === column);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function listTasks(
  data: ZoneMapResponse,
  geo: GeoIndex,
  filters: ZoneMapFilters,
  onlyStations?: number[] | null,
): TaskListRow[] {
  const stations = onlyStations ? new Set(onlyStations) : null;
  const routesAt = new Map<number, string[]>();
  data.routes.forEach(r => r.stationGeoUnitIds.forEach(id => {
    const list = routesAt.get(id) ?? [];
    if (!list.includes(r.name)) list.push(r.name);
    routesAt.set(id, list);
  }));
  return data.tasks
    .filter(t => taskPassesFilters(t, filters))
    .filter(t => !stations || (t.geoUnitId != null && stations.has(t.geoUnitId)))
    .map(t => {
      const stationId = geo.leafOf(t.geoUnitId);
      const dueRef = t.status === 'needs_follow_up' ? t.followUpDate : (t.dueDate ?? t.followUpDate);
      return {
        task: t,
        stationId,
        station: stationId == null ? geo.name(null) : geo.label(stationId),
        routeNames: t.geoUnitId == null ? [] : routesAt.get(t.geoUnitId) ?? [],
        daysLate: dueRef ? Math.max(0, daysBetween(dueRef, data.date)) : 0,
      };
    })
    .sort((a, b) =>
      priorityRank(a.task.column) - priorityRank(b.task.column)
      || b.daysLate - a.daysLate
      || a.task.taskId - b.task.taskId);
}
