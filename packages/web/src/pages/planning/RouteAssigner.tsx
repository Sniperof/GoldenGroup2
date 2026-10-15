import { useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
    Users, Save, Plus, MapPin, Route as RouteIcon, X, Loader2, RefreshCw, Lock, ChevronUp, ChevronDown,
    RotateCcw, AlertTriangle, CheckCircle2, CalendarDays, Info, Flag, FlagOff, Move, Copy, Layers,
    ChevronLeft, ChevronRight,
} from '../../components/ui/icons';
import { api } from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import GeoSmartSearch, { type GeoSelection } from '../../components/GeoSmartSearch';
import Select from '../../components/ui/Select';
import DateField from '../../components/ui/DateField';
import IconButton from '../../components/ui/IconButton';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Toggle from '../../components/ui/Toggle';
import type { Route, GeoUnit, DaySchedule, RouteAssignmentData } from '../../lib/types';
import {
    normalizeStationOrder, newSegmentKey, routeStations, segmentStations as segmentStationsOf,
    segmentOrder as segmentOrderOf, toPersisted, fromPersisted as fromPersistedOf, matchesSaved,
    type Segment, type RouteSegment, type SegmentZone,
} from './routeSegments';

// ─────────────────────────────────────────────────────────────────────────────
// Team work scope = an ORDERED list of segments. A segment is either a slice of
// a saved route (start → end station; direction follows from start/end) or a
// single extra zone. Segment order is the visit order. Free station dragging is
// an opt-in "advanced" mode that stores an explicit custom order on top.
//
// Persistence is unchanged: segments serialize to the existing
// { routes (composition), extraZones, stationOrder } shape and are rebuilt from
// it on load, so the API, planning, freeze and counts logic stay as they are.
// ─────────────────────────────────────────────────────────────────────────────

// Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

type MarketingTargetsResponse = {
    teamKey: string;
    countsByZone?: { zoneId: number; count: number }[];
    counts: { total: number };
    reason?: string | null;
};

/** Saved assignment + server flag: contacts already generated → append-only (DEC-009 لبنة 8). */
type AssignmentState = RouteAssignmentData & { generated?: boolean };

type Zone = SegmentZone;

type PlanStatus = 'none' | 'new' | 'dirty' | 'saved' | 'frozen';

const UNSAVED_CONFIRM = 'لديك تغييرات غير محفوظة على نطاق عمل هذا الفريق. هل تريد تجاهلها؟';

