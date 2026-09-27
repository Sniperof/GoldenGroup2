// Pure segment model for the team work-scope builder (RouteAssigner).
//
// A day is an ORDERED list of segments: a slice of a saved route (start → end
// station; start after end = «إياب») or a single extra zone. It serializes to
// the persisted { routes, extraZones, stationOrder } shape and is rebuilt from
// it, so the API contract is unchanged.

export type SegmentZone = { id: number; name: string; level: number };

export type SegmentRoute = {
    id: number;
    points: { geoUnitId: number; order: number; level: number }[];
};

export type SegmentGeoUnit = { id: number; name: string; level: number };

export type PersistedComposition = {
    routeId: number;
    startIdx: number;
    endIdx: number;
    direction: 'forward' | 'reverse' | string;
};

export type PersistedScope = {
    routes?: PersistedComposition[];
    extraZones?: number[];
    stationOrder?: number[];
};

/** startIdx/endIdx index the route's ordered points; start > end means «إياب». */
export type RouteSegment = { kind: 'route'; key: string; routeId: number; startIdx: number; endIdx: number };
export type ZoneSegment = { kind: 'zone'; key: string; zoneId: number };
export type Segment = RouteSegment | ZoneSegment;

let segmentKeySeq = 0;
export const newSegmentKey = () => `seg-${++segmentKeySeq}`;

export function normalizeStationOrder(order: number[] | undefined, finalZoneIds: number[]): number[] {
    const validIds = new Set(finalZoneIds);
    const normalized = (order || []).filter(id => validIds.has(id));
    finalZoneIds.forEach(id => {
        if (!normalized.includes(id)) normalized.push(id);
    });
    return normalized;
}

export function routeStations(route: SegmentRoute, geoUnits: SegmentGeoUnit[]): SegmentZone[] {
    return [...route.points].sort((a, b) => a.order - b.order).map(p => {
        const unit = geoUnits.find(u => u.id === p.geoUnitId);
        return unit ? { id: unit.id, name: unit.name, level: p.level } : { id: p.geoUnitId, name: '??', level: p.level };
    });
}

/** Stations of one segment, in its travel direction. */
export function segmentStations(segment: Segment, routes: SegmentRoute[], geoUnits: SegmentGeoUnit[]): SegmentZone[] {
    if (segment.kind === 'zone') {
        const unit = geoUnits.find(u => u.id === segment.zoneId);
        return unit ? [{ id: unit.id, name: unit.name, level: unit.level }] : [];
    }
    const route = routes.find(r => r.id === segment.routeId);
    if (!route) return [];
    const stations = routeStations(route, geoUnits);
    const lo = Math.min(segment.startIdx, segment.endIdx);
    const hi = Math.max(segment.startIdx, segment.endIdx);
    const slice = stations.slice(lo, hi + 1);
    return segment.startIdx <= segment.endIdx ? slice : slice.reverse();
}

/** Station order implied by the segments (first occurrence wins). */
export function segmentOrder(segments: Segment[], routes: SegmentRoute[], geoUnits: SegmentGeoUnit[]): number[] {
    const seen = new Set<number>();
    const order: number[] = [];
    segments.forEach(seg => segmentStations(seg, routes, geoUnits).forEach(z => {
        if (!seen.has(z.id)) { seen.add(z.id); order.push(z.id); }
    }));
    return order;
}

export function toPersisted(segments: Segment[]): {
    routes: { routeId: number; startIdx: number; endIdx: number; direction: 'forward' | 'reverse' }[];
    extraZones: number[];
} {
    const routes = segments
        .filter((s): s is RouteSegment => s.kind === 'route')
        .map(s => ({
            routeId: s.routeId,
            startIdx: Math.min(s.startIdx, s.endIdx),
            endIdx: Math.max(s.startIdx, s.endIdx),
            direction: s.startIdx <= s.endIdx ? 'forward' as const : 'reverse' as const,
        }));
    const extraZones = segments.filter((s): s is ZoneSegment => s.kind === 'zone').map(s => s.zoneId);
    return { routes, extraZones };
}

/**
 * Rebuild ordered segments from a saved scope. Each segment is placed where its
 * first station is visited in the saved order; if the saved order isn't the one
 * the segments imply, it is returned as `custom` (advanced free order).
 */
export function fromPersisted(
    saved: PersistedScope | undefined,
    routes: SegmentRoute[],
    geoUnits: SegmentGeoUnit[],
): { segments: Segment[]; custom: number[] | null } {
    if (!saved) return { segments: [], custom: null };
    const routeSegs: Segment[] = (saved.routes || []).map(comp => ({
        kind: 'route' as const,
        key: newSegmentKey(),
        routeId: Number(comp.routeId),
        startIdx: comp.direction === 'reverse' ? Number(comp.endIdx) : Number(comp.startIdx),
        endIdx: comp.direction === 'reverse' ? Number(comp.startIdx) : Number(comp.endIdx),
    }));
    const zoneSegs: Segment[] = (saved.extraZones || []).map(zoneId => ({ kind: 'zone' as const, key: newSegmentKey(), zoneId: Number(zoneId) }));
    const all = [...routeSegs, ...zoneSegs];
    const allIds = segmentOrder(all, routes, geoUnits);
    const savedOrder = normalizeStationOrder((saved.stationOrder || []).map(Number), allIds);
    const position = new Map(savedOrder.map((id, i) => [id, i]));
    const anchor = (seg: Segment) => {
        const ids = segmentStations(seg, routes, geoUnits).map(z => z.id).filter(id => position.has(id));
        return ids.length ? Math.min(...ids.map(id => position.get(id)!)) : Number.MAX_SAFE_INTEGER;
    };
    // Stable sort keeps the saved route/zone order for ties.
    const segments = all
        .map((seg, i) => ({ seg, i, a: anchor(seg) }))
        .sort((x, y) => x.a - y.a || x.i - y.i)
        .map(x => x.seg);
    const implied = segmentOrder(segments, routes, geoUnits);
    const custom = JSON.stringify(implied) === JSON.stringify(savedOrder) ? null : savedOrder;
    return { segments, custom };
}

/** Canonical form of a route list (jsonb reorders object keys — never stringify raw objects). */
export function canonicalRoutes(routes: PersistedComposition[]): string {
    return JSON.stringify(
        [...routes]
            .map(r => [Number(r.routeId), Number(r.startIdx), Number(r.endIdx), r.direction === 'reverse' ? 'reverse' : 'forward'])
            .sort((a, b) => (a[0] as number) - (b[0] as number)),
    );
}

/** True when the edited scope equals the saved one (order of routes/zones lists is irrelevant). */
export function matchesSaved(
    saved: PersistedScope | undefined,
    current: { routes: PersistedComposition[]; extraZones: number[]; order: number[] },
    finalZoneIds: number[],
): boolean {
    if (!saved) return false;
    const sameRoutes = canonicalRoutes(saved.routes || []) === canonicalRoutes(current.routes);
    const sortNums = (xs: number[]) => JSON.stringify([...xs].map(Number).sort((a, b) => a - b));
    const sameZones = sortNums(saved.extraZones || []) === sortNums(current.extraZones);
    const sameOrder = JSON.stringify(normalizeStationOrder((saved.stationOrder || []).map(Number), finalZoneIds))
        === JSON.stringify(current.order);
    return sameRoutes && sameZones && sameOrder;
}
