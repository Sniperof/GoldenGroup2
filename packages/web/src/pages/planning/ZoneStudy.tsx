import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Calendar, RefreshCw, Loader2, Lock, Plus, X, ArrowRight, ArrowLeft,
    LayoutGrid, Info, MapPin,
} from 'lucide-react';
import { api } from '../../lib/api';
import GeoSmartSearch, { type GeoSelection } from '../../components/GeoSmartSearch';
import type { GeoUnit } from '../../lib/types';
import type { ZoneStudyMode, ZoneStudyResponse } from '@golden-crm/shared';

// Local calendar date (NOT UTC) — toISOString() is a day behind before the UTC offset.
const getPlanningDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

function extractError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    // request() wraps the body as `API Error <status>: <json>` — try to surface the `error` field.
    const match = msg.match(/API Error \d+: (.*)$/s);
    if (match) {
        try {
            const parsed = JSON.parse(match[1]);
            if (parsed?.error) return parsed.error;
        } catch {
            /* fall through */
        }
    }
    return msg;
}

export default function ZoneStudy() {
    const navigate = useNavigate();
    const [date, setDate] = useState(getPlanningDate);
    const [mode, setMode] = useState<ZoneStudyMode>('auto');
    const [data, setData] = useState<ZoneStudyResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [pickSelection, setPickSelection] = useState<GeoSelection>(emptyGeoSelection);

    useEffect(() => {
        let cancelled = false;
        api.geoUnits.list().then(units => { if (!cancelled) setGeoUnits(units); }).catch(() => { });
        return () => { cancelled = true; };
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.zoneStudy.get(date, mode);
            setData(res);
        } catch (err) {
            setError(extractError(err));
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [date, mode]);

    useEffect(() => { void load(); }, [load]);

    const handleRefresh = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await api.zoneStudy.refresh(date, mode);
            setData(res);
        } catch (err) {
            setError(extractError(err));
        } finally {
            setBusy(false);
        }
    };

    const handlePick = async () => {
        const zoneId = Number(pickSelection.neighborhoodId);
        if (!Number.isInteger(zoneId) || zoneId <= 0) return;
        setBusy(true);
        setError(null);
        try {
            const res = await api.zoneStudy.pick(date, zoneId);
            setData(res);
            setPickSelection(emptyGeoSelection);
        } catch (err) {
            setError(extractError(err));
        } finally {
            setBusy(false);
        }
    };

    const handleUnpick = async (zoneId: number) => {
        setBusy(true);
        setError(null);
        try {
            const res = await api.zoneStudy.unpick(date, zoneId);
            setData(res);
        } catch (err) {
            setError(extractError(err));
        } finally {
            setBusy(false);
        }
    };

    const isFrozen = data?.isFrozen ?? false;
    const snapshot = data?.snapshot ?? null;
    const zones = snapshot?.zones ?? [];
    // Teams come from the first row (uniform across rows). When there are no rows
    // we still want the header to render, so derive teams defensively.
    const teamColumns = zones[0]?.teams ?? [];
    const canPick = Number(pickSelection.neighborhoodId) > 0 && !busy && !isFrozen;

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto" dir="rtl">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-sky-50 text-sky-600"><LayoutGrid className="w-6 h-6" /></div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">دراسة النطاقات</h1>
                        <p className="text-xs text-slate-500">مرحلة تحليلية بين جدولة الفرق وتوزيع المسارات — اقرأ المهام المؤهلة لزبائن الشركة وسحب الفرق الطبيعي لكل منطقة.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => navigate('/planning/schedule')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                        <ArrowRight className="w-3.5 h-3.5" /> جدولة الفرق
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/planning/assign')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500"
                    >
                        توزيع المسارات <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Controls */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
                <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="font-bold text-slate-700">التاريخ</span>
                        <input
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-sky-400 focus:outline-none"
                        />
                    </label>

                    {/* Mode tabs */}
                    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                        {(['auto', 'manual'] as ZoneStudyMode[]).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${mode === m ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {m === 'auto' ? 'النطاقات المؤهلة' : 'استكشاف نطاقات'}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1" />

                    {isFrozen ? (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 border border-amber-200">
                            <Lock className="w-3.5 h-3.5" /> snapshot مجمَّد ليوم سابق
                        </span>
                    ) : (
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={busy || loading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            تحديث
                        </button>
                    )}
                </div>

                {data?.refreshedAt && (
                    <p className="mt-2 text-[11px] text-slate-400">آخر تحديث: {new Date(data.refreshedAt).toLocaleString('ar')}</p>
                )}
            </div>

            {/* Manual picker */}
            {mode === 'manual' && !isFrozen && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
                    <h3 className="text-slate-900 font-bold text-sm flex items-center gap-2 mb-3"><MapPin className="w-4 h-4 text-orange-500" />أضف منطقة للاستكشاف</h3>
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[260px] flex-1">
                            <GeoSmartSearch
                                label="ابحث عن حي"
                                geoUnits={geoUnits}
                                value={pickSelection}
                                onChange={setPickSelection}
                                minSelectableLevel={4}
                                placeholder="ابحث عن حي لإضافته..."
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handlePick}
                            disabled={!canPick}
                            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Plus className="w-3.5 h-3.5" /> إضافة المنطقة
                        </button>
                    </div>
                </div>
            )}

            {/* Errors */}
            {error && (
                <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
            )}

            {/* No-schedule banner (auto) */}
            {!loading && mode === 'auto' && snapshot && !snapshot.branchSchedulePresent && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    لا فرق محفوظة لهذا التاريخ — يُعرض عمود الشركة فقط.{' '}
                    <button onClick={() => navigate('/planning/schedule')} className="font-bold underline">ارجع لجدولة الفرق</button>
                </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-slate-400">
                        <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                ) : !snapshot ? (
                    <div className="py-16 text-center text-slate-400 text-sm">لا snapshot محفوظ لهذا التاريخ.</div>
                ) : zones.length === 0 ? (
                    <div className="py-16 text-center text-slate-400 text-sm">
                        {mode === 'auto'
                            ? 'لا zones تستدعي الدراسة لهذا التاريخ.'
                            : 'أضف منطقة لاستكشاف توزيع الفرق.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-slate-600 text-xs">
                                    <th className="text-right font-bold px-4 py-3">المنطقة</th>
                                    <th className="text-center font-bold px-4 py-3">
                                        <span className="inline-flex items-center gap-1">مهام الشركة المؤهلة</span>
                                    </th>
                                    {teamColumns.map(t => (
                                        <th key={t.teamKey} className="text-center font-bold px-4 py-3 whitespace-nowrap">
                                            <div className="flex flex-col items-center">
                                                <span>{t.teamLabel}</span>
                                                <span className="text-[10px] font-normal text-slate-400 inline-flex items-center gap-1">
                                                    <Info className="w-3 h-3" /> محتملون / عروض مؤهلة
                                                </span>
                                            </div>
                                        </th>
                                    ))}
                                    {mode === 'manual' && !isFrozen && <th className="px-2 py-3" />}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {zones.map(zone => (
                                    <tr key={zone.zoneId} className="hover:bg-slate-50/60">
                                        <td className="px-4 py-3 font-bold text-slate-800">{zone.zoneName}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex min-w-[2rem] justify-center rounded-md px-2 py-0.5 font-bold ${zone.companyEligibleCount > 0 ? 'bg-sky-50 text-sky-700' : 'text-slate-300'}`}>
                                                {zone.companyEligibleCount}
                                            </span>
                                        </td>
                                        {zone.teams.map(t => (
                                            <td key={t.teamKey} className="px-4 py-3 text-center text-slate-600" title={`محتملون (LEAD بلا عرض): ${t.untappedLeads} • عروض جهاز مؤهلة: ${t.eligibleDeviceDemos}`}>
                                                <span className="font-bold text-slate-700">{t.untappedLeads}</span>
                                                <span className="text-slate-300"> / </span>
                                                <span className="font-bold text-emerald-600">{t.eligibleDeviceDemos}</span>
                                            </td>
                                        ))}
                                        {mode === 'manual' && !isFrozen && (
                                            <td className="px-2 py-3 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnpick(zone.zoneId)}
                                                    disabled={busy}
                                                    className="text-slate-300 hover:text-rose-500 disabled:opacity-40"
                                                    title="حذف المنطقة"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
                <span className="font-bold">قراءة الأرقام:</span> عمود الشركة = مهام مؤهلة (كل الأنواع) لزبائن لا يملكها موظف. عمود كل فريق = <span className="font-bold text-slate-600">المحتملون</span> (زبائن LEAD يملكها الفريق بلا عرض جهاز مفتوح) / <span className="font-bold text-emerald-600">عروض الجهاز المؤهلة</span> (حمل التاريخ المحدد). الصفحة للقراءة فقط؛ القرار يدوي في توزيع المسارات.
            </p>
        </div>
    );
}
