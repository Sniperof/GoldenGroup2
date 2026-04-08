import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    ChevronLeft, ChevronRight, Calendar, Users, User, Route as RouteIcon,
    AlertTriangle, ArrowRight, ArrowLeft, ClipboardList, MapPin, Briefcase, Eye, PhoneCall, Loader2
} from 'lucide-react';
import { api } from '../../lib/api';
import { levelNames } from '../../lib/geoConstants';
import type { Route, GeoUnit, DaySchedule, RouteAssignmentData, Contract, Visit } from '../../lib/types';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { useClientStore } from '../../hooks/useClientStore';
import { useTelemarketingStore } from '../../hooks/useTelemarketingStore';
import TeamDetailsModal from '../../components/planning/TeamDetailsModal';

const levelColors: Record<number, { bg: string; text: string }> = {
    1: { bg: 'bg-purple-50', text: 'text-purple-700' },
    2: { bg: 'bg-blue-50', text: 'text-blue-700' },
    3: { bg: 'bg-amber-50', text: 'text-amber-700' },
    4: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

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

const getToday = () => new Date().toISOString().split('T')[0];

export default function PlanOverview() {
    const navigate = useNavigate();
    const [date, setDate] = useState(getToday);
    const [loading, setLoading] = useState(true);

    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [savedRoutes, setSavedRoutes] = useState<Route[]>([]);
    const [currentSchedule, setCurrentSchedule] = useState<DaySchedule>({ teams: [], solos: [] });
    const [routeAssignments, setRouteAssignments] = useState<Record<string, RouteAssignmentData>>({});
    const [clients, setClients] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);

    const candidates = useCandidateStore(state => state.candidates);
    const { getLeads } = useClientStore();
    const generateTaskList = useTelemarketingStore(state => state.generateTaskList);

    const [selectedModalTeam, setSelectedModalTeam] = useState<{
        key: string;
        label: string;
        candidates: any[];
        leads: any[];
    } | null>(null);

    useEffect(() => {
        let cancelled = false;
        const loadAll = async () => {
            setLoading(true);
            try {
                const [geo, routes, schedule, assignments, cls, emps, cts, vis] = await Promise.all([
                    api.geoUnits.list(),
                    api.routes.list(),
                    api.schedules.get(date),
                    api.routeAssignments.list(),
                    api.clients.list(),
                    api.employees.list(),
                    api.contracts.list(),
                    api.visits.list(),
                ]);
                if (cancelled) return;
                setGeoUnits(geo);
                setSavedRoutes(routes);
                setCurrentSchedule(schedule || { teams: [], solos: [] });
                setRouteAssignments(assignments || {});
                setClients(cls);
                setEmployees(emps);
                setContracts(cts);
                setVisits(vis);
            } catch (err) {
                console.error('Failed to load plan overview data:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        loadAll();
        return () => { cancelled = true; };
    }, [date]);

    const activeLeads = useMemo(() => getLeads(contracts, visits), [getLeads, contracts, visits, clients]);

    const isToday = date === getToday();

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
            const soloKey = `solo_${idx}`;
            const assignmentKey = `${date}_${soloKey}`;
            const tech = getEmp(s.technician);
            cards.push({
                key: soloKey,
                type: 'solo',
                label: tech ? `فردي: ${tech.name}` : `وحدة فردية #${idx + 1}`,
                supervisor: null,
                technician: tech,
                assignment: routeAssignments[assignmentKey] || null,
            });
        });

        return cards;
    };

    const teamCards = buildTeamCards();

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

    const getMarketingLoad = (assignment: RouteAssignmentData) => {
        const zoneIds = new Set<number>();
        assignment.routes.forEach(comp => {
            const route = savedRoutes.find(r => r.id === comp.routeId);
            if (!route) return;
            const stations = getRouteStations(route);
            stations.slice(comp.startIdx, comp.endIdx + 1).forEach(s => zoneIds.add(s.id));
        });
        assignment.extraZones.forEach(id => zoneIds.add(id));

        const matchedCandidates = candidates.filter(c =>
            c.status === 'FollowUp' && c.geoUnitId && zoneIds.has(c.geoUnitId)
        );
        const matchedLeads = activeLeads.filter(c =>
            c.neighborhood && zoneIds.has(parseInt(c.neighborhood))
        );

        return {
            total: matchedCandidates.length + matchedLeads.length,
            candidates: matchedCandidates,
            leads: matchedLeads
        };
    };

    const handleGenerateList = (teamKey: string, candList: any[], leadList: any[]) => {
        if (!confirm(`هل أنت متأكد من توليد قائمة اتصال بـ ${candList.length + leadList.length} زبون لهذا الفريق؟`)) return;

        const items = [
            ...candList.map(c => ({
                entityType: 'candidate' as const,
                entityId: c.id,
                name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.nickname || 'بدون اسم',
                mobile: c.mobile,
                addressText: c.addressText,
                geoUnitId: c.geoUnitId
            })),
            ...leadList.map(l => ({
                entityType: 'client' as const,
                entityId: l.id,
                name: l.name,
                mobile: l.mobile,
                addressText: getUnitName(parseInt(l.neighborhood)) || l.neighborhood,
                geoUnitId: parseInt(l.neighborhood) || null
            }))
        ];

        generateTaskList(teamKey, date, items);
        alert('تم توليد قائمة التسويق الهاتفي بنجاح!');
        setSelectedModalTeam(null);
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
                    <span>الأمس</span>
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
                        {isToday && <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">اليوم</span>}
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
                    <span>الغد</span>
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
                    <p className="text-slate-700 text-lg font-medium mb-2">لا يوجد جدول لهذا اليوم</p>
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
                        const loadData = hasAssignment ? getMarketingLoad(card.assignment!) : { total: 0, candidates: [], leads: [] };
                        const extraZoneCount = card.assignment?.extraZones?.length || 0;

                        return (
                            <motion.div
                                key={card.key}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: cardIdx * 0.05 }}
                                onClick={() => {
                                    if (hasAssignment) setSelectedModalTeam({
                                        key: card.key,
                                        label: card.label,
                                        candidates: loadData.candidates,
                                        leads: loadData.leads
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
                                                {card.type === 'solo' ? 'وحدة فردية' : 'فريق قياسي'}
                                            </p>
                                        </div>
                                    </div>
                                    {hasAssignment && (
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5 text-xs">
                                                <Briefcase className="w-3.5 h-3.5 text-emerald-600" />
                                                <span className="text-emerald-600 font-bold">{loadData.total} مهمة</span>
                                                <span className="text-slate-400">({loadData.candidates.length} متابعة + {loadData.leads.length} محتمل)</span>
                                            </div>
                                            {/* Button moved to modal */}
                                            <button
                                                onClick={() => navigate(`/planning/team-tasks/${card.key}`)}
                                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-[11px] font-bold transition-colors"
                                            >
                                                <Eye className="w-3 h-3" />
                                                <span>عرض المهام</span>
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

            <TeamDetailsModal
                isOpen={!!selectedModalTeam}
                onClose={() => setSelectedModalTeam(null)}
                teamKey={selectedModalTeam?.key || ''}
                teamLabel={selectedModalTeam?.label || ''}
                candidates={selectedModalTeam?.candidates || []}
                leads={selectedModalTeam?.leads || []}
                geoUnits={geoUnits}
                onGenerate={handleGenerateList}
            />
        </div>
    );
}
