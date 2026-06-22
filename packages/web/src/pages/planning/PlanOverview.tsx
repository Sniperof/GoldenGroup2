import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ChevronLeft, ChevronRight, Calendar, Users, User, Route as RouteIcon,
    AlertTriangle, ArrowRight, ArrowLeft, ClipboardList, MapPin, Briefcase, Eye, Loader2,
    Layers, Megaphone, Wrench, Building2
} from 'lucide-react';
import { api } from '../../lib/api';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import type { Route, GeoUnit, DaySchedule, RouteAssignmentData, Client } from '../../lib/types';

const formatDateArabic = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

const shiftDate = (dateStr: string, days: number) => {
    try {
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        d.setDate(d.getDate() + days);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch (e) {
        return dateStr;
    }
};

// Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type MarketingTargetsResponse = {
    teamKey: string;
    leads: Client[];
    candidates: [];
    counts: {
        leads: number;
        candidates: number;
        total: number;
    };
    zoneIds: number[];
    targetStationsCount: number;
    hasSupervisor: boolean;
    supervisorEmployeeId: number | null;
    supervisorHrUserId: number | null;
    reason?: string | null;
};

const emptyMarketingLoad = {
    total: 0,
    candidates: [] as any[],
    leads: [] as Client[],
};

export default function PlanOverview() {
    const navigate = useNavigate();
    // React to the external branch switcher (no full reload — §4): refetch when the
    // selected branch changes so the schedule/teams reflect the new branch context.
    const branchId = useBranchContextStore(s => s.branchId);
    const [date, setDate] = useState(getPlanningDate);
    const [loading, setLoading] = useState(true);

    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [savedRoutes, setSavedRoutes] = useState<Route[]>([]);
    const [currentSchedule, setCurrentSchedule] = useState<DaySchedule>({ teams: [], solos: [] });
    const [routeAssignments, setRouteAssignments] = useState<Record<string, RouteAssignmentData>>({});
    const [employees, setEmployees] = useState<any[]>([]);
    const [marketingTargets, setMarketingTargets] = useState<Record<string, MarketingTargetsResponse>>({});
    const [workScopes, setWorkScopes] = useState<Record<string, any>>({});

    useEffect(() => {
        let cancelled = false;
        const loadAll = async () => {
            setLoading(true);
            setMarketingTargets({});
            try {
                const [geo, routes, schedule, assignments, emps] = await Promise.all([
                    api.geoUnits.list(),
                    api.routes.list(),
                    api.schedules.get(date),
                    api.routeAssignments.list(),
                    api.employees.list(),
                ]);
                if (cancelled) return;
                setGeoUnits(geo);
                setSavedRoutes(routes);
                setCurrentSchedule(schedule || { teams: [], solos: [] });
                setRouteAssignments(assignments || {});
                setEmployees(emps);
            } catch (err) {
                console.error('Failed to load plan overview data:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadAll();
        return () => { cancelled = true; };
    }, [date, branchId]);

    const isPlanningDate = date === getPlanningDate();

    const getEmp = (id: number | null) => employees.find(e => e.id === id) || null;
    const getUnitName = (id: number) => geoUnits.find(u => u.id === id)?.name || '??';

    const getRouteStations = (route: Route) =>
        route.points.sort((a, b) => a.order - b.order).map(p => ({
            id: p.geoUnitId, name: getUnitName(p.geoUnitId), level: p.level
        }));

    const buildTeamCards = () => {
        const cards: {
            key: string;
            type: 'team' | 'solo';
            label: string;
            supervisor: ReturnType<typeof getEmp>;
            technician: ReturnType<typeof getEmp>;
            assignment: RouteAssignmentData | null;
        }[] = [];

        (currentSchedule.teams || []).forEach((t, idx) => {
            // Foreign-branch slots arrive redacted to `{ locked: true }` (GAP-DS-005);
            // they belong to another branch's plan — skip them, but keep idx so the
            // team_key index stays aligned with route_assignments.
            if ((t as any)?.locked === true) return;
            const teamKey = `team_${idx}`;
            const assignmentKey = `${date}_${teamKey}`;
            const sup = getEmp(t.supervisor);
            const tech = getEmp(t.technician);
            cards.push({
                key: teamKey,
                type: 'team',
                label: sup ? `فريق ${sup.name}` : `فريق #${idx + 1}`,
                supervisor: sup,
                technician: tech,
                assignment: routeAssignments[assignmentKey] || null,
            });
        });

        (currentSchedule.solos || []).forEach((s, idx) => {
            if ((s as any)?.locked === true) return;   // foreign-branch solo slot — skip, keep idx
            const soloKey = `solo_${idx}`;
            const assignmentKey = `${date}_${soloKey}`;
            const tech = getEmp(s.technician);
            cards.push({
                key: soloKey,
                type: 'solo',
                label: tech ? `طوارئ: ${tech.name}` : `فريق طوارئ #${idx + 1}`,
                supervisor: null,
                technician: tech,
                assignment: routeAssignments[assignmentKey] || null,
            });
        });

        return cards;
    };

    const teamCards = useMemo(
        () => buildTeamCards(),
        [currentSchedule, date, employees, routeAssignments]
    );

    useEffect(() => {
        let cancelled = false;
        const cardsWithAssignments = teamCards.filter(card => card.assignment && card.assignment.routes.length > 0);

        if (cardsWithAssignments.length === 0) {
            setMarketingTargets({});
            return () => { cancelled = true; };
        }

        const loadMarketingTargets = async () => {
            const entries = await Promise.all(cardsWithAssignments.map(async (card) => {
                try {
                    const result = await api.planning.marketingTargets(date, card.key);
                    if (result?.reason) {
                        console.warn(`Marketing targets for ${card.key} returned empty: ${result.reason}`);
                    }
                    return [card.key, result as MarketingTargetsResponse] as const;
                } catch (err) {
                    console.warn(`Failed to load marketing targets for ${card.key}; using empty load only.`, err);
                    return [card.key, {
                        teamKey: card.key,
                        leads: [],
                        candidates: [],
                        counts: { leads: 0, candidates: 0, total: 0 },
                        zoneIds: [],
                        targetStationsCount: 0,
                        hasSupervisor: false,
                        supervisorEmployeeId: null,
                        supervisorHrUserId: null,
                        reason: 'REQUEST_FAILED',
                    } satisfies MarketingTargetsResponse] as const;
                }
            }));

            if (!cancelled) {
                setMarketingTargets(Object.fromEntries(entries));
            }
        };

        loadMarketingTargets();
        return () => { cancelled = true; };
    }, [date, teamCards]);

    useEffect(() => {
        let cancelled = false;
        const cardsWithAssignments = teamCards.filter(card => card.assignment && card.assignment.routes.length > 0);
        if (cardsWithAssignments.length === 0) {
            setWorkScopes({});
            return () => { cancelled = true; };
        }

        const loadWorkScopes = async () => {
            const entries = await Promise.all(cardsWithAssignments.map(async (card) => {
                try {
                    const result = await api.workScopes.get(date, card.key);
                    return [card.key, result] as const;
                } catch {
                    return [card.key, null] as const;
                }
            }));
            if (!cancelled) {
                const validEntries = entries.filter(([, v]) => v !== null);
                setWorkScopes(Object.fromEntries(validEntries));
            }
        };

        loadWorkScopes();
        return () => { cancelled = true; };
    }, [date, teamCards]);

    const getAssignmentDetails = (assignment: RouteAssignmentData) => {
        const results: {
            routeName: string;
            startName: string;
            endName: string;
            direction: 'forward' | 'reverse';
            stationCount: number;
        }[] = [];

        assignment.routes.forEach(comp => {
            const route = savedRoutes.find(r => r.id === comp.routeId);
            if (!route) return;
            const stations = getRouteStations(route);
            let slice = stations.slice(comp.startIdx, comp.endIdx + 1);
            if (comp.direction === 'reverse') slice = slice.reverse();
            results.push({
                routeName: route.name,
                startName: slice[0]?.name || '--',
                endName: slice[slice.length - 1]?.name || '--',
                direction: comp.direction,
                stationCount: slice.length,
            });
        });

        return results;
    };

    const openContactTargetsPage = (team: { key: string; label: string }) => {
        const query = new URLSearchParams({ date, label: team.label });
        navigate(`/planning/contact-targets/${team.key}?${query.toString()}`);
    };

    const totalTeams = teamCards.length;
    const assignedTeams = teamCards.filter(c => c.assignment && c.assignment.routes.length > 0).length;
    const unassignedTeams = totalTeams - assignedTeams;

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

    return (
        <div className="h-full overflow-y-auto p-8 custom-scroll">
            {/* Header */}
            <div className="flex items-end justify-between mb-6">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 mb-1">ملخص الخطة</h1>
                    <p className="text-slate-500 text-sm">نظرة شاملة على جداول العمل اليومية — من يذهب إلى أين.</p>
                </div>
            </div>

            {/* Date Navigator */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex items-center justify-center gap-4">
                <button
                    onClick={() => setDate(d => shiftDate(d, -1))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-slate-700 hover:bg-gray-50 hover:border-gray-300 text-sm transition-all active:scale-95 z-10"
                >
                    <ChevronRight className="w-4 h-4" />
                    <span>اليوم السابق</span>
                </button>

                <div
                    className="flex items-center gap-3 px-6 py-2 rounded-xl bg-gray-50 border border-gray-200 relative group/cal cursor-pointer hover:bg-white hover:border-sky-300 transition-all shadow-sm"
                    onClick={(e) => {
                        const input = e.currentTarget.querySelector('input');
                        if (input) input.showPicker();
                    }}
                >
                    <Calendar className="w-5 h-5 text-sky-600 group-hover/cal:scale-110 transition-transform" />
                    <div className="text-center pointer-events-none">
                        <p className="text-slate-900 font-bold">{formatDateArabic(date)}</p>
                        {isPlanningDate && <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">خطة الغد</span>}
                    </div>
                    {/* Native Date Input Overlay */}
                    <input
                        type="date"
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        value={date}
                        onChange={(e) => {
                            if (e.target.value) setDate(e.target.value);
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>

                <button
                    onClick={() => setDate(d => shiftDate(d, 1))}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-slate-700 hover:bg-gray-50 hover:border-gray-300 text-sm transition-all active:scale-95 z-10"
                >
                    <span>اليوم التالي</span>
                    <ChevronLeft className="w-4 h-4" />
                </button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center">
                        <Users className="w-5 h-5 text-sky-600" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-slate-900">{totalTeams}</p>
                        <p className="text-xs text-slate-500">إجمالي الفرق</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <RouteIcon className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-emerald-600">{assignedTeams}</p>
                        <p className="text-xs text-slate-500">فرق تم تعيين مسار لها</p>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${unassignedTeams > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                        <AlertTriangle className={`w-5 h-5 ${unassignedTeams > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
                    </div>
                    <div>
                        <p className={`text-2xl font-bold ${unassignedTeams > 0 ? 'text-amber-500' : 'text-slate-500'}`}>{unassignedTeams}</p>
                        <p className="text-xs text-slate-500">بدون مسار</p>
                    </div>
                </div>
            </div>

            {/* Team Cards Grid */}
            {teamCards.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 py-16 text-center">
                    <ClipboardList className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                    <p className="text-slate-700 text-lg font-medium mb-2">لا يوجد جدول لهذا التاريخ</p>
                    <p className="text-slate-500 text-sm mb-6">انتقل إلى "جدولة الفرق" لإنشاء جدول يومي أولاً.</p>
                    <button
                        onClick={() => navigate('/planning/schedule')}
                        className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-all"
                    >
                        <Users className="w-4 h-4" />
                        <span>إنشاء جدول</span>
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {teamCards.map((card, cardIdx) => {
                        const hasAssignment = card.assignment && card.assignment.routes.length > 0;
                        const routeDetails = hasAssignment ? getAssignmentDetails(card.assignment!) : [];
                        const targetData = hasAssignment ? marketingTargets[card.key] : null;
                        const loadData = targetData ? {
                            total: targetData.counts.total,
                            candidates: [],
                            leads: targetData.leads || [],
                        } : emptyMarketingLoad;
                        const extraZoneCount = card.assignment?.extraZones?.length || 0;

                        return (
                            <motion.div
                                key={card.key}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: cardIdx * 0.05 }}
                                onClick={() => {
                                    if (hasAssignment) openContactTargetsPage({
                                        key: card.key,
                                        label: card.label,
                                    });
                                }}
                                className={`bg-white rounded-xl shadow-sm overflow-hidden border cursor-pointer hover:border-gray-300 transition-colors ${hasAssignment
                                    ? 'border-gray-200'
                                    : 'border-amber-300'
                                    }`}
                            >
                                {/* Card Header */}
                                <div className={`p-4 border-b border-gray-200 flex items-center justify-between ${card.type === 'solo' ? 'bg-orange-50' : 'bg-gray-50'
                                    }`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${card.type === 'solo' ? 'bg-orange-100 text-orange-600' : 'bg-sky-50 text-sky-600'
                                            }`}>
                                            {card.type === 'solo' ? <User className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <p className="text-slate-900 font-bold text-sm">{card.label}</p>
                                            <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                                                {card.type === 'solo' ? 'فريق طوارئ' : 'فريق قياسي'}
                                            </p>
                                        </div>
                                    </div>
                                    {hasAssignment && (
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5 text-xs">
                                                <Briefcase className="w-3.5 h-3.5 text-emerald-600" />
                                                <span className="text-emerald-600 font-bold">{loadData.total} مهمة</span>
                                                <span className="text-slate-400">({loadData.leads.length} Lead)</span>
                                            </div>
                                            {/* Button moved to modal */}
                                            <button
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    openContactTargetsPage({
                                                        key: card.key,
                                                        label: card.label,
                                                    });
                                                }}
                                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-[11px] font-bold transition-colors"
                                            >
                                                <Eye className="w-3 h-3" />
                                                <span>أهداف الاتصال</span>
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Staff Section */}
                                <div className="p-4 border-b border-gray-100">
                                    <div className="flex items-center gap-3">
                                        {card.supervisor && (
                                            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200">
                                                <img src={card.supervisor.avatar} alt="" className="w-7 h-7 rounded-full ring-2 ring-sky-200" />
                                                <div>
                                                    <p className="text-xs text-slate-800 font-medium leading-tight">{card.supervisor.name}</p>
                                                    <p className="text-[10px] text-sky-600">مشرف</p>
                                                </div>
                                            </div>
                                        )}
                                        {card.technician && (
                                            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200">
                                                <img src={card.technician.avatar} alt="" className="w-7 h-7 rounded-full ring-2 ring-emerald-200" />
                                                <div>
                                                    <p className="text-xs text-slate-800 font-medium leading-tight">{card.technician.name}</p>
                                                    <p className="text-[10px] text-emerald-600">فني</p>
                                                </div>
                                            </div>
                                        )}
                                        {!card.supervisor && !card.technician && (
                                            <p className="text-xs text-slate-500 italic">لم يتم تعيين طاقم</p>
                                        )}
                                    </div>
                                </div>

                                {/* Route Assignment Section */}
                                <div className="p-4">
                                    {hasAssignment ? (
                                        <div className="space-y-2.5">
                                            {routeDetails.map((rd, ri) => (
                                                <div key={ri} className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <RouteIcon className="w-4 h-4 text-sky-600" />
                                                            <span className="text-slate-900 font-bold text-sm">{rd.routeName}</span>
                                                        </div>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${rd.direction === 'forward'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : 'bg-orange-50 text-orange-700 border border-orange-200'
                                                            }`}>
                                                            {rd.direction === 'forward' ? (
                                                                <><ArrowRight className="w-3 h-3" />ذهاب</>
                                                            ) : (
                                                                <><ArrowLeft className="w-3 h-3" />إياب</>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <span className="text-slate-500">من:</span>
                                                        <span className="text-slate-800 font-medium bg-white px-2 py-0.5 rounded border border-gray-200">{rd.startName}</span>
                                                        <ArrowLeft className="w-3 h-3 text-slate-400" />
                                                        <span className="text-slate-500">إلى:</span>
                                                        <span className="text-slate-800 font-medium bg-white px-2 py-0.5 rounded border border-gray-200">{rd.endName}</span>
                                                        <span className="text-slate-500 mr-auto">({rd.stationCount} محطة)</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {extraZoneCount > 0 && (
                                                <div className="flex items-center gap-1.5 text-xs text-orange-600">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    <span>+ {extraZoneCount} مناطق إضافية</span>
                                                </div>
                                            )}
                                            <button
                                                onClick={() => navigate('/planning/assign')}
                                                className="w-full mt-1 py-2 rounded-lg border border-gray-200 text-slate-700 hover:bg-gray-50 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                <RouteIcon className="w-3.5 h-3.5" />
                                                <span>تعديل التعيين</span>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-center py-4">
                                            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
                                                <AlertTriangle className="w-6 h-6 text-amber-500" />
                                            </div>
                                            <p className="text-amber-600 font-bold text-sm mb-1">⚠️ لا يوجد مسار معين</p>
                                            <p className="text-slate-500 text-xs mb-4">هذا الفريق لم يتم تعيين مسار له بعد.</p>
                                            <button
                                                onClick={() => navigate('/planning/assign')}
                                                className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all"
                                            >
                                                <MapPin className="w-4 h-4" />
                                                <span>تعيين الآن</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* Work Scope Summary Section */}
            {Object.keys(workScopes).length > 0 && (
                <div className="mt-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Layers className="w-5 h-5 text-violet-600" />
                        <h2 className="text-base font-bold text-slate-800">نطاق العمل العام</h2>
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">جميع أنواع المهام</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {Object.entries(workScopes).map(([key, scope]) => {
                            if (!scope) return null;
                            const counts = scope.counts ?? { marketing: 0, emergency: 0, service: 0, other: 0, total: 0 };
                            const card = teamCards.find(c => c.key === key);

                            return (
                                <motion.div
                                    key={key}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-white rounded-xl border border-violet-100 shadow-sm overflow-hidden"
                                >
                                    <div className="flex items-center justify-between px-4 py-3 bg-violet-50 border-b border-violet-100">
                                        <div className="flex items-center gap-2">
                                            <Layers className="w-4 h-4 text-violet-600" />
                                            <span className="text-sm font-bold text-violet-800">
                                                {card?.label ?? key}
                                            </span>
                                        </div>
                                        <span className="text-xs font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
                                            {counts.total} مهمة
                                        </span>
                                    </div>
                                    <div className="p-4 grid grid-cols-3 gap-3">
                                        <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                                            <Megaphone className="w-4 h-4 text-emerald-600" />
                                            <span className="text-lg font-black text-emerald-700">{counts.marketing}</span>
                                            <span className="text-[10px] text-emerald-600 font-medium">تسويق</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-red-50 border border-red-100">
                                            <AlertTriangle className="w-4 h-4 text-red-500" />
                                            <span className="text-lg font-black text-red-600">{counts.emergency}</span>
                                            <span className="text-[10px] text-red-500 font-medium">طوارئ</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-1 p-2 rounded-lg bg-blue-50 border border-blue-100">
                                            <Wrench className="w-4 h-4 text-blue-500" />
                                            <span className="text-lg font-black text-blue-600">{counts.service + counts.other}</span>
                                            <span className="text-[10px] text-blue-500 font-medium">خدمة/أخرى</span>
                                        </div>
                                    </div>
                                    {/* Company-owned task indicator */}
                                    {scope.tasks?.some((t: any) => t.ownershipType === 'company_branch') && (
                                        <div className="px-4 pb-3">
                                            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
                                                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                                                <span>
                                                    {scope.tasks.filter((t: any) => t.ownershipType === 'company_branch').length} مهمة مملوكة للشركة (OP/FOP/فرع)
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            )}

        </div>
    );
}
