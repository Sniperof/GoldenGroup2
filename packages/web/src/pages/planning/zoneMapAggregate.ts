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
  { key: 'emergency', label: 'طارئة' },
  { key: 'collection', label: 'ذمة' },
  { key: 'retrieved_return', label: 'إعادة مسحوب' },
  { key: 'gift', label: 'تسليم هدية' },
  { key: 'golden_warranty', label: 'كفالة ذهبية' },
  { key: 'periodic', label: 'صيانة دورية' },
  { key: 'demo', label: 'عرض جهاز' },
  { key: 'other', label: 'أخرى' },
];

export const REQUEST_COLUMNS: { key: ZoneMapColumnKey; label: string }[] = [
  { key: 'request_device', label: 'طلب جهاز' },
  { key: 'request_water_check', label: 'طلب فحص مياه' },
  { key: 'request_periodic', label: 'طلب دورية' },
];

export type GroupLevel = 3 | 4;

export interface ZoneMapFilters {
  columns: Set<ZoneMapColumnKey>;
  // Device demos: the branch's own (no personal owner) and/or specific owners.
  demoBranch: boolean;
  demoOwnerIds: Set<number>;
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
  if (task.column !== 'demo') return true;
  if (task.ownerHrUserIds.length === 0) return f.demoBranch;
  return task.ownerHrUserIds.some(id => f.demoOwnerIds.has(id));
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

  // The unit at `level` that contains `id`; a unit coarser than `level` stays itself.
  groupAt(id: number, level: GroupLevel): number {
    const chain = this.ancestorsOrSelf(id);
    return chain.find(x => this.byId.get(x)?.level === level) ?? id;
  }

  // Station covers an area when it is the area or one of its ancestors.
  covers(stationId: number, id: number): boolean {
    return this.ancestorsOrSelf(id).includes(stationId);
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
    visitCount: 0, sharedVisitCount: 0, columnCounts: {}, demoBranchCount: 0, demoByOwner: {},
  };
}

// Fill counts from the raw tasks/requests gathered into a row.
function finalizeRow(row: AreaRow, tasks: ZoneMapTaskItem[], requests: ZoneMapRequestItem[]): AreaRow {
  const visits = new Map<string, VisitGroup>();
  const perColumn = new Map<ZoneMapColumnKey, Set<string>>();
  const demoBranch = new Set<number>();
  const demoOwner = new Map<number, Set<number>>();
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
      if (t.ownerHrUserIds.length === 0) demoBranch.add(t.clientId);
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
  demoOwner.forEach((set, id) => { row.demoByOwner[id] = set.size; });
  return row;
}

export function aggregateAreas(
  data: ZoneMapResponse,
  geo: GeoIndex,
  filters: ZoneMapFilters,
  level: GroupLevel,
): AreaRow[] {
  const tasksBy = new Map<number | null, ZoneMapTaskItem[]>();
  const reqsBy = new Map<number | null, ZoneMapRequestItem[]>();
  data.tasks.filter(t => taskPassesFilters(t, filters)).forEach(t => {
    const g = t.geoUnitId == null ? null : geo.groupAt(t.geoUnitId, level);
    if (!tasksBy.has(g)) tasksBy.set(g, []);
    tasksBy.get(g)!.push(t);
  });
  data.requests.filter(r => filters.columns.has(r.column)).forEach(r => {
    const g = r.geoUnitId == null ? null : geo.groupAt(r.geoUnitId, level);
    if (!reqsBy.has(g)) reqsBy.set(g, []);
    reqsBy.get(g)!.push(r);
  });
  const keys = new Set<number | null>([...tasksBy.keys(), ...reqsBy.keys()]);
  return [...keys].map(g => finalizeRow(
    emptyRow(g, geo.name(g), g == null ? null : geo.byId.get(g)?.center ?? null),
    tasksBy.get(g) ?? [],
    reqsBy.get(g) ?? [],
  ));
}

export function aggregateRoutes(data: ZoneMapResponse, geo: GeoIndex, filters: ZoneMapFilters): RouteRow[] {
  const tasks = data.tasks.filter(t => taskPassesFilters(t, filters) && t.geoUnitId != null);
  const requests = data.requests.filter(r => filters.columns.has(r.column) && r.geoUnitId != null);
  return data.routes.map(route => {
    const stations = route.stationGeoUnitIds.map(sid => {
      const st = tasks.filter(t => geo.covers(sid, t.geoUnitId!));
      const sr = requests.filter(r => geo.covers(sid, r.geoUnitId!));
      return {
        geoUnitId: sid,
        name: geo.name(sid),
        center: geo.byId.get(sid)?.center ?? null,
        row: finalizeRow(emptyRow(sid, geo.name(sid), geo.byId.get(sid)?.center ?? null), st, sr),
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

// Routes containing an area: a station that is the area, an ancestor of it,
// or inside it.
export function routeContainsArea(stationIds: number[], areaId: number, geo: GeoIndex): boolean {
  const inside = geo.descendantsOrSelf(areaId);
  return stationIds.some(s => inside.has(s) || geo.covers(s, areaId));
}
