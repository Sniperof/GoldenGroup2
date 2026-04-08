import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Users, Save, Plus, MapPin, Route as RouteIcon, ListOrdered, Calculator, X, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { levelNames } from '../../lib/geoConstants';
import type { Route, GeoUnit, DaySchedule, RouteComposition, RouteAssignmentData } from '../../lib/types';

const levelColors: Record<number, { bg: string; text: string; border: string }> = {
    1: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    2: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    3: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    4: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

const getToday = () => new Date().toISOString().split('T')[0];

export default function RouteAssigner() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [savedRoutes, setSavedRoutes] = useState<Route[]>([]);
    const [schedules, setSchedules] = useState<Record<string, DaySchedule>>({});
    const [clients, setClients] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [routeAssignments, setRouteAssignments] = useState<Record<string, RouteAssignmentData>>({});

    const [date, setDate] = useState(getToday);
    const [selectedTeam, setSelectedTeam] = useState('');
    const [composition, setComposition] = useState<RouteComposition[]>([]);
    const [extraZones, setExtraZones] = useState<number[]>([]);
    const [selectedRouteId, setSelectedRouteId] = useState('');
    const [loadCount, setLoadCount] = useState<number | null>(null);

    const allGeoUnits = geoUnits;

    const currentKey = date + '_' + selectedTeam;

    useEffect(() => {
        let cancelled = false;
        const loadAll = async () => {
            setLoading(true);
            try {
                const [geo, routes, cls, emps, assignments] = await Promise.all([
                    api.geoUnits.list(),
                    api.routes.list(),
                    api.clients.list(),
                    api.employees.list(),
                    api.routeAssignments.list(),
                ]);
                if (cancelled) return;
                setGeoUnits(geo);
                setSavedRoutes(routes);
                setClients(cls);
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
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loadSchedule = async () => {
            if (schedules[date]) return;
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
    }, [date]);

    const teamOptions = useMemo(() => {
        const sched = schedules[date];
        if (!sched) return [];
        const opts: { value: string; label: string }[] = [];
        (sched.teams || []).forEach((t, idx) => {
            const sup = t.supervisor ? employees.find(e => e.id === t.supervisor) : null;
            opts.push({ value: `team_${idx}`, label: sup ? `فريق ${sup.name}` : `فريق #${idx + 1}` });
        });
        (sched.solos || []).forEach((s, idx) => {
            const tech = s.technician ? employees.find(e => e.id === s.technician) : null;
            opts.push({ value: `solo_${idx}`, label: tech ? `فردي: ${tech.name}` : `وحدة فردية #${idx + 1}` });
        });
        return opts;
    }, [schedules, date, employees]);

    const onDateChange = (newDate: string) => {
        setDate(newDate);
        setSelectedTeam('');
        setComposition([]);
        setExtraZones([]);
        setLoadCount(null);
    };

    const onTeamChange = (val: string) => {
        setSelectedTeam(val);
        const key = date + '_' + val;
        const saved = routeAssignments[key];
        if (saved) {
            setComposition(JSON.parse(JSON.stringify(saved.routes || [])));
            setExtraZones([...(saved.extraZones || [])]);
        } else {
            setComposition([]);
            setExtraZones([]);
        }
        setLoadCount(null);
    };

    const getRouteStations = useCallback((route: Route) => {
        return route.points.sort((a, b) => a.order - b.order).map(p => {
            const unit = geoUnits.find(u => u.id === p.geoUnitId);
            return unit ? { id: unit.id, name: unit.name, level: p.level } : { id: p.geoUnitId, name: '??', level: p.level };
        });
    }, [geoUnits]);

    const addRouteToComposition = () => {
        const routeId = parseInt(selectedRouteId);
        if (!routeId) { alert('اختر مساراً أولاً'); return; }
        if (!selectedTeam) { alert('اختر الفريق أولاً'); return; }
        const route = savedRoutes.find(r => r.id === routeId);
        if (!route) return;
        setComposition(c => [...c, { routeId, startIdx: 0, endIdx: route.points.length - 1, direction: 'forward' }]);
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

    const addExtraZone = (val: string) => {
        const id = parseInt(val);
        if (!id || extraZones.includes(id)) return;
        setExtraZones(z => [...z, id]);
    };

    const removeExtraZone = (idx: number) => setExtraZones(z => z.filter((_, i) => i !== idx));

    const finalZones = useMemo(() => {
        const zones: { id: number; name: string; level: number }[] = [];
        composition.forEach(comp => {
            const route = savedRoutes.find(r => r.id === comp.routeId);
            if (!route) return;
            const stations = getRouteStations(route);
            let slice = stations.slice(comp.startIdx, comp.endIdx + 1);
            if (comp.direction === 'reverse') slice = slice.reverse();
            slice.forEach(s => { if (!zones.some(z => z.id === s.id)) zones.push(s); });
        });
        extraZones.forEach(zId => {
            if (!zones.some(z => z.id === zId)) {
                const unit = geoUnits.find(u => u.id === zId);
                if (unit) zones.push({ id: unit.id, name: unit.name, level: unit.level });
            }
        });
        return zones;
    }, [composition, extraZones, savedRoutes, geoUnits, getRouteStations]);

    const calculateLoad = () => {
        const zoneIds = finalZones.map(z => z.id);
        const count = clients.filter((c: any) => zoneIds.includes(parseInt(c.neighborhood))).length;
        setLoadCount(count);
    };

    const saveAssignment = async () => {
        if (!selectedTeam) { alert('اختر الفريق أولاً'); return; }
        setSaving(true);
        try {
            const data = { routes: JSON.parse(JSON.stringify(composition)), extraZones: [...extraZones] };
            await api.routeAssignments.save(currentKey, data);
            setRouteAssignments(prev => ({ ...prev, [currentKey]: data }));
            alert('تم حفظ تعيين المسار!');
        } catch (err) {
            console.error('Failed to save assignment:', err);
            alert('حدث خطأ أثناء الحفظ');
        } finally {
            setSaving(false);
        }
    };

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
            <div className="flex items-end justify-between mb-6">
                <div>
                    <h1 className="text-xl font-bold text-slate-900 mb-1">تعيين المسارات</h1>
                    <p className="text-slate-500 text-sm">تحديد مناطق عمل كل فريق بدقة لليوم المحدد.</p>
                </div>
            </div>

            {/* Context Bar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-sky-600" />
                    <input type="date" value={date} onChange={e => onDateChange(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none" />
                </div>
                <div className="h-8 w-px bg-gray-200" />
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-sky-600" />
                    <select value={selectedTeam} onChange={e => onTeamChange(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none w-56">
                        <option value="">اختر الفريق...</option>
                        {teamOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div className="mr-auto">
                    <button onClick={saveAssignment} disabled={saving} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-all">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}<span>حفظ التعيين</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-5 gap-6">
                {/* Left: Route Composer */}
                <div className="col-span-3 space-y-4">
                    {/* Add Route */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2"><RouteIcon className="w-4 h-4 text-sky-600" />تركيب المسار</h3>
                            <button onClick={addRouteToComposition} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
                                <Plus className="w-3.5 h-3.5" /><span>إضافة مسار</span>
                            </button>
                        </div>
                        <select value={selectedRouteId} onChange={e => setSelectedRouteId(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none">
                            <option value="">اختر مساراً محدداً مسبقاً...</option>
                            {savedRoutes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </div>

                    {/* Composed Routes */}
                    <div className="space-y-3">
                        {composition.length === 0 ? (
                            <div className="text-center text-slate-500 py-6">
                                <RouteIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">اختر مساراً واضغط "إضافة" لبدء التركيب</p>
                            </div>
                        ) : composition.map((comp, idx) => {
                            const route = savedRoutes.find(r => r.id === comp.routeId);
                            if (!route) return null;
                            const stations = getRouteStations(route);
                            const maxIdx = stations.length - 1;
                            const startPct = maxIdx > 0 ? (comp.startIdx / maxIdx * 100) : 0;
                            const endPct = maxIdx > 0 ? (comp.endIdx / maxIdx * 100) : 100;
                            const isForward = comp.direction === 'forward';

                            return (
                                <motion.div key={`comp-${idx}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-7 h-7 rounded bg-sky-50 flex items-center justify-center text-sky-600 text-xs font-bold">{idx + 1}</div>
                                            <span className="text-slate-900 font-bold text-sm">{route.name}</span>
                                            <span className="text-slate-500 text-xs">({comp.endIdx - comp.startIdx + 1} / {stations.length} محطة)</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => toggleDirection(idx)} className={`px-2.5 py-1 rounded border text-xs font-bold transition-all flex items-center gap-1 ${isForward ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-orange-200 text-orange-700 bg-orange-50'}`}>
                                                {isForward ? <><ArrowRight className="w-3 h-3" />ذهاب</> : <><ArrowLeft className="w-3 h-3" />إياب</>}
                                            </button>
                                            <button onClick={() => removeComposed(idx)} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                                            <span>بداية: <strong className="text-slate-900">{stations[comp.startIdx]?.name || '--'}</strong></span>
                                            <span>نهاية: <strong className="text-slate-900">{stations[comp.endIdx]?.name || '--'}</strong></span>
                                        </div>
                                        <div className="route-range-track">
                                            <div className="route-range-fill" style={{ right: `${startPct}%`, width: `${endPct - startPct}%` }} />
                                            <input type="range" className="route-slider" min={0} max={maxIdx} value={comp.startIdx} onChange={e => onSliderChange(idx, 'start', parseInt(e.target.value))} />
                                            <input type="range" className="route-slider" min={0} max={maxIdx} value={comp.endIdx} onChange={e => onSliderChange(idx, 'end', parseInt(e.target.value))} />
                                        </div>
                                        <div className="flex justify-between mt-2">
                                            {stations.map((s, si) => (
                                                <div key={si} className="flex flex-col items-center" title={s.name}>
                                                    <div className={`w-2.5 h-2.5 rounded-full ${si >= comp.startIdx && si <= comp.endIdx ? 'bg-sky-500' : 'bg-gray-200'}`} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Extra Zones */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2 mb-3"><MapPin className="w-4 h-4 text-orange-500" />مناطق إضافية</h3>
                        <div className="flex gap-2 mb-3">
                            <select onChange={e => { addExtraZone(e.target.value); e.target.value = ''; }} className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none">
                                <option value="">اختر منطقة...</option>
                                {allGeoUnits.filter(n => !extraZones.includes(n.id)).map(n => <option key={n.id} value={n.id}>{n.name} ({levelNames[n.level]})</option>)}
                            </select>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {extraZones.map((zId, idx) => {
                                const unit = geoUnits.find(u => u.id === zId);
                                if (!unit) return null;
                                return (
                                    <span key={zId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-700 text-xs font-medium">
                                        {unit.name}
                                        <button onClick={() => removeExtraZone(idx)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right: Final Sequence */}
                <div className="col-span-2">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-0">
                        <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2"><ListOrdered className="w-4 h-4 text-emerald-500" />التسلسل النهائي</h3>
                            <button onClick={calculateLoad} className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
                                <Calculator className="w-3.5 h-3.5" /><span>حساب الحمل</span>
                            </button>
                        </div>
                        <div className="p-3 space-y-1 max-h-96 overflow-y-auto custom-scroll">
                            {finalZones.length === 0 ? (
                                <p className="text-center text-slate-500 text-sm py-6">لا توجد مناطق بعد</p>
                            ) : finalZones.map((z, i) => {
                                const colors = levelColors[z.level] || levelColors[4];
                                return (
                                    <div key={z.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 hover:bg-sky-50 transition-colors">
                                        <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                                        <span className="text-slate-800 text-sm">{z.name}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>{levelNames[z.level]}</span>
                                        {i < finalZones.length - 1 && <ArrowLeft className="w-3 h-3 text-slate-400 mr-auto" />}
                                    </div>
                                );
                            })}
                        </div>
                        {loadCount !== null && (
                            <div className="p-3 border-t border-gray-200 bg-gray-50">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 text-sm">عدد الزبائن المتوقع:</span>
                                    <span className="text-2xl font-bold text-emerald-600">{loadCount}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
