import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Search, AlertCircle, ArrowRight, Trash2, CheckCircle2,
    Loader2, ShieldAlert, Phone, MapPin, Building2, User,
} from 'lucide-react';
import { Candidate, Client, ClientSmartMatchResponse, GeoUnit } from '../../lib/types';
import { api } from '../../lib/api';

type SmartMatchResult = ClientSmartMatchResponse;

interface QualificationModalProps {
    isOpen: boolean;
    onClose: () => void;
    candidate: Candidate | null;
    onQualified: (candidate: Candidate) => void;
    onJunk: (id: number) => void;
    onLink: (candidateId: number, client: Client) => void;
}

// ─── Address resolution helper ───────────────────────────────────────────────
function resolveAddressHierarchy(client: Client, geoUnits: GeoUnit[]): string {
    const nId = parseInt(client.neighborhood);
    if (!nId) return '--';
    const neighborhood = geoUnits.find((g) => g.id === nId);
    if (!neighborhood) return '--';
    const subArea = geoUnits.find((g) => g.id === neighborhood.parentId);
    const gov = subArea ? geoUnits.find((g) => g.id === subArea.parentId) : null;
    const parts = [gov?.name, subArea?.name, neighborhood.name].filter(Boolean);
    return parts.join(' › ');
}

// ─── Confirmation overlay ────────────────────────────────────────────────────
function LinkConfirmOverlay({
    client,
    geoUnits,
    onConfirm,
    onCancel,
}: {
    client: Client;
    geoUnits: GeoUnit[];
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const primaryContact = client.contacts?.find((c) => c.isPrimary) ?? client.contacts?.[0];
    const secondaryContact = client.contacts?.find((c) => !c.isPrimary && c !== primaryContact);
    const address = resolveAddressHierarchy(client, geoUnits);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-slate-900/60 backdrop-blur-sm p-5"
        >
            <motion.div
                initial={{ scale: 0.93, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.93, opacity: 0, y: 16 }}
                transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                        <AlertCircle className="w-5 h-5 text-amber-500" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-800">تأكيد ربط الاسم المقترح</p>
                        <p className="text-xs text-slate-500">مراجعة بيانات الزبون قبل التأكيد</p>
                    </div>
                </div>

                {/* Client details */}
                <div className="px-5 py-4 space-y-3">

                    {/* Name */}
                    <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center shrink-0 mt-0.5">
                            <User className="w-4 h-4 text-sky-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">الاسم</p>
                            <p className="text-sm font-bold text-slate-800">
                                {client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim() || `#${client.id}`}
                                {client.nickname && (
                                    <span className="text-slate-400 font-normal"> ({client.nickname})</span>
                                )}
                            </p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">#{client.id}</p>
                        </div>
                    </div>

                    {/* Phones */}
                    <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 mt-0.5">
                            <Phone className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">الهاتف</p>
                            {primaryContact ? (
                                <p className="text-sm font-bold text-slate-800 font-mono tracking-wide">
                                    {primaryContact.number}
                                    <span className="text-[10px] text-emerald-600 font-sans font-bold mr-1.5">رئيسي</span>
                                </p>
                            ) : (
                                <p className="text-sm font-bold text-slate-800 font-mono">{client.mobile || '--'}</p>
                            )}
                            {secondaryContact && (
                                <p className="text-xs text-slate-500 font-mono mt-0.5">{secondaryContact.number}</p>
                            )}
                        </div>
                    </div>

                    {/* Address */}
                    <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center shrink-0 mt-0.5">
                            <MapPin className="w-4 h-4 text-violet-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">العنوان</p>
                            <p className="text-sm font-medium text-slate-700">
                                {geoUnits.length === 0 ? (
                                    <span className="text-slate-400 text-xs">جاري تحميل العناوين...</span>
                                ) : (
                                    address || '--'
                                )}
                            </p>
                            {client.detailedAddress && (
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{client.detailedAddress}</p>
                            )}
                        </div>
                    </div>

                    {/* Branch */}
                    {client.branchName && (
                        <div className="flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                                <Building2 className="w-4 h-4 text-slate-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">الفرع</p>
                                <p className="text-sm font-bold text-slate-700">{client.branchName}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="px-5 pb-5 flex gap-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors"
                    >
                        تأكيد الربط
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function QualificationModal({
    isOpen, onClose, candidate, onQualified, onJunk, onLink,
}: QualificationModalProps) {
    const [step, setStep] = useState<1 | 2>(1);

    // Auto phone check
    const [autoCheckLoading, setAutoCheckLoading] = useState(false);
    const [autoCheckResult, setAutoCheckResult] = useState<SmartMatchResult | null>(null);
    const [autoCheckError, setAutoCheckError] = useState(false);

    // Manual deep search
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearch, setActiveSearch] = useState('');
    const [clientsList, setClientsList] = useState<Client[]>([]);

    // Geo units for address resolution
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

    // Pending link confirmation
    const [pendingLinkClient, setPendingLinkClient] = useState<Client | null>(null);

    // On open: reset + auto smart-match
    useEffect(() => {
        if (isOpen && candidate) {
            setStep(1);
            setAutoCheckResult(null);
            setAutoCheckError(false);
            setPendingLinkClient(null);
            setSearchQuery(candidate.mobile);
            setActiveSearch('');

            setAutoCheckLoading(true);
            api.clients
                .smartMatch({
                    phone: candidate.mobile,
                    name: [candidate.firstName, candidate.lastName, candidate.nickname].filter(Boolean).join(' ') || undefined,
                })
                .then((result: SmartMatchResult) => {
                    setAutoCheckResult(result);
                    setAutoCheckError(false);
                })
                .catch(() => {
                    setAutoCheckResult(null);
                    setAutoCheckError(true);
                })
                .finally(() => setAutoCheckLoading(false));
        }
    }, [isOpen, candidate]);

    // Load client list + geo units in parallel
    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        Promise.all([api.clients.list(), api.geoUnits.list()]).then(([clients, units]) => {
            if (!active) return;
            setClientsList(clients);
            setGeoUnits(units);
        }).catch(() => {});
        return () => { active = false; };
    }, [isOpen]);

    // Manual deep search results
    const deepSearchResults = useMemo(() => {
        if (!activeSearch || !isOpen) return [];
        const normalizeArabic = (text: string) =>
            text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
        const terms = normalizeArabic(activeSearch).trim().split(/\s+/).filter((t) => t.length > 0);
        return clientsList
            .filter((c) => {
                const s = normalizeArabic(
                    `${c.id} ${c.name} ${c.mobile} ${c.governorate} ${c.neighborhood} ${c.sourceChannel || ''}`,
                );
                return terms.every((term) => s.includes(term));
            })
            .slice(0, 10);
    }, [activeSearch, isOpen, clientsList]);

    const canProceed = autoCheckResult?.status === 'NO_MATCH';

    if (!isOpen || !candidate) return null;

    const handleClose = () => {
        setStep(1);
        setPendingLinkClient(null);
        onClose();
    };

    // Resolve full client then show confirmation overlay
    const requestLink = async (clientId: number) => {
        const fromList = clientsList.find((c) => c.id === clientId);
        if (fromList) {
            setPendingLinkClient(fromList);
        } else {
            try {
                const full = await api.clients.get(clientId);
                setPendingLinkClient(full);
            } catch {
                alert('تعذر تحميل بيانات الزبون — حاول مرة أخرى.');
            }
        }
    };

    const confirmLink = () => {
        if (pendingLinkClient && candidate) {
            onLink(candidate.id, pendingLinkClient);
            setPendingLinkClient(null);
        }
    };

    return (
        <AnimatePresence>
            <div
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
                dir="rtl"
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
                >
                    {/* Confirmation overlay — rendered inside the card */}
                    <AnimatePresence>
                        {pendingLinkClient && (
                            <LinkConfirmOverlay
                                client={pendingLinkClient}
                                geoUnits={geoUnits}
                                onConfirm={confirmLink}
                                onCancel={() => setPendingLinkClient(null)}
                            />
                        )}
                    </AnimatePresence>

                    {/* Header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center">
                                <Search className="w-5 h-5 text-sky-600" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">تأهيل وتحقق</h2>
                                <p className="text-xs text-slate-500">
                                    الاسم المقترح: {candidate.firstName} {candidate.nickname}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleClose}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto max-h-[75vh]">
                        {step === 1 ? (
                            <div className="space-y-5">

                                {/* ── Auto Phone Check ── */}
                                <div>
                                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                                        نتائج التحقق من التكرار
                                    </h3>

                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-xs text-slate-500">الرقم المفحوص:</span>
                                        <span className="font-mono font-bold text-sm text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-lg tracking-wide">
                                            {candidate.mobile}
                                        </span>
                                    </div>

                                    {autoCheckLoading && (
                                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                            <Loader2 className="w-5 h-5 text-sky-500 animate-spin shrink-0" />
                                            <span className="text-sm text-slate-600">جاري التحقق من الرقم...</span>
                                        </div>
                                    )}

                                    {!autoCheckLoading && autoCheckResult?.status === 'NO_MATCH' && (
                                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                                            <span className="text-sm font-bold text-emerald-800">
                                                الرقم جديد كلياً — لا يوجد تطابق في قاعدة البيانات
                                            </span>
                                        </div>
                                    )}

                                    {!autoCheckLoading && autoCheckResult?.status === 'MATCH_VISIBLE' && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
                                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                                <span className="text-xs font-bold text-amber-800">
                                                    تم العثور على تطابق — يرجى مراجعة السجل أدناه
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => requestLink(autoCheckResult.client.id)}
                                                className="w-full text-right py-3 px-4 rounded-xl border border-red-100 bg-red-50/50 hover:bg-red-50 hover:border-red-200 transition-all flex items-center justify-between group"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-xs group-hover:bg-red-200 transition-colors">
                                                        {autoCheckResult.client.id}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-bold text-slate-800">
                                                            {autoCheckResult.client.name}
                                                        </div>
                                                        {autoCheckResult.client.branchName && (
                                                            <div className="text-[10px] text-slate-500">
                                                                {autoCheckResult.client.branchName}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold group-hover:bg-red-200 transition-colors">
                                                    اختيار وتأكيد
                                                </span>
                                            </button>
                                        </div>
                                    )}

                                    {!autoCheckLoading && autoCheckResult?.status === 'MATCH_RESTRICTED' && (
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-100">
                                                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                                <div>
                                                    <p className="text-sm font-bold text-amber-900">
                                                        الرقم موجود — تفاصيل السجل خارج نطاق عرضك
                                                    </p>
                                                    <p className="text-xs text-amber-700 mt-0.5">
                                                        {autoCheckResult.message}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {!autoCheckLoading && autoCheckResult?.status === 'MATCH_RESTRICTED' && false && (
                                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-50 border border-red-100">
                                            <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="text-sm font-bold text-red-800">
                                                    الرقم موجود — السجل خارج نطاق صلاحيتك
                                                </p>
                                                <p className="text-xs text-red-600 mt-0.5">راجع مدير الفرع أو الإدارة</p>
                                            </div>
                                        </div>
                                    )}

                                    {!autoCheckLoading && autoCheckError && (
                                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 border border-red-100">
                                            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                                            <span className="text-sm text-red-700">
                                                تعذر إجراء التحقق — تحقق من الاتصال وأعد المحاولة
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* ── Manual Deep Search ── */}
                                <div>
                                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                                        بحث عميق يدوي
                                    </h3>
                                    <form
                                        onSubmit={(e) => { e.preventDefault(); setActiveSearch(searchQuery); }}
                                        className="flex gap-2"
                                    >
                                        <div className="relative flex-1">
                                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="text"
                                                placeholder="اسم، رقم، كنية، ID..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm"
                                            />
                                        </div>
                                        <button
                                            type="submit"
                                            className="px-5 py-2.5 bg-sky-600 text-white rounded-xl font-bold text-sm hover:bg-sky-500 transition-all flex items-center gap-2 shadow-sm shrink-0"
                                        >
                                            <Search className="w-4 h-4" />
                                            <span>بحث</span>
                                        </button>
                                    </form>

                                    {activeSearch && (
                                        <div className="mt-3 space-y-2">
                                            {deepSearchResults.length === 0 ? (
                                                <p className="text-xs text-slate-400 text-center py-4">لا توجد نتائج مطابقة</p>
                                            ) : (
                                                deepSearchResults.map((d) => {
                                                    const clientType = d.isCandidate
                                                        ? d.candidateStatus || 'محتمل'
                                                        : 'زبون متعاقد';
                                                    return (
                                                        <button
                                                            key={d.id}
                                                            onClick={() => requestLink(d.id)}
                                                            className="w-full text-right py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-sky-50 hover:border-sky-200 transition-all flex items-center justify-between group cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs group-hover:bg-sky-100 group-hover:text-sky-700 transition-colors">
                                                                    {d.id}
                                                                </div>
                                                                <div>
                                                                    <div className="text-sm font-bold text-slate-800">{d.name}</div>
                                                                    <div className="text-[10px] text-slate-500">
                                                                        {d.governorate} · {d.neighborhood}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col items-end gap-0.5">
                                                                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold group-hover:bg-sky-100 group-hover:text-sky-700 transition-colors">
                                                                    اختيار وتأكيد
                                                                </span>
                                                                <span className="text-[10px] text-slate-400">{clientType}</span>
                                                            </div>
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* ── متابعة الإجراء — only after confirmed NO_MATCH ── */}
                                {canProceed && (
                                    <button
                                        onClick={() => setStep(2)}
                                        className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3.5 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20"
                                    >
                                        <span>متابعة الإجراء</span>
                                        <ArrowRight className="w-4 h-4 mr-1 rotate-180" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            /* ── Step 2: Final Action ── */
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <div className="text-center space-y-2 mb-2">
                                    <h3 className="text-lg font-bold text-slate-800">اتخاذ إجراء نهائي</h3>
                                    <p className="text-sm text-slate-500">تم التأكد من صحة البيانات. ماذا تريد أن تفعل؟</p>
                                </div>

                                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-4">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-slate-500 font-bold">بيانات الاسم المقترح</span>
                                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md font-mono font-bold tracking-widest">
                                            {candidate.mobile}
                                        </span>
                                    </div>
                                    <div className="text-base font-black text-slate-800 mb-3">
                                        {candidate.firstName} {candidate.lastName}{' '}
                                        {candidate.nickname ? `(${candidate.nickname})` : ''}
                                    </div>
                                    <div className="flex justify-between items-center pt-3 border-t border-slate-200/60 mb-1">
                                        <span className="text-xs text-slate-500 font-bold">اسم الوسيط</span>
                                        <span className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">
                                            {candidate.referralType}
                                        </span>
                                    </div>
                                    <div className="text-sm font-bold text-slate-800">{candidate.referralNameSnapshot}</div>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    <button
                                        onClick={() => onQualified(candidate)}
                                        className="flex items-center gap-4 p-4 rounded-2xl border-2 border-emerald-100 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-200 transition-all text-right group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-md shadow-emerald-600/20">
                                            <CheckCircle2 className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-emerald-900">تحويل لاسم مرشح جديد</div>
                                            <div className="text-xs text-emerald-700 mt-0.5">فتح استمارة الزبون مع نقل كافة البيانات</div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => onJunk(candidate.id)}
                                        className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-100 transition-all text-right group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 group-hover:bg-red-100 group-hover:text-red-600 transition-all">
                                            <Trash2 className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-slate-800 group-hover:text-red-700">استبعاد</div>
                                            <div className="text-xs text-slate-500 mt-0.5">تصنيف الاسم كغير صالح للأرشفة</div>
                                        </div>
                                    </button>

                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
