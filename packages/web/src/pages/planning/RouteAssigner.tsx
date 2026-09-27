import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
    Users, Save, Plus, MapPin, Route as RouteIcon, ListOrdered, X, ArrowRight, ArrowLeft, Loader2,
    GripVertical, RefreshCw, Lock, ChevronUp, ChevronDown, RotateCcw, AlertTriangle, CheckCircle2,
    CalendarDays, Info,
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
import { levelNames } from '../../lib/geoConstants';
import type { Route, GeoUnit, DaySchedule, RouteComposition, RouteAssignmentData } from '../../lib/types';

const levelColors: Record<number, { bg: string; text: string; border: string }> = {
    1: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    2: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    3: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    4: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

// Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

function normalizeStationOrder(order: number[] | undefined, finalZoneIds: number[]): number[] {
    const validIds = new Set(finalZoneIds);
    const normalized = (order || []).filter(id => validIds.has(id));
    finalZoneIds.forEach(id => {
        if (!normalized.includes(id)) normalized.push(id);
    });
    return normalized;
}

type StationLeadCount = {
    zoneId: number;
    count: number;
};

type MarketingTargetsResponse = {
    teamKey: string;
    countsByZone?: StationLeadCount[];
    counts: {
        total: number;
    };
    reason?: string | null;
};

/** Saved assignment + server flag: contacts already generated → append-only (DEC-009 لبنة 8). */
type AssignmentState = RouteAssignmentData & { generated?: boolean };

type Zone = { id: number; name: string; level: number };

type PlanStatus = 'none' | 'new' | 'dirty' | 'saved' | 'frozen';

const UNSAVED_CONFIRM = 'لديك تغييرات غير محفوظة على نطاق عمل هذا الفريق. هل تريد تجاهلها؟';

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
    const [composition, setComposition] = useState<RouteComposition[]>([]);
    const [extraZones, setExtraZones] = useState<number[]>([]);
    const [extraZoneSelection, setExtraZoneSelection] = useState<GeoSelection>(emptyGeoSelection);
    const [stationOrder, setStationOrder] = useState<number[]>([]);
    const [draggedStationId, setDraggedStationId] = useState<number | null>(null);
    const [selectedRouteId, setSelectedRouteId] = useState('');

    const currentKey = date + '_' + selectedTeam;
    const savedAssignmentForCurrentKey = selectedTeam ? routeAssignments[currentKey] : undefined;
    const selectedRouteIds = useMemo(() => new Set(composition.map(comp => comp.routeId)), [composition]);
    const availableRoutes = useMemo(
        () => savedRoutes.filter(route => !selectedRouteIds.has(route.id)),
        [savedRoutes, selectedRouteIds],
    );

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

    const getRouteStations = useCallback((route: Route): Zone[] => {
        return [...route.points].sort((a, b) => a.order - b.order).map(p => {
            const unit = geoUnits.find(u => u.id === p.geoUnitId);
            return unit ? { id: unit.id, name: unit.name, level: p.level } : { id: p.geoUnitId, name: '??', level: p.level };
        });
    }, [geoUnits]);

    /** Stations covered by a (routes + extra zones) scope, in route order. */
    const computeZones = useCallback((routes: RouteComposition[], extras: number[]): Zone[] => {
        const zones: Zone[] = [];
        routes.forEach(comp => {
            const route = savedRoutes.find(r => r.id === comp.routeId);
            if (!route) return;
            let slice = getRouteStations(route).slice(comp.startIdx, comp.endIdx + 1);
            if (comp.direction === 'reverse') slice = slice.reverse();
            slice.forEach(s => { if (!zones.some(z => z.id === s.id)) zones.push(s); });
        });
        extras.forEach(zId => {
            if (!zones.some(z => z.id === zId)) {
                const unit = geoUnits.find(u => u.id === zId);
                if (unit) zones.push({ id: unit.id, name: unit.name, level: unit.level });
            }
        });
        return zones;
    }, [savedRoutes, geoUnits, getRouteStations]);

    const finalZones = useMemo(() => computeZones(composition, extraZones), [computeZones, composition, extraZones]);
    const finalZoneIds = useMemo(() => finalZones.map(zone => zone.id), [finalZones]);
    const orderedFinalZoneIds = useMemo(() => normalizeStationOrder(
        stationOrder.length > 0 ? stationOrder : (savedAssignmentForCurrentKey?.stationOrder || []),
        finalZoneIds,
    ), [stationOrder, savedAssignmentForCurrentKey, finalZoneIds]);
    const orderedFinalZones = useMemo(() => orderedFinalZoneIds
        .map(id => finalZones.find(zone => zone.id === id))
        .filter((zone): zone is Zone => Boolean(zone)),
    [finalZones, orderedFinalZoneIds]);

    // ── Saved baseline & freeze (DEC-009 لبنة 8) ───────────────────────────────
    const savedZoneIds = useMemo(() => new Set(
        savedAssignmentForCurrentKey
            ? computeZones(savedAssignmentForCurrentKey.routes || [], savedAssignmentForCurrentKey.extraZones || []).map(z => z.id)
            : [],
    ), [computeZones, savedAssignmentForCurrentKey]);
    const isGenerated = Boolean(savedAssignmentForCurrentKey?.generated);
    const frozenZoneIds = isGenerated ? savedZoneIds : new Set<number>();
    const isFrozenZone = (zoneId: number) => frozenZoneIds.has(zoneId);
    /** True when a proposed scope would drop a station the server will refuse to remove. */
    const dropsFrozenZone = (routes: RouteComposition[], extras: number[]) => {
        if (frozenZoneIds.size === 0) return false;
        const next = new Set(computeZones(routes, extras).map(z => z.id));
        for (const id of frozenZoneIds) if (!next.has(id)) return true;
        return false;
    };
    const removedFrozenZones = useMemo(() => {
        if (frozenZoneIds.size === 0) return [] as string[];
        const current = new Set(finalZoneIds);
        return [...frozenZoneIds]
            .filter(id => !current.has(id))
            .map(id => geoUnits.find(u => u.id === id)?.name ?? `#${id}`);
    }, [frozenZoneIds, finalZoneIds, geoUnits]);

    const hasPersistedAssignmentMatch = useMemo(() => {
        if (!selectedTeam || !savedAssignmentForCurrentKey) return false;
        const savedRoutesSnapshot = JSON.stringify(savedAssignmentForCurrentKey.routes || []);
        const currentRoutesSnapshot = JSON.stringify(composition);
        const savedExtraZonesSnapshot = JSON.stringify(savedAssignmentForCurrentKey.extraZones || []);
        const currentExtraZonesSnapshot = JSON.stringify(extraZones);
        const savedStationOrderSnapshot = JSON.stringify(normalizeStationOrder(savedAssignmentForCurrentKey.stationOrder || [], finalZoneIds));
        const currentStationOrderSnapshot = JSON.stringify(orderedFinalZoneIds);

        return savedRoutesSnapshot === currentRoutesSnapshot
            && savedExtraZonesSnapshot === currentExtraZonesSnapshot
            && savedStationOrderSnapshot === currentStationOrderSnapshot;
    }, [composition, extraZones, finalZoneIds, orderedFinalZoneIds, savedAssignmentForCurrentKey, selectedTeam]);

    const hasWorkCoverage = selectedTeam !== '' && finalZones.length > 0;
    // Dirty = differs from what's saved (including emptying a saved scope).
    const isDirty = selectedTeam !== '' && (
        savedAssignmentForCurrentKey ? !hasPersistedAssignmentMatch : finalZones.length > 0
    );
    const canSaveAssignment = hasWorkCoverage && isDirty && !saving && removedFrozenZones.length === 0;

    const planStatus: PlanStatus = !selectedTeam
        ? 'none'
        : isDirty
            ? 'dirty'
            : !savedAssignmentForCurrentKey
                ? 'new'
                : isGenerated ? 'frozen' : 'saved';

    // Warn before leaving the page with unsaved edits.
    useEffect(() => {
        if (!isDirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isDirty]);

    const loadTeamScope = (teamKey: string, forDate: string) => {
        const saved = teamKey ? routeAssignments[forDate + '_' + teamKey] : undefined;
        setComposition(saved ? JSON.parse(JSON.stringify(saved.routes || [])) : []);
        setExtraZones(saved ? [...(saved.extraZones || [])] : []);
        setStationOrder(saved ? [...(saved.stationOrder || [])] : []);
        setExtraZoneSelection(emptyGeoSelection);
        setSelectedRouteId('');
        setDraggedStationId(null);
        setStationLeadCounts(null);
        setStationLeadCountsError(false);
        setSaveError(null);
    };

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

    const addRouteToComposition = () => {
        const routeId = parseInt(selectedRouteId);
        if (!routeId || !selectedTeam || selectedRouteIds.has(routeId)) return;
        const route = savedRoutes.find(r => r.id === routeId);
        if (!route) return;
        setComposition(c => [...c, { routeId, startIdx: 0, endIdx: route.points.length - 1, direction: 'forward' }]);
        setSelectedRouteId('');
    };

    const removeComposed = (idx: number) => setComposition(c => c.filter((_, i) => i !== idx));
    const toggleDirection = (idx: number) => setComposition(c => c.map((comp, i) => i === idx ? { ...comp, direction: comp.direction === 'forward' ? 'reverse' : 'forward' } : comp));

    const onSliderChange = (compIdx: number, which: 'start' | 'end', value: number) => {
        setComposition(c => c.map((comp, i) => {
            if (i !== compIdx) return comp;
            if (which === 'start') return { ...comp, startIdx: value, endIdx: Math.max(value, comp.endIdx) };
            return { ...comp, endIdx: value, startIdx: Math.min(value, comp.startIdx) };
        }));
    };

    const selectedExtraZoneId = useMemo(() => {
        const rawId = extraZoneSelection.neighborhoodId || extraZoneSelection.subId || extraZoneSelection.regionId || extraZoneSelection.govId;
        const parsedId = parseInt(rawId, 10);
        return Number.isFinite(parsedId) ? parsedId : null;
    }, [extraZoneSelection]);

    const selectedExtraZoneUnit = useMemo(() => {
        if (selectedExtraZoneId == null) return null;
        return geoUnits.find(unit => unit.id === selectedExtraZoneId) || null;
    }, [geoUnits, selectedExtraZoneId]);

    const canAddSelectedExtraZone = Boolean(
        selectedExtraZoneUnit
        && !extraZones.includes(selectedExtraZoneUnit.id)
        && !finalZoneIds.includes(selectedExtraZoneUnit.id),
    );

    const commitSelectedExtraZone = () => {
        if (!selectedExtraZoneUnit || !canAddSelectedExtraZone) return;
        setExtraZones(z => [...z, selectedExtraZoneUnit.id]);
        setExtraZoneSelection(emptyGeoSelection);
    };

    const removeExtraZone = (idx: number) => setExtraZones(z => z.filter((_, i) => i !== idx));

    const extraZoneGeoUnits = useMemo(() => {
        // Keep levels 1–2 in the collection so GeoSmartSearch can build the full
        // breadcrumb, while allowing ناحية (3) and حي (4) as actual stations.
        return geoUnits.filter(unit => (
            unit.level < 3
            || (!finalZoneIds.includes(unit.id) && !extraZones.includes(unit.id))
        ));
    }, [geoUnits, extraZones, finalZoneIds]);

    // ── Station order ────────────────────────────────────────────────────────
    const moveStation = (zoneId: number, targetZoneId: number) => {
        if (zoneId === targetZoneId) return;
        setStationOrder(() => {
            const next = [...orderedFinalZoneIds];
            const fromIndex = next.indexOf(zoneId);
            const toIndex = next.indexOf(targetZoneId);
            if (fromIndex < 0 || toIndex < 0) return next;
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };
    const moveStationBy = (zoneId: number, delta: -1 | 1) => {
        const index = orderedFinalZoneIds.indexOf(zoneId);
        const target = orderedFinalZoneIds[index + delta];
        if (target != null) moveStation(zoneId, target);
    };
    const handleStationDrop = (targetZoneId: number) => {
        if (draggedStationId != null) moveStation(draggedStationId, targetZoneId);
        setDraggedStationId(null);
    };

    // ── Per-station contact counts (only for the saved scope) ────────────────
    useEffect(() => {
        let cancelled = false;

        if (!selectedTeam || finalZones.length === 0 || !hasPersistedAssignmentMatch) {
            setStationLeadCounts(null);
            setStationLeadCountsLoading(false);
            setStationLeadCountsError(false);
            return () => { cancelled = true; };
        }

        setStationLeadCountsLoading(true);
        setStationLeadCountsError(false);
        const loadStationLeadCounts = async () => {
            try {
                // Only the per-station counts are shown here — skip the full lead list.
                const result = await api.planning.marketingTargets(date, selectedTeam, 'planning', { countsOnly: true }) as MarketingTargetsResponse;
                const countsMap = new Map<number, number>();
                (result.countsByZone || []).forEach(entry => {
                    countsMap.set(Number(entry.zoneId), Number(entry.count));
                });

                if (!cancelled) {
                    setStationLeadCounts(Object.fromEntries(
                        finalZones.map(zone => [zone.id, countsMap.get(zone.id) ?? 0]),
                    ));
                }
            } catch (err) {
                console.warn(`Failed to load station lead counts for ${selectedTeam}; showing no fallback counts.`, err);
                if (!cancelled) {
                    setStationLeadCounts(null);
                    setStationLeadCountsError(true);
                }
            } finally {
                if (!cancelled) {
                    setStationLeadCountsLoading(false);
                }
            }
        };

        loadStationLeadCounts();
        return () => { cancelled = true; };
    }, [date, finalZones, hasPersistedAssignmentMatch, orderedFinalZones, selectedTeam, stationLeadCountsRefreshKey]);

    const totalPotentialLeads = useMemo(() => {
        if (!stationLeadCounts) return null;
        return finalZones.reduce((sum, zone) => sum + (stationLeadCounts[zone.id] ?? 0), 0);
    }, [finalZones, stationLeadCounts]);

    // ── Actions ──────────────────────────────────────────────────────────────
    const saveAssignment = async () => {
        if (!canSaveAssignment) return;

        setSaving(true);
        setSaveError(null);
        try {
            const data = {
                routes: JSON.parse(JSON.stringify(composition)),
                extraZones: [...extraZones],
                stationOrder: [...orderedFinalZoneIds],
            };
            const saved = await api.routeAssignments.save(currentKey, data);
            setRouteAssignments(prev => ({
                ...prev,
                [currentKey]: { ...data, generated: Boolean(saved?.generated ?? prev[currentKey]?.generated) },
            }));
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
                const names = payload.removedZones
                    .map((zoneId: number) => geoUnits.find(unit => unit.id === Number(zoneId))?.name ?? `#${zoneId}`)
                    .join('، ');
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

    const selectedTeamLabel = teamOptions.find(o => o.value === selectedTeam)?.label;
    const countsPending = stationLeadCountsLoading || saving;

    const statusBadge = {
        none: null,
        new: <Badge variant="neutral" icon={Info}>لم يُحفظ نطاق لهذا الفريق بعد</Badge>,
        dirty: <Badge variant="warning" icon={AlertTriangle}>تغييرات غير محفوظة</Badge>,
        saved: <Badge variant="success" icon={CheckCircle2}>محفوظ</Badge>,
        frozen: <Badge variant="info" icon={Lock}>مولَّد — يُسمح بالإضافة فقط</Badge>,
    }[planStatus];

    return (
        <div className="h-full overflow-y-auto p-4 md:p-8 custom-scroll">
            <PageHeader
                className="mb-6"
                title="نطاق عمل الفريق"
                subtitle="حدّد مسارات ومناطق عمل كل فريق لليوم المحدد، ورتّب محطاته، وراجع عدد العملاء المحتملين في كل محطة."
            />

            {/* ── Context & actions bar (sticky) ── */}
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
                            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={resetToSaved} disabled={saving}>
                                تراجع عن التغييرات
                            </Button>
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
                        <Button
                            size="sm"
                            icon={Save}
                            onClick={saveAssignment}
                            disabled={!canSaveAssignment}
                            loading={saving}
                            title={removedFrozenZones.length > 0 ? 'أعِد المحطات المجمّدة المحذوفة أولاً' : undefined}
                        >
                            {saving ? 'جاري الحفظ...' : 'حفظ نطاق العمل'}
                        </Button>
                    </div>
                </div>
            </div>

            {!selectedTeam ? (
                /* ── Guided empty state ── */
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
                    <Users className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                    <p className="text-slate-800 font-bold mb-1">
                        {teamOptions.length ? 'اختر فريقاً لبدء تحديد نطاق عمله' : 'لا توجد فرق مجدولة في هذا اليوم'}
                    </p>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                        {teamOptions.length
                            ? 'أضف مساراً أو أكثر وحدّد المقطع المطلوب منه، ثم أضف مناطق إضافية إن لزم، ورتّب المحطات واحفظ.'
                            : 'أنشئ جدول الفرق لهذا اليوم من صفحة «جدولة الفرق» أولاً، أو اختر يوماً آخر.'}
                    </p>
                </div>
            ) : (
                <>
                    {/* ── Summary ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        {[
                            { label: 'المسارات', value: composition.length, Icon: RouteIcon, tone: 'text-sky-600' },
                            { label: 'مناطق إضافية', value: extraZones.length, Icon: MapPin, tone: 'text-orange-500' },
                            { label: 'المحطات المستهدفة', value: finalZones.length, Icon: ListOrdered, tone: 'text-emerald-600' },
                            {
                                label: 'العملاء المحتملون',
                                value: isDirty ? '—' : countsPending ? '…' : stationLeadCountsError ? '!' : (totalPotentialLeads ?? '—'),
                                Icon: Users,
                                tone: 'text-violet-600',
                                hint: isDirty ? 'يُحسب بعد الحفظ' : stationLeadCountsError ? 'تعذر الحساب' : undefined,
                            },
                        ].map(({ label, value, Icon, tone, hint }) => (
                            <div key={label} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center ${tone}`}><Icon className="w-4 h-4" /></div>
                                <div className="min-w-0">
                                    <div className="text-xs text-slate-500">{label}</div>
                                    <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
                                    {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* ── Alerts ── */}
                    {isGenerated && (
                        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 flex gap-3">
                            <Lock className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                            <div className="text-sm text-sky-900">
                                <p className="font-bold">وُلّدت جهات الاتصال لهذا الفريق — النطاق قابل للإضافة فقط</p>
                                <p className="text-sky-700 mt-0.5">
                                    يمكنك إضافة مسارات أو مناطق جديدة وإعادة ترتيب المحطات، لكن لا يمكن حذف المحطات المعلّمة بالقفل
                                    لأن جهات الاتصال المولَّدة مرتبطة بها.
                                </p>
                            </div>
                        </div>
                    )}
                    {removedFrozenZones.length > 0 && (
                        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 flex flex-wrap items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                            <p className="text-sm text-red-800 flex-1 min-w-[16rem]">
                                <span className="font-bold">لا يمكن الحفظ:</span> خرجت من النطاق محطات مجمّدة —{' '}
                                <span className="font-bold">{removedFrozenZones.join('، ')}</span>. وسّع المقطع أو أعِد المسار لتشملها.
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

                    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                        {/* ── Scope composer ── */}
                        <div className="xl:col-span-3 space-y-4">
                            {/* Routes */}
                            <section className="bg-white rounded-xl shadow-sm border border-slate-200">
                                <div className="p-4 border-b border-slate-100">
                                    <h3 className="text-slate-800 font-bold text-base flex items-center gap-2 mb-1"><RouteIcon className="w-4 h-4 text-sky-600" />المسارات</h3>
                                    <p className="text-xs text-slate-500 mb-3">اختر مساراً محفوظاً، ثم حدّد مقطع المحطات المطلوب منه واتجاه السير.</p>
                                    <div className="flex gap-2">
                                        <Select
                                            value={selectedRouteId}
                                            onChange={setSelectedRouteId}
                                            ariaLabel="المسار"
                                            className="flex-1"
                                            placeholder={availableRoutes.length ? 'اختر مساراً...' : 'كل المسارات مضافة'}
                                            options={[{ value: '', label: 'اختر مساراً...' }, ...availableRoutes.map(r => ({ value: String(r.id), label: `${r.name} (${r.points.length} محطة)` }))]}
                                        />
                                        <Button size="sm" icon={Plus} onClick={addRouteToComposition} disabled={!selectedRouteId}>إضافة</Button>
                                    </div>
                                </div>

                                <div className="p-4 space-y-3">
                                    {composition.length === 0 ? (
                                        <div className="text-center text-slate-500 py-6">
                                            <RouteIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                            <p className="text-sm">لم يُضف أي مسار بعد</p>
                                        </div>
                                    ) : composition.map((comp, idx) => {
                                        const route = savedRoutes.find(r => r.id === comp.routeId);
                                        if (!route) return null;
                                        const stations = getRouteStations(route);
                                        const maxIdx = stations.length - 1;
                                        const startPct = maxIdx > 0 ? (comp.startIdx / maxIdx * 100) : 0;
                                        const endPct = maxIdx > 0 ? (comp.endIdx / maxIdx * 100) : 100;
                                        const isForward = comp.direction === 'forward';
                                        const removeLocked = dropsFrozenZone(composition.filter((_, i) => i !== idx), extraZones);

                                        return (
                                            <motion.div key={`comp-${comp.routeId}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-slate-200 overflow-hidden">
                                                <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <div className="w-7 h-7 rounded bg-sky-100 flex items-center justify-center text-sky-700 text-xs font-bold shrink-0">{idx + 1}</div>
                                                        <span className="text-slate-900 font-bold text-sm truncate">{route.name}</span>
                                                        <span className="text-slate-500 text-xs shrink-0">{comp.endIdx - comp.startIdx + 1} من {stations.length} محطة</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleDirection(idx)}
                                                            title="تبديل اتجاه السير"
                                                            className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1 ${isForward ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100'}`}
                                                        >
                                                            {isForward ? <><ArrowRight className="w-3 h-3" />ذهاب</> : <><ArrowLeft className="w-3 h-3" />إياب</>}
                                                        </button>
                                                        <IconButton
                                                            icon={removeLocked ? Lock : X}
                                                            label={removeLocked ? 'لا يمكن حذف المسار: يحوي محطات مجمّدة' : 'حذف المسار'}
                                                            variant="danger"
                                                            size="sm"
                                                            disabled={removeLocked}
                                                            onClick={() => removeComposed(idx)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="p-4">
                                                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                                                        <span>من: <strong className="text-slate-900">{stations[comp.startIdx]?.name || '--'}</strong></span>
                                                        <span>إلى: <strong className="text-slate-900">{stations[comp.endIdx]?.name || '--'}</strong></span>
                                                    </div>
                                                    <div className="route-range-track">
                                                        <div className="route-range-fill" style={{ right: `${startPct}%`, width: `${endPct - startPct}%` }} />
                                                        <input type="range" aria-label="بداية المقطع" className="route-slider" min={0} max={maxIdx} value={comp.startIdx} onChange={e => onSliderChange(idx, 'start', parseInt(e.target.value))} />
                                                        <input type="range" aria-label="نهاية المقطع" className="route-slider" min={0} max={maxIdx} value={comp.endIdx} onChange={e => onSliderChange(idx, 'end', parseInt(e.target.value))} />
                                                    </div>
                                                    {/* Named stations — included ones highlighted, frozen ones locked */}
                                                    <div className="flex flex-wrap gap-1.5 mt-3">
                                                        {stations.map((s, si) => {
                                                            const included = si >= comp.startIdx && si <= comp.endIdx;
                                                            const frozen = isFrozenZone(s.id);
                                                            return (
                                                                <span
                                                                    key={`${s.id}-${si}`}
                                                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${included
                                                                        ? 'border-sky-200 bg-sky-50 text-sky-800 font-semibold'
                                                                        : frozen
                                                                            ? 'border-red-200 bg-red-50 text-red-700 line-through'
                                                                            : 'border-slate-200 bg-white text-slate-400'}`}
                                                                >
                                                                    {frozen && <Lock className="w-2.5 h-2.5" />}
                                                                    {s.name}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* Extra zones */}
                            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                                <h3 className="text-slate-800 font-bold text-base flex items-center gap-2 mb-1"><MapPin className="w-4 h-4 text-orange-500" />مناطق إضافية</h3>
                                <p className="text-xs text-slate-500 mb-3">ناحية أو حي خارج المسارات المختارة يعمل فيه الفريق أيضاً.</p>
                                <div className="flex flex-col sm:flex-row sm:items-end gap-2 mb-3">
                                    <div className="flex-1">
                                        <GeoSmartSearch
                                            label="أضف ناحية أو حي"
                                            geoUnits={extraZoneGeoUnits}
                                            value={extraZoneSelection}
                                            onChange={setExtraZoneSelection}
                                            minSelectableLevel={3}
                                            placeholder="ابحث عن ناحية أو حي لإضافته..."
                                        />
                                    </div>
                                    <Button size="sm" icon={Plus} onClick={commitSelectedExtraZone} disabled={!canAddSelectedExtraZone}>
                                        إضافة المنطقة
                                    </Button>
                                </div>
                                {selectedExtraZoneUnit && !canAddSelectedExtraZone && (
                                    <p className="text-xs text-slate-500 mb-2">«{selectedExtraZoneUnit.name}» ضمن النطاق مسبقاً.</p>
                                )}
                                {extraZones.length === 0 ? (
                                    <p className="text-xs text-slate-400">لا توجد مناطق إضافية.</p>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {extraZones.map((zId, idx) => {
                                            const unit = geoUnits.find(u => u.id === zId);
                                            if (!unit) return null;
                                            const removeLocked = dropsFrozenZone(composition, extraZones.filter((_, i) => i !== idx));
                                            return (
                                                <span key={zId} className="inline-flex items-center gap-1 ps-2.5 pe-1 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-orange-800 text-xs font-medium">
                                                    {unit.name}
                                                    <IconButton
                                                        icon={removeLocked ? Lock : X}
                                                        label={removeLocked ? 'منطقة مجمّدة — لا يمكن حذفها' : 'حذف المنطقة'}
                                                        variant="danger"
                                                        size="sm"
                                                        disabled={removeLocked}
                                                        onClick={() => removeExtraZone(idx)}
                                                    />
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* ── Final station sequence ── */}
                        <aside className="xl:col-span-2">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden xl:sticky xl:top-28">
                                <div className="p-4 bg-slate-50 border-b border-slate-200">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-slate-800 font-bold text-base flex items-center gap-2"><ListOrdered className="w-4 h-4 text-emerald-500" />تسلسل المحطات</h3>
                                        <span className="text-xs font-bold text-slate-500">العملاء</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {selectedTeamLabel ? `${selectedTeamLabel} — ` : ''}اسحب المحطة أو استعمل الأسهم لتغيير ترتيب الزيارة.
                                    </p>
                                </div>
                                <ol className="p-2 space-y-1 max-h-[28rem] overflow-y-auto custom-scroll">
                                    {orderedFinalZones.length === 0 ? (
                                        <li className="text-center text-slate-500 text-sm py-8">أضف مساراً أو منطقة لتظهر المحطات هنا</li>
                                    ) : orderedFinalZones.map((z, i) => {
                                        const colors = levelColors[z.level] || levelColors[4];
                                        const isDragging = draggedStationId === z.id;
                                        const frozen = isFrozenZone(z.id);
                                        const isNew = Boolean(savedAssignmentForCurrentKey) && !savedZoneIds.has(z.id);
                                        const count = stationLeadCounts?.[z.id];
                                        return (
                                            <li
                                                key={z.id}
                                                draggable
                                                onDragStart={() => setDraggedStationId(z.id)}
                                                onDragEnd={() => setDraggedStationId(null)}
                                                onDragOver={e => e.preventDefault()}
                                                onDrop={() => handleStationDrop(z.id)}
                                                className={`group flex items-center gap-2 p-2 rounded-lg border transition-colors ${isDragging ? 'bg-sky-50 border-sky-300 shadow-sm' : 'bg-slate-50 hover:bg-sky-50/60 border-transparent'}`}
                                            >
                                                <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                                                <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing shrink-0" aria-hidden="true" />
                                                <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-slate-800 text-sm truncate">{z.name}</span>
                                                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>{levelNames[z.level]}</span>
                                                    {frozen && <span title="محطة مجمّدة — لا يمكن حذفها"><Lock className="w-3 h-3 text-sky-600" aria-label="مجمّدة" /></span>}
                                                    {isNew && <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">جديدة</span>}
                                                </div>
                                                <span className="min-w-[2.5rem] text-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                                                    {isDirty ? '—' : countsPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : stationLeadCountsError ? '!' : (count ?? '—')}
                                                </span>
                                                <div className="flex flex-col opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                                                    <button type="button" onClick={() => moveStationBy(z.id, -1)} disabled={i === 0} aria-label={`تقديم ${z.name}`} className="text-slate-500 hover:text-sky-600 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                                                    <button type="button" onClick={() => moveStationBy(z.id, 1)} disabled={i === orderedFinalZones.length - 1} aria-label={`تأخير ${z.name}`} className="text-slate-500 hover:text-sky-600 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ol>
                                {orderedFinalZones.length > 0 && (
                                    <div className="p-3 border-t border-slate-200 bg-slate-50">
                                        {isDirty ? (
                                            <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                                                <Info className="w-3.5 h-3.5" />احفظ نطاق العمل ليُحسب عدد العملاء لكل محطة.
                                            </p>
                                        ) : stationLeadCountsError ? (
                                            <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                                                <AlertTriangle className="w-3.5 h-3.5" />تعذر حساب عدد العملاء.
                                                <button type="button" className="underline" onClick={() => setStationLeadCountsRefreshKey(k => k + 1)}>إعادة المحاولة</button>
                                            </p>
                                        ) : (
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500 text-sm">إجمالي العملاء المحتملين</span>
                                                <span className="text-2xl font-bold text-emerald-600">
                                                    {countsPending || totalPotentialLeads === null ? <Loader2 className="w-5 h-5 animate-spin" /> : totalPotentialLeads}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </aside>
                    </div>
                </>
            )}
        </div>
    );
}