// Full class strings (Tailwind can't see interpolated names).
const SEGMENT_COLORS = [
    { bar: 'border-s-sky-500', dot: 'bg-sky-500', soft: 'bg-sky-50 text-sky-800 border-sky-200', num: 'bg-sky-600' },
    { bar: 'border-s-violet-500', dot: 'bg-violet-500', soft: 'bg-violet-50 text-violet-800 border-violet-200', num: 'bg-violet-600' },
    { bar: 'border-s-orange-500', dot: 'bg-orange-500', soft: 'bg-orange-50 text-orange-800 border-orange-200', num: 'bg-orange-600' },
    { bar: 'border-s-emerald-500', dot: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-800 border-emerald-200', num: 'bg-emerald-600' },
    { bar: 'border-s-pink-500', dot: 'bg-pink-500', soft: 'bg-pink-50 text-pink-800 border-pink-200', num: 'bg-pink-600' },
    { bar: 'border-s-amber-500', dot: 'bg-amber-500', soft: 'bg-amber-50 text-amber-800 border-amber-200', num: 'bg-amber-600' },
];
const colorOf = (index: number) => SEGMENT_COLORS[index % SEGMENT_COLORS.length];

export default function RouteAssigner() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    // React to the external branch switcher (no full reload — §4).
    const branchId = useBranchContextStore(s => s.branchId);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [savedRoutes, setSavedRoutes] = useState<Route[]>([]);
    const [schedules, setSchedules] = useState<Record<string, DaySchedule>>({});
    const [employees, setEmployees] = useState<any[]>([]);
    const [routeAssignments, setRouteAssignments] = useState<Record<string, AssignmentState>>({});
    const [stationLeadCounts, setStationLeadCounts] = useState<Record<number, number> | null>(null);
    const [stationLeadCountsLoading, setStationLeadCountsLoading] = useState(false);
    const [stationLeadCountsError, setStationLeadCountsError] = useState(false);
    const [stationLeadCountsRefreshKey, setStationLeadCountsRefreshKey] = useState(0);
    const [saveError, setSaveError] = useState<string | null>(null);

    const [date, setDate] = useState(getPlanningDate);
    const [selectedTeam, setSelectedTeam] = useState('');
    const [segments, setSegments] = useState<Segment[]>([]);
    /** Advanced free order (station ids). null = order follows the segments. */
    const [customOrder, setCustomOrder] = useState<number[] | null>(null);
    const [freeOrderMode, setFreeOrderMode] = useState(false);
    /** Segment waiting for its end-station click. */
    const [pendingEnd, setPendingEnd] = useState<string | null>(null);
    const [draggedStationId, setDraggedStationId] = useState<number | null>(null);
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [extraZoneSelection, setExtraZoneSelection] = useState<GeoSelection>(emptyGeoSelection);

    const currentKey = date + '_' + selectedTeam;
    const savedAssignmentForCurrentKey = selectedTeam ? routeAssignments[currentKey] : undefined;

    useEffect(() => {
        let cancelled = false;
        const loadAll = async () => {
            setLoading(true);
            try {
                const [geo, routes, emps, assignments] = await Promise.all([
                    api.geoUnits.list(),
                    api.routes.list(),
                    api.employees.list(),
                    api.routeAssignments.list(),
                ]);
                if (cancelled) return;
                setGeoUnits(geo);
                setSavedRoutes(routes);
                setEmployees(emps);
                setRouteAssignments(assignments || {});
            } catch (err) {
                console.error('Failed to load route assigner data:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadAll();
        return () => { cancelled = true; };
    }, [branchId]);

    useEffect(() => {
        let cancelled = false;
        const loadSchedule = async () => {
            // No date-cache short-circuit: the branch switcher changes what the server
            // returns for the same date, so we must refetch on branch change too.
            try {
                const schedule = await api.schedules.get(date);
                if (cancelled) return;
                setSchedules(prev => ({ ...prev, [date]: schedule || { teams: [], solos: [] } }));
            } catch (err) {
                console.error('Failed to load schedule:', err);
            }
        };
        loadSchedule();
        return () => { cancelled = true; };
    }, [date, branchId]);

    const teamOptions = useMemo(() => {
        const sched = schedules[date];
        if (!sched) return [];
        const opts: { value: string; label: string }[] = [];
        (sched.teams || []).forEach((t, idx) => {
            // Foreign-branch slots arrive redacted to `{ locked: true }` (GAP-DS-005) —
            // skip them, keep idx so team_key stays aligned with route_assignments.
            if ((t as any)?.locked === true) return;
            const sup = t.supervisor ? employees.find(e => e.id === t.supervisor) : null;
            opts.push({ value: `team_${idx}`, label: sup ? `فريق ${sup.name}` : `فريق #${idx + 1}` });
        });
        (sched.solos || []).forEach((s, idx) => {
            if ((s as any)?.locked === true) return;   // foreign-branch solo slot — skip, keep idx
            const tech = s.technician ? employees.find(e => e.id === s.technician) : null;
            opts.push({ value: `solo_${idx}`, label: tech ? `طوارئ: ${tech.name}` : `فريق طوارئ #${idx + 1}` });
        });
        return opts;
    }, [schedules, date, employees]);

    const zoneName = useCallback((id: number) => geoUnits.find(u => u.id === id)?.name ?? `#${id}`, [geoUnits]);

    const getRouteStations = useCallback((route: Route): Zone[] => routeStations(route, geoUnits), [geoUnits]);
    /** Stations of one segment, in its travel direction. */
    const segmentStations = useCallback(
        (segment: Segment): Zone[] => segmentStationsOf(segment, savedRoutes, geoUnits),
        [savedRoutes, geoUnits],
    );
    /** Station order implied by the segments (first occurrence wins). */
    const segmentOrder = useCallback((segs: Segment[]) => segmentOrderOf(segs, savedRoutes, geoUnits), [savedRoutes, geoUnits]);
    /** Rebuild ordered segments from a saved assignment; flags a custom order. */
    const fromPersisted = useCallback((saved: AssignmentState | undefined) => {
        const { segments: segs, custom } = fromPersistedOf(saved, savedRoutes, geoUnits);
        return { segs, custom };
    }, [savedRoutes, geoUnits]);

    const { routes: composition, extraZones } = useMemo(() => toPersisted(segments), [segments]);
    const impliedOrder = useMemo(() => segmentOrder(segments), [segmentOrder, segments]);
    const finalZoneIds = impliedOrder;
    const finalOrder = useMemo(
        () => (customOrder ? normalizeStationOrder(customOrder, finalZoneIds) : finalZoneIds),
        [customOrder, finalZoneIds],
    );
    const isCustomOrder = customOrder !== null && JSON.stringify(finalOrder) !== JSON.stringify(finalZoneIds);

    const zoneMeta = useMemo(() => {
        const meta = new Map<number, { zone: Zone; segmentIndex: number }>();
        segments.forEach((seg, index) => segmentStations(seg).forEach(z => {
            if (!meta.has(z.id)) meta.set(z.id, { zone: z, segmentIndex: index });
        }));
        return meta;
    }, [segments, segmentStations]);
    const dayPosition = useMemo(() => new Map(finalOrder.map((id, i) => [id, i + 1])), [finalOrder]);

    // Load / reload the selected team's saved scope.
    const loadTeamScope = useCallback((teamKey: string, forDate: string) => {
        const saved = teamKey ? routeAssignments[forDate + '_' + teamKey] : undefined;
        const { segs, custom } = fromPersisted(saved);
        setSegments(segs);
        setCustomOrder(custom);
        setFreeOrderMode(custom !== null);
        setPendingEnd(null);
        setSelectedRouteId('');
        setExtraZoneSelection(emptyGeoSelection);
        setDraggedStationId(null);
        setStationLeadCounts(null);
        setStationLeadCountsError(false);
        setSaveError(null);
    }, [routeAssignments, fromPersisted]);

    // Rebuild once routes/geo arrive (segments need station data to anchor).
    useEffect(() => {
        if (selectedTeam && !loading) loadTeamScope(selectedTeam, date);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading]);

    // ── Saved baseline & freeze (DEC-009 لبنة 8) ─────────────────────────────
    const savedZoneIds = useMemo(() => {
        if (!savedAssignmentForCurrentKey) return new Set<number>();
        return new Set(segmentOrder(fromPersisted(savedAssignmentForCurrentKey).segs));
    }, [savedAssignmentForCurrentKey, segmentOrder, fromPersisted]);
    const isGenerated = Boolean(savedAssignmentForCurrentKey?.generated);
    const frozenZoneIds = isGenerated ? savedZoneIds : new Set<number>();
    const dropsFrozenZone = (segs: Segment[]) => {
        if (frozenZoneIds.size === 0) return false;
        const next = new Set(segmentOrder(segs));
        for (const id of frozenZoneIds) if (!next.has(id)) return true;
        return false;
    };
    const removedFrozenZones = useMemo(() => {
        if (frozenZoneIds.size === 0) return [] as string[];
        const current = new Set(finalZoneIds);
        return [...frozenZoneIds].filter(id => !current.has(id)).map(zoneName);
    }, [frozenZoneIds, finalZoneIds, zoneName]);

    const hasPersistedAssignmentMatch = useMemo(() => {
        if (!selectedTeam) return false;
        // Route/zone lists compare order-insensitively: the visit order lives in stationOrder.
        return matchesSaved(savedAssignmentForCurrentKey, { routes: composition, extraZones, order: finalOrder }, finalZoneIds);
    }, [selectedTeam, savedAssignmentForCurrentKey, composition, extraZones, finalZoneIds, finalOrder]);

    const hasWorkCoverage = selectedTeam !== '' && finalZoneIds.length > 0;
    const isDirty = selectedTeam !== '' && (
        savedAssignmentForCurrentKey ? !hasPersistedAssignmentMatch : finalZoneIds.length > 0
    );
    const canSaveAssignment = hasWorkCoverage && isDirty && !saving && removedFrozenZones.length === 0;

    const planStatus: PlanStatus = !selectedTeam
        ? 'none'
        : isDirty ? 'dirty' : !savedAssignmentForCurrentKey ? 'new' : isGenerated ? 'frozen' : 'saved';

    useEffect(() => {
        if (!isDirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isDirty]);

    const onDateChange = (newDate: string) => {
        if (newDate === date) return;
        if (isDirty && !window.confirm(UNSAVED_CONFIRM)) return;
        setDate(newDate);
        setSelectedTeam('');
        loadTeamScope('', newDate);
    };
    const onTeamChange = (val: string) => {
        if (val === selectedTeam) return;
        if (isDirty && !window.confirm(UNSAVED_CONFIRM)) return;
        setSelectedTeam(val);
        loadTeamScope(val, date);
    };
    const resetToSaved = () => loadTeamScope(selectedTeam, date);

    // ── Segment editing ──────────────────────────────────────────────────────
    const usedRouteIds = useMemo(
        () => new Set(segments.filter((s): s is RouteSegment => s.kind === 'route').map(s => s.routeId)),
        [segments],
    );
    // The API keeps one entry per route, so a route is added once (as one segment).
    const availableRoutes = useMemo(() => savedRoutes.filter(r => !usedRouteIds.has(r.id)), [savedRoutes, usedRouteIds]);

    const addRouteSegment = () => {
        const routeId = parseInt(selectedRouteId, 10);
        const route = savedRoutes.find(r => r.id === routeId);
        if (!route || usedRouteIds.has(routeId)) return;
        setSegments(s => [...s, { kind: 'route', key: newSegmentKey(), routeId, startIdx: 0, endIdx: route.points.length - 1 }]);
        setSelectedRouteId('');
    };

    const selectedExtraZoneId = useMemo(() => {
        const rawId = extraZoneSelection.neighborhoodId || extraZoneSelection.subId || extraZoneSelection.regionId || extraZoneSelection.govId;
        const parsedId = parseInt(rawId, 10);
        return Number.isFinite(parsedId) ? parsedId : null;
    }, [extraZoneSelection]);
    const selectedExtraZoneUnit = useMemo(
        () => (selectedExtraZoneId == null ? null : geoUnits.find(unit => unit.id === selectedExtraZoneId) || null),
        [geoUnits, selectedExtraZoneId],
    );
    const canAddSelectedExtraZone = Boolean(selectedExtraZoneUnit && !finalZoneIds.includes(selectedExtraZoneUnit.id));
    const addZoneSegment = () => {
        if (!selectedExtraZoneUnit || !canAddSelectedExtraZone) return;
        setSegments(s => [...s, { kind: 'zone', key: newSegmentKey(), zoneId: selectedExtraZoneUnit.id }]);
        setExtraZoneSelection(emptyGeoSelection);
    };
    const extraZoneGeoUnits = useMemo(() => {
        // Keep levels 1–2 in the collection so GeoSmartSearch can build the full
        // breadcrumb, while allowing ناحية (3) and حي (4) as actual stations.
        return geoUnits.filter(unit => unit.level < 3 || !finalZoneIds.includes(unit.id));
    }, [geoUnits, finalZoneIds]);

    const moveSegment = (index: number, delta: -1 | 1) => setSegments(s => {
        const target = index + delta;
        if (target < 0 || target >= s.length) return s;
        const next = [...s];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
    });
    const removeSegment = (key: string) => {
        setSegments(s => s.filter(seg => seg.key !== key));
        if (pendingEnd === key) setPendingEnd(null);
    };
    const updateRouteSegment = (key: string, patch: Partial<RouteSegment>) => setSegments(s => s.map(seg => (
        seg.key === key && seg.kind === 'route' ? { ...seg, ...patch } : seg
    )));
    /** Click 1 sets the start (segment collapses to it), click 2 sets the end. */
    const onStationClick = (segment: RouteSegment, index: number) => {
        if (pendingEnd === segment.key) {
            updateRouteSegment(segment.key, { endIdx: index });
            setPendingEnd(null);
        } else {
            updateRouteSegment(segment.key, { startIdx: index, endIdx: index });
            setPendingEnd(segment.key);
        }
    };
    const reverseSegment = (segment: RouteSegment) => updateRouteSegment(segment.key, { startIdx: segment.endIdx, endIdx: segment.startIdx });
    const wholeRoute = (segment: RouteSegment, route: Route) => {
        const forward = segment.startIdx <= segment.endIdx;
        const last = route.points.length - 1;
        updateRouteSegment(segment.key, forward ? { startIdx: 0, endIdx: last } : { startIdx: last, endIdx: 0 });
        setPendingEnd(null);
    };

    // ── Free order (advanced) ────────────────────────────────────────────────
    const moveStation = (zoneId: number, targetZoneId: number) => {
        if (zoneId === targetZoneId) return;
        const next = [...finalOrder];
        const from = next.indexOf(zoneId);
        const to = next.indexOf(targetZoneId);
        if (from < 0 || to < 0) return;
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setCustomOrder(next);
    };
    const moveStationBy = (zoneId: number, delta: -1 | 1) => {
        const target = finalOrder[finalOrder.indexOf(zoneId) + delta];
        if (target != null) moveStation(zoneId, target);
    };
    const backToSegmentOrder = () => setCustomOrder(null);
    const onFreeOrderToggle = (on: boolean) => {
        if (!on && isCustomOrder && !window.confirm('سيُعاد ترتيب المحطات حسب المقاطع ويُلغى الترتيب المخصّص. متابعة؟')) return;
        setFreeOrderMode(on);
        if (!on) setCustomOrder(null);
    };

    /** A segment is «مخصّص» when free ordering pulled its stations out of sequence. */
    const segmentDaySpan = (segment: Segment) => {
        const ids = segmentStations(segment).map(z => z.id).filter(id => zoneMeta.get(id)?.segmentIndex === segments.indexOf(segment));
        const positions = ids.map(id => dayPosition.get(id)!).filter(Boolean);
        if (positions.length === 0) return null;
        const first = dayPosition.get(ids[0]) ?? Math.min(...positions);
        const last = dayPosition.get(ids[ids.length - 1]) ?? Math.max(...positions);
        const sorted = [...positions].sort((a, b) => a - b);
        const contiguousInOrder = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1)
            && positions.every((p, i) => i === 0 || p > positions[i - 1]);
        return { first, last, count: positions.length, custom: isCustomOrder && !contiguousInOrder };
    };

    // ── Per-station contact counts (saved scope only) ────────────────────────
    useEffect(() => {
        let cancelled = false;
        if (!selectedTeam || finalZoneIds.length === 0 || !hasPersistedAssignmentMatch) {
            setStationLeadCounts(null);
            setStationLeadCountsLoading(false);
            setStationLeadCountsError(false);
            return () => { cancelled = true; };
        }
        setStationLeadCountsLoading(true);
        setStationLeadCountsError(false);
        (async () => {
            try {
                // Only the per-station counts are shown here — skip the full lead list.
                const result = await api.planning.marketingTargets(date, selectedTeam, 'planning', { countsOnly: true }) as MarketingTargetsResponse;
                const countsMap = new Map<number, number>();
                (result.countsByZone || []).forEach(entry => countsMap.set(Number(entry.zoneId), Number(entry.count)));
                if (!cancelled) setStationLeadCounts(Object.fromEntries(finalZoneIds.map(id => [id, countsMap.get(id) ?? 0])));
            } catch (err) {
                console.warn(`Failed to load station lead counts for ${selectedTeam}; showing no fallback counts.`, err);
                if (!cancelled) { setStationLeadCounts(null); setStationLeadCountsError(true); }
            } finally {
                if (!cancelled) setStationLeadCountsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [date, finalZoneIds, hasPersistedAssignmentMatch, selectedTeam, stationLeadCountsRefreshKey]);

    const totalPotentialLeads = useMemo(() => {
        if (!stationLeadCounts) return null;
        return finalZoneIds.reduce((sum, id) => sum + (stationLeadCounts[id] ?? 0), 0);
    }, [finalZoneIds, stationLeadCounts]);

    // ── Actions ──────────────────────────────────────────────────────────────
    const saveAssignment = async () => {
        if (!canSaveAssignment) return;
        setSaving(true);
        setSaveError(null);
        try {
            const data = { routes: composition, extraZones, stationOrder: [...finalOrder] };
            const saved = await api.routeAssignments.save(currentKey, data);
            setRouteAssignments(prev => ({
                ...prev,
                [currentKey]: { ...data, generated: Boolean(saved?.generated ?? prev[currentKey]?.generated) },
            }));
            if (!isCustomOrder) setCustomOrder(null);
            setStationLeadCounts(null);
            setStationLeadCountsError(false);
            setStationLeadCountsRefreshKey(key => key + 1);
            toast.success('تم حفظ نطاق عمل الفريق', { description: 'يُعاد الآن حساب عدد العملاء لكل محطة.' });
        } catch (err: any) {
            console.error('Failed to save assignment:', err);
            // Surface the server's reason (e.g. DEC-009 لبنة 8: after contacts are
            // generated the scope is append-only) instead of a generic failure.
            const payload = err?.payload;
            let text = err?.message ? `تعذر حفظ نطاق عمل الفريق: ${err.message}` : 'تعذر حفظ نطاق عمل الفريق';
            if (payload?.code === 'SCOPE_FROZEN_AFTER_GENERATION' && Array.isArray(payload.removedZones)) {
                const names = payload.removedZones.map((zoneId: number) => zoneName(Number(zoneId))).join('، ');
                text = `${payload.error} المناطق المحذوفة: ${names}. أعِد إضافتها ثم احفظ.`;
            }
            setSaveError(text);
        } finally {
            setSaving(false);
        }
    };

    // DEC-009 لبنة 9 — manual "تحديث": re-run sync + reconcile for the saved scope so
    // newly-eligible tasks (personal AND branch-owned) are pulled into the dashboard
    // WITHOUT forcing a zone change to re-enable the save button.
    const refreshTasks = async () => {
        if (!selectedTeam || !hasPersistedAssignmentMatch) return;
        setSyncing(true);
        setSaveError(null);
        try {
            const result = await api.planning.syncContactTargetsDashboard(date, selectedTeam);
            const newlyAssigned = result?.counts?.newlyAssigned ?? 0;
            const released = result?.counts?.released ?? 0;
            setStationLeadCounts(null);
            setStationLeadCountsError(false);
            setStationLeadCountsRefreshKey(key => key + 1);
            toast.success('تم تحديث المهام', {
                description: `${newlyAssigned} مهمة جديدة دخلت الخطة${released > 0 ? `، و${released} خرجت من النطاق` : ''}.`,
            });
        } catch (err: any) {
            console.error('Failed to refresh tasks:', err);
            setSaveError(err?.message ? `تعذر تحديث المهام: ${err.message}` : 'تعذر تحديث المهام');
        } finally {
            setSyncing(false);
        }
    };
    const canRefreshTasks = hasPersistedAssignmentMatch && !saving && !syncing;

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-sky-600 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm">جاري تحميل البيانات...</p>
                </div>
            </div>
        );
    }

    const countsPending = stationLeadCountsLoading || saving;
    const statusBadge = {
        none: null,
        new: <Badge variant="neutral" icon={Info}>لم يُحفظ نطاق لهذا الفريق بعد</Badge>,
        dirty: <Badge variant="warning" icon={AlertTriangle}>تغييرات غير محفوظة</Badge>,
        saved: <Badge variant="success" icon={CheckCircle2}>محفوظ</Badge>,
        frozen: <Badge variant="info" icon={Lock}>مولَّد — يُسمح بالإضافة فقط</Badge>,
    }[planStatus];

    const countTone = (count: number | undefined) => (
        count == null ? 'bg-white text-slate-400 border border-slate-300'
            : count >= 3 ? 'bg-emerald-600 text-white'
                : count > 0 ? 'bg-emerald-200 text-emerald-900'
                    : 'bg-white text-slate-400 border border-slate-300'
    );
    const firstId = finalOrder[0];
    const lastId = finalOrder[finalOrder.length - 1];

    return (
        <div className="h-full overflow-y-auto p-4 md:p-8 custom-scroll">
            <PageHeader
                className="mb-6"
                title="نطاق عمل الفريق"
                subtitle="ابنِ يوم الفريق من مقاطع مرتبة: مقطع من مسار (من محطة إلى محطة) أو منطقة. ترتيب المقاطع هو ترتيب الزيارة."
            />

            {/* ── Context & actions bar ── */}
            <div className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 pb-4 bg-slate-50/95">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-wrap items-end gap-4">
                    <label className="space-y-1">
                        <span className="text-xs font-bold text-slate-500 flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />يوم التنفيذ</span>
                        <DateField value={date} onChange={onDateChange} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none" />
                    </label>
                    <label className="space-y-1">
                        <span className="text-xs font-bold text-slate-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" />الفريق</span>
                        <Select
                            value={selectedTeam}
                            onChange={onTeamChange}
                            placeholder={teamOptions.length ? 'اختر الفريق...' : 'لا توجد فرق مجدولة لهذا اليوم'}
                            ariaLabel="الفريق"
                            className="w-60"
                            options={[{ value: '', label: 'اختر الفريق...' }, ...teamOptions]}
                        />
                    </label>
                    {statusBadge && <div className="pb-2">{statusBadge}</div>}
                    <div className="ms-auto flex flex-wrap items-center gap-2">
                        {isDirty && savedAssignmentForCurrentKey && (
                            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetToSaved} disabled={saving}>تراجع عن التغييرات</Button>
                        )}
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={RefreshCw}
                            onClick={refreshTasks}
                            disabled={!canRefreshTasks}
                            loading={syncing}
                            title={isDirty ? 'احفظ التغييرات أولاً' : 'إعادة مزامنة المهام المؤهلة (بما فيها مهام الفرع الجديدة) دون تغيير النطاق'}
                        >
                            تحديث المهام
                        </Button>
                        {isDirty ? (
                            <Button size="sm" icon={Save} onClick={saveAssignment} disabled={!canSaveAssignment} loading={saving}
                                title={removedFrozenZones.length > 0 ? 'أعِد المحطات المجمّدة المحذوفة أولاً' : undefined}>
                                {saving ? 'جاري الحفظ...' : 'حفظ نطاق العمل'}
                            </Button>
                        ) : selectedTeam && savedAssignmentForCurrentKey ? (
                            <span className="text-xs text-slate-400 px-2">لا توجد تغييرات</span>
                        ) : null}
                    </div>
                </div>
            </div>

            {!selectedTeam ? (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
                    <Users className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                    <p className="text-slate-800 font-bold mb-1">
                        {teamOptions.length ? 'اختر فريقاً لبدء بناء يومه' : 'لا توجد فرق مجدولة في هذا اليوم'}
                    </p>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                        {teamOptions.length
                            ? 'أضف مقطعاً من مسار أو منطقة، حدّد بداية كل مقطع ونهايته، ورتّب المقاطع بترتيب الزيارة، ثم احفظ.'
                            : 'أنشئ جدول الفرق لهذا اليوم من صفحة «جدولة الفرق» أولاً، أو اختر يوماً آخر.'}
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Alerts ── */}
                    {isGenerated && (
                        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 flex gap-3">
                            <Lock className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-sky-900">
                                <p className="font-bold">وُلّدت جهات الاتصال لهذا الفريق — النطاق قابل للإضافة فقط</p>
                                <p className="text-sky-700 mt-0.5">يمكنك إضافة مقاطع ومناطق وإعادة الترتيب، لكن لا يمكن إخراج محطة محفوظة من النطاق. المحطات المضافة بعد التوليد معلّمة بإطار برتقالي.</p>
                            </div>
                        </div>
                    )}
                    {removedFrozenZones.length > 0 && (
                        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 flex flex-wrap items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                            <p className="text-sm text-red-800 flex-1 min-w-[16rem]">
                                <span className="font-bold">لا يمكن الحفظ:</span> خرجت من النطاق محطات مجمّدة —{' '}
                                <span className="font-bold">{removedFrozenZones.join('، ')}</span>. وسّع المقطع لتشملها.
                            </p>
                            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={resetToSaved}>استعادة النطاق المحفوظ</Button>
                        </div>
                    )}
                    {saveError && (
                        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <p className="text-sm text-red-800 flex-1">{saveError}</p>
                            <IconButton icon={X} label="إغلاق" size="sm" onClick={() => setSaveError(null)} />
                        </div>
                    )}

                    {/* ── Day timeline ── */}
                    <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 md:p-6 mb-4">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
                            <h3 className="text-slate-800 font-bold text-lg flex items-center gap-2"><Layers className="w-5 h-5 text-sky-600" />خط سير اليوم</h3>
                            <span className="text-base text-slate-500">
                                {segments.length} مقطع · {finalOrder.length} محطة
                                {' · '}
                                {isDirty ? 'عدد العملاء يُحسب بعد الحفظ'
                                    : countsPending ? 'جاري حساب العملاء…'
                                        : stationLeadCountsError ? 'تعذر حساب العملاء'
                                            : <><span className="font-bold text-slate-800">{totalPotentialLeads ?? 0}</span> عميل محتمل</>}
                            </span>
                            {stationLeadCountsError && !isDirty && (
                                <button type="button" className="text-xs font-bold text-sky-700 underline" onClick={() => setStationLeadCountsRefreshKey(k => k + 1)}>إعادة المحاولة</button>
                            )}
                            <div className="ms-auto flex items-center gap-2">
                                {isCustomOrder && (
                                    <Button variant="ghost" size="sm" icon={RotateCcw} onClick={backToSegmentOrder}>العودة لترتيب المقاطع</Button>
                                )}
                                <span className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
                                    <Toggle id="free-order-toggle" checked={freeOrderMode} onCheckedChange={onFreeOrderToggle} size="sm" label="ترتيب حر (متقدّم)" />
                                    <label htmlFor="free-order-toggle" className="cursor-pointer">ترتيب حر (متقدّم)</label>
                                </span>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 mb-6">
                            <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full border border-slate-300 bg-white" />بلا عملاء</span>
                            <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full bg-emerald-200" />1–2</span>
                            <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full bg-emerald-600" />3+</span>
                            {isGenerated && <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full ring-2 ring-orange-400" />جديدة بعد التوليد</span>}
                            <span>الشريط الملوّن تحت المحطة = المقطع الذي تنتمي إليه</span>
                            {freeOrderMode && <span className="inline-flex items-center gap-1 text-sky-700 font-bold"><Move className="w-3 h-3" />اسحب المحطات أو استعمل الأسهم</span>}
                        </div>

                        {finalOrder.length === 0 ? (
                            <p className="text-center text-slate-400 text-base py-12">أضف مقطعاً لتظهر محطات اليوم هنا</p>
                        ) : (
                            <ol className="flex flex-wrap gap-y-7">
                                {finalOrder.map((id, i) => {
                                    const meta = zoneMeta.get(id);
                                    if (!meta) return null;
                                    const color = colorOf(meta.segmentIndex);
                                    const count = isDirty ? undefined : stationLeadCounts?.[id];
                                    const isNewAfterGeneration = isGenerated && !savedZoneIds.has(id);
                                    return (
                                        <li
                                            key={id}
                                            draggable={freeOrderMode}
                                            onDragStart={() => setDraggedStationId(id)}
                                            onDragEnd={() => setDraggedStationId(null)}
                                            onDragOver={e => { if (freeOrderMode) e.preventDefault(); }}
                                            onDrop={() => { if (draggedStationId != null) moveStation(draggedStationId, id); setDraggedStationId(null); }}
                                            className={`w-28 flex flex-col items-center text-center ${freeOrderMode ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedStationId === id ? 'opacity-50' : ''}`}
                                            title={`${meta.zone.name} — ${count ?? '—'} عميل`}
                                        >
                                            <span className={`h-5 text-xs font-bold ${id === firstId ? 'text-emerald-700' : id === lastId ? 'text-red-700' : 'text-transparent'}`}>
                                                {id === firstId ? 'البداية' : id === lastId ? 'النهاية' : '·'}
                                            </span>
                                            <span className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-bold ${countTone(count)} ${isNewAfterGeneration ? 'ring-[3px] ring-orange-400 ring-offset-2' : ''}`}>
                                                {count != null && count > 0 ? count : i + 1}
                                            </span>
                                            <span className={`mt-1.5 h-1.5 w-16 rounded-full ${color.dot}`} aria-hidden="true" />
                                            <span className="mt-1.5 text-sm font-medium leading-snug text-slate-800 line-clamp-2">{meta.zone.name}</span>
                                            {freeOrderMode && (
                                                <span className="mt-0.5 flex gap-0.5">
                                                    <button type="button" onClick={() => moveStationBy(id, -1)} disabled={i === 0} aria-label={`تقديم ${meta.zone.name}`} className="text-slate-400 hover:text-sky-600 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                                                    <button type="button" onClick={() => moveStationBy(id, 1)} disabled={i === finalOrder.length - 1} aria-label={`تأخير ${meta.zone.name}`} className="text-slate-400 hover:text-sky-600 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </section>

                    {/* ── Segment builder ── */}
                    <section className="bg-white rounded-xl shadow-sm border border-slate-200">
                        <div className="p-4 border-b border-slate-100">
                            <h3 className="text-slate-800 font-bold text-base flex items-center gap-2"><RouteIcon className="w-4 h-4 text-sky-600" />المقاطع بالترتيب</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                اضغط محطة لتكون <span className="text-emerald-700 font-bold">البداية</span>، ثم محطة لتكون <span className="text-red-700 font-bold">النهاية</span>. إذا جاءت النهاية قبل البداية على المسار يصبح المقطع «إياباً» تلقائياً.
                            </p>
                        </div>

                        <div className="p-4 space-y-3">
                            {segments.length === 0 && (
                                <p className="text-center text-slate-400 text-sm py-4">لا توجد مقاطع بعد — أضف أول مقطع من الأسفل</p>
                            )}
                            {segments.map((segment, index) => {
                                const color = colorOf(index);
                                const span = segmentDaySpan(segment);
                                const removeLocked = dropsFrozenZone(segments.filter(s => s.key !== segment.key));
                                const stations = segmentStations(segment);
                                const duplicates = stations.filter(z => zoneMeta.get(z.id)?.segmentIndex !== index);
                                const route = segment.kind === 'route' ? savedRoutes.find(r => r.id === segment.routeId) : undefined;
                                const routeStations = route ? getRouteStations(route) : [];
                                const forward = segment.kind === 'route' ? segment.startIdx <= segment.endIdx : true;
                                const lo = segment.kind === 'route' ? Math.min(segment.startIdx, segment.endIdx) : 0;
                                const hi = segment.kind === 'route' ? Math.max(segment.startIdx, segment.endIdx) : 0;
                                return (
                                    <div key={segment.key} className={`rounded-xl border border-slate-200 border-s-4 ${color.bar} p-3`}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center ${color.num}`}>{index + 1}</span>
                                            {segment.kind === 'route' ? (
                                                <>
                                                    <span className="font-bold text-slate-900 text-sm">مسار {route?.name ?? `#${segment.routeId}`}</span>
                                                    <span className="text-xs text-slate-600 inline-flex items-center gap-1">
                                                        <Flag className="w-3 h-3 text-emerald-600" />{stations[0]?.name ?? '—'}
                                                        <span className="text-slate-400">←</span>
                                                        <FlagOff className="w-3 h-3 text-red-600" />{stations[stations.length - 1]?.name ?? '—'}
                                                    </span>
                                                    <Badge variant={forward ? 'success' : 'warning'} size="sm">{forward ? 'ذهاب' : 'إياب'}</Badge>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="font-bold text-slate-900 text-sm inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-orange-500" />منطقة: {stations[0]?.name ?? zoneName(segment.zoneId)}</span>
                                                </>
                                            )}
                                            {span && (
                                                <span className="text-xs text-slate-500">
                                                    {span.count === 1 ? `المحطة ${span.first} من اليوم` : `المحطات ${span.first} ← ${span.last} من اليوم`}
                                                </span>
                                            )}
                                            {span?.custom && (
                                                <Badge variant="info" size="sm" icon={Move}>مخصّص</Badge>
                                            )}
                                            <div className="ms-auto flex items-center gap-1">
                                                {segment.kind === 'route' && route && (
                                                    <>
                                                        <Button variant="ghost" size="sm" onClick={() => reverseSegment(segment)}>عكس الاتجاه</Button>
                                                        {(lo !== 0 || hi !== routeStations.length - 1) && (
                                                            <Button variant="ghost" size="sm" onClick={() => wholeRoute(segment, route)}>كامل المسار</Button>
                                                        )}
                                                    </>
                                                )}
                                                <IconButton icon={ChevronUp} label="تقديم المقطع" size="sm" disabled={index === 0} onClick={() => moveSegment(index, -1)} />
                                                <IconButton icon={ChevronDown} label="تأخير المقطع" size="sm" disabled={index === segments.length - 1} onClick={() => moveSegment(index, 1)} />
                                                <IconButton
                                                    icon={removeLocked ? Lock : X}
                                                    label={removeLocked ? 'لا يمكن حذف المقطع: يحوي محطات مجمّدة' : 'حذف المقطع'}
                                                    variant="danger"
                                                    size="sm"
                                                    disabled={removeLocked}
                                                    onClick={() => removeSegment(segment.key)}
                                                />
                                            </div>
                                        </div>

                                        {span?.custom && (
                                            <p className="mt-2 text-xs text-sky-800 bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5">
                                                ترتيب هذا المقطع عُدّل يدوياً: يبدأ في المحطة <b>{span.first}</b> ({stations[0]?.name}) وينتهي في المحطة <b>{span.last}</b> ({stations[stations.length - 1]?.name}) من ترتيب اليوم، ومحطاته غير متتالية.
                                            </p>
                                        )}

                                        {segment.kind === 'route' && route && (
                                            <>
                                                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`محطات مسار ${route.name}`}>
                                                    {routeStations.map((s, si) => {
                                                        const isStart = si === segment.startIdx;
                                                        const isEnd = si === segment.endIdx && pendingEnd !== segment.key;
                                                        const inside = si >= lo && si <= hi;
                                                        const frozenOut = !inside && frozenZoneIds.has(s.id);
                                                        const cls = isStart
                                                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold'
                                                            : isEnd
                                                                ? 'bg-red-100 text-red-900 border-red-300 font-bold'
                                                                : inside
                                                                    ? color.soft
                                                                    : frozenOut
                                                                        ? 'bg-red-50 text-red-700 border-red-200 line-through'
                                                                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400';
                                                        return (
                                                            <button
                                                                key={`${s.id}-${si}`}
                                                                type="button"
                                                                onClick={() => onStationClick(segment, si)}
                                                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${cls}`}
                                                                aria-pressed={inside}
                                                            >
                                                                {isStart && <Flag className="w-3 h-3" />}
                                                                {isEnd && !isStart && <FlagOff className="w-3 h-3" />}
                                                                {s.name}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                {pendingEnd === segment.key && (
                                                    <p className="mt-2 text-xs font-bold text-emerald-700">اختر الآن محطة النهاية…</p>
                                                )}
                                            </>
                                        )}

                                        {duplicates.length > 0 && (
                                            <p className="mt-2 text-xs text-slate-500 inline-flex items-center gap-1">
                                                <Copy className="w-3 h-3" />
                                                مكررة وتُزار مرة واحدة ضمن مقطع سابق: {duplicates.map(z => z.name).join('، ')}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Add bar */}
                        <div className="p-4 border-t border-slate-100 bg-slate-50/60 rounded-b-xl grid gap-4 lg:grid-cols-2">
                            <div className="space-y-1.5">
                                <span className="text-xs font-bold text-slate-600 flex items-center gap-1"><RouteIcon className="w-3.5 h-3.5 text-sky-600" />مقطع من مسار</span>
                                <div className="flex gap-2">
                                    <Select
                                        value={selectedRouteId}
                                        onChange={setSelectedRouteId}
                                        ariaLabel="المسار"
                                        className="flex-1"
                                        placeholder={availableRoutes.length ? 'اختر مساراً...' : 'كل المسارات مضافة'}
                                        options={[{ value: '', label: 'اختر مساراً...' }, ...availableRoutes.map(r => ({ value: String(r.id), label: `${r.name} (${r.points.length} محطة)` }))]}
                                    />
                                    <Button size="sm" icon={Plus} onClick={addRouteSegment} disabled={!selectedRouteId}>إضافة</Button>
                                </div>
                                <p className="text-[11px] text-slate-400">يُضاف كاملاً في آخر اليوم، ثم حدّد بدايته ونهايته.</p>
                            </div>
                            <div className="space-y-1.5">
                                <GeoSmartSearch
                                    label="أضف ناحية أو حي"
                                    geoUnits={extraZoneGeoUnits}
                                    value={extraZoneSelection}
                                    onChange={setExtraZoneSelection}
                                    minSelectableLevel={3}
                                    placeholder="ابحث عن ناحية أو حي لإضافته..."
                                />
                                <div className="flex items-center gap-2">
                                    <Button size="sm" variant="secondary" icon={Plus} onClick={addZoneSegment} disabled={!canAddSelectedExtraZone}>إضافة المنطقة كمقطع</Button>
                                    {selectedExtraZoneUnit && !canAddSelectedExtraZone && (
                                        <span className="text-xs text-slate-500">«{selectedExtraZoneUnit.name}» ضمن النطاق مسبقاً</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
