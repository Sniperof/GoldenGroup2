import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronRight, Phone, MapPin, Share2,
    History, ArrowLeft,
    Plus, Briefcase, Activity, LayoutDashboard, Contact2, Navigation, Users, MessageCircle, ShieldCheck,
    X, Loader2, PhoneCall, Zap, FileText, CheckCircle2, Wrench, Check, Truck, Calendar, Layers, AlertCircle
} from 'lucide-react';
import { api } from '../lib/api';
import { useCandidateStore } from '../hooks/useCandidateStore';
import type { Client, GeoUnit } from '../lib/types';
import ClientAvatar from '../components/ClientAvatar';
import { getOutcomeMeta, OUTCOMES_BY_GROUP, TelemarketingOutcomeCode, PHONE_STATUS_TO_CONTACT_ENTRY, OUTCOME_MAP } from '@golden-crm/shared';
import OutcomeRecorderModal, { SaveExtras } from '../components/telemarketing/OutcomeRecorderModal';
import CustomerCallLog from '../components/customers/CustomerCallLog';
import PhoneCallLog from '../components/customers/PhoneCallLog';
import DeviceOfferModal from '../components/clients/DeviceOfferModal';
import RequestEmergencyModal from '../components/emergency/RequestEmergencyModal';

const referrerTypesAr: Record<string, string> = {
    'Personal': 'شخصي',
    'Employee': 'موظف',
    'Client': 'زبون/مرشح',
    'Unknown': 'مجهول',
    'Other': 'أخرى',
};

export default function ClientProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'overview' | 'contacts' | 'calllog' | 'visits' | 'network' | 'contracts'>('overview');
    const [callLogRefreshKey, setCallLogRefreshKey] = useState(0);
    const [client, setClient] = useState<Client | null>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [allGeoUnits, setAllGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const { candidates } = useCandidateStore();

    useEffect(() => {
        const clientId = Number(id);
        if (!clientId) {
            setClient(null);
            setLoading(false);
            return;
        }

        let active = true;

        const fetchData = async () => {
            try {
                setLoading(true);
                const [clientData, clientsData, geoUnitsData] = await Promise.all([
                    api.clients.get(clientId),
                    api.clients.list(),
                    api.geoUnits.list(),
                ]);

                if (!active) return;
                setClient(clientData);
                setClients(clientsData);
                setAllGeoUnits(geoUnitsData);
            } catch (error) {
                console.error('Failed to fetch client profile:', error);
                if (!active) return;
                setClient(null);
                setClients([]);
                setAllGeoUnits([]);
            } finally {
                if (active) setLoading(false);
            }
        };

        fetchData();

        return () => {
            active = false;
        };
    }, [id]);

    const getFullLocationStr = (neighborhoodId?: string) => {
        if (!neighborhoodId) return 'غير محدد';
        const nId = parseInt(neighborhoodId);
        const n = allGeoUnits.find(g => g.id === nId);
        if (!n) return 'غير محدد';
        const d = allGeoUnits.find(g => g.id === n.parentId);
        const g = allGeoUnits.find(g => g.id === d?.parentId);
        const parts = [];
        if (g) parts.push(g.name);
        if (d) parts.push(d.name);
        if (n) parts.push(n.name);
        return parts.join(' > ') || 'غير محدد';
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <p className="text-lg font-medium">جاري تحميل بيانات الزبون...</p>
            </div>
        );
    }

    if (!client) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <p className="text-lg font-medium">الزبون غير موجود</p>
                <button onClick={() => navigate('/clients')} className="mt-4 text-sky-600 font-bold flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> العودة للقائمة
                </button>
            </div>
        );
    }

    const formattedName = [client.firstName, client.fatherName, client.lastName, client.nickname ? `(${client.nickname})` : ''].filter(Boolean).join(' ');
    const primaryContact = client.contacts?.find(c => c.isPrimary) || client.contacts?.[0];
    const primaryNumber = primaryContact?.number || '--';

    // Classification mapping
    const classificationObj = {
        'OP': { color: 'bg-emerald-500 text-white', text: 'زبون فعلي (OP)' },
        'FOP': { color: 'bg-orange-500 text-white', text: 'مستهدف (FOP)' },
        'Lead': { color: 'bg-sky-500 text-white', text: 'مرشح (Lead)' }
    };
    const cClass = ((client as any).lifecycleStage as keyof typeof classificationObj) || 'Lead';
    const classification = classificationObj[cClass] || classificationObj['Lead'];

    const referrerTypeStr = referrerTypesAr[client.referrerType || ''] || client.referrerType || 'غير محدد';

    return (
        <div className="h-full flex flex-col bg-slate-50/50" style={{ direction: 'rtl' }}>
            {/* Header / Breadcrumbs - Corrected path text */}
            <div className="px-8 py-4 bg-white border-b border-gray-200 flex items-center justify-between shadow-sm shrink-0">
                <div className="flex items-center gap-2 text-sm max-w-lg">
                    <button onClick={() => navigate('/clients')} className="text-slate-400 hover:text-sky-600 transition-colors font-bold whitespace-nowrap hidden sm:block">سجلات الزبائن</button>
                    <ChevronRight className="w-4 h-4 text-slate-300 hidden sm:block" />
                    <span className="text-slate-900 font-bold ml-4 truncate">{client.name}</span>
                </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">

                {/* --- Left Column: 35% Width ID Card --- */}
                <aside className="w-full lg:w-[35%] xl:w-[420px] bg-white lg:border-l border-b lg:border-b-0 border-gray-200 flex flex-col overflow-y-auto shrink-0 z-10 shadow-[2px_0_10px_rgba(0,0,0,0.02)] custom-scroll">
                    <div className="p-8 flex-1 space-y-8">
                        {/* Avatar & Name */}
                        <div className="flex flex-col items-center text-center">
                            <div className="relative mb-4">
                                <ClientAvatar
                                    gender={client.gender}
                                    dataQuality={client.dataQuality}
                                    size="lg"
                                    className="border-4 border-white shadow-xl"
                                />
                                <div className={`absolute -bottom-1 -right-4 px-3 py-1 rounded-full text-[10px] font-black shadow-md border-2 border-white ${classification.color} whitespace-nowrap`}>
                                    {classification.text}
                                </div>
                            </div>
                            <h2 className="text-2xl font-black text-slate-800 mb-1">{formattedName}</h2>
                        </div>

                        {/* Info List */}
                        <div className="space-y-4">
                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-center gap-4 hover:border-sky-200 hover:shadow-md transition-all">
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0">
                                    <Phone className="w-5 h-5 text-sky-500" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-[10px] text-slate-400 font-bold mb-0.5">رقم التواصل المعتمد</p>
                                    <p className="text-base font-bold text-slate-800 font-mono tracking-wide" dir="ltr">{primaryNumber}</p>
                                </div>
                            </div>

                            <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 hover:shadow-lg transition-all space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm shrink-0 border border-slate-100">
                                        <MapPin className="w-5 h-5 text-sky-500" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider mb-0.5">العنوان الجغرافي</p>
                                        <h4 className="text-sm font-bold text-slate-800">تفاصيل الموقع</h4>
                                    </div>
                                </div>

                                {/* Structured Address Hierarchy */}
                                <div className="grid grid-cols-2 gap-2">
                                    {(() => {
                                        const nId = parseInt(client.neighborhood);
                                        const n = allGeoUnits.find(g => g.id === nId);
                                        const d = allGeoUnits.find(g => g.id === n?.parentId);
                                        const go = allGeoUnits.find(g => g.id === d?.parentId);
                                        return [
                                            { label: 'المحافظة', value: go?.name },
                                            { label: 'المنطقة', value: d?.name },
                                            { label: 'الحي/المحلة', value: n?.name },
                                            { label: 'تفاصيل العنوان', value: client.detailedAddress || 'غير محدد' }
                                        ].map((item, idx) => (
                                            <div key={idx} className="bg-white/60 p-2.5 rounded-2xl border border-slate-100/50">
                                                <p className="text-[9px] text-slate-400 font-bold mb-1">{item.label}</p>
                                                <p className="text-xs font-black text-slate-700 truncate">{item.value || '--'}</p>
                                            </div>
                                        ));
                                    })()}
                                </div>

                                {/* Map Preview */}
                                {client.gpsCoordinates && (
                                    <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-inner h-32 relative group/map">
                                        <iframe
                                            src={`https://www.openstreetmap.org/export/embed.html?bbox=${(client.gpsCoordinates as any).lng - 0.005},${(client.gpsCoordinates as any).lat - 0.002},${(client.gpsCoordinates as any).lng + 0.005},${(client.gpsCoordinates as any).lat + 0.002}&layer=mapnik&marker=${(client.gpsCoordinates as any).lat},${(client.gpsCoordinates as any).lng}`}
                                            className="w-full h-full grayscale-[0.5] contrast-[1.1] group-hover/map:grayscale-0 transition-all duration-700"
                                            style={{ border: 0 }}
                                            title="خريطة الموقع"
                                        />
                                        <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5 rounded-2xl" />
                                    </div>
                                )}
                                {!client.gpsCoordinates && (
                                    <div className="bg-gray-100/50 rounded-2xl border border-dashed border-gray-200 h-24 flex flex-col items-center justify-center text-slate-400">
                                        <Navigation className="w-5 h-5 mb-1 opacity-40" />
                                        <p className="text-[10px] font-bold">لا توجد إحداثيات GPS</p>
                                    </div>
                                )}
                            </div>

                            <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-4 hover:border-emerald-200 hover:shadow-md transition-all">
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0">
                                    <Briefcase className="w-5 h-5 text-emerald-500" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-[10px] text-slate-400 font-bold mb-0.5">المصدر والوسيط</p>
                                    <p className="text-sm font-bold text-slate-800">المصدر: {client.referrerName || 'غير معد'} / {referrerTypeStr}</p>
                                </div>
                            </div>

                            {client.occupation && (
                                <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-4 flex items-center gap-4 hover:border-amber-200 hover:shadow-md transition-all">
                                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0">
                                        <Briefcase className="w-5 h-5 text-amber-500" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-[10px] text-slate-400 font-bold mb-0.5">المهنة</p>
                                        <p className="text-sm font-bold text-slate-800">{client.occupation}</p>
                                    </div>
                                </div>
                            )}

                            <div className={`rounded-2xl p-4 flex items-center gap-4 transition-all border ${client.rating === 'Committed'
                                ? 'bg-emerald-50/50 border-emerald-100'
                                : client.rating === 'NotCommitted'
                                    ? 'bg-rose-50/50 border-rose-100'
                                    : 'bg-slate-50/50 border-slate-100'
                                }`}>
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0">
                                    <ShieldCheck className={`w-5 h-5 ${client.rating === 'Committed'
                                        ? 'text-emerald-500'
                                        : client.rating === 'NotCommitted'
                                            ? 'text-rose-500'
                                            : 'text-slate-400'
                                        }`} />
                                </div>
                                <div className="flex-1">
                                    <p className="text-[10px] text-slate-400 font-bold mb-0.5">مدى الالتزام</p>
                                    <p className={`text-sm font-bold ${client.rating === 'Committed'
                                        ? 'text-emerald-700'
                                        : client.rating === 'NotCommitted'
                                            ? 'text-rose-700'
                                            : 'text-slate-500'
                                        }`}>
                                        {client.rating === 'Committed' ? 'زبون ملتزم' : client.rating === 'NotCommitted' ? 'زبون غير ملتزم' : 'غير محدد'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* --- Right Column: 65% Main Content Workspace --- */}
                <main className="flex-1 flex flex-col min-w-0 bg-slate-50/50">
                    <div className="px-8 pt-6 pb-6 lg:pt-8 bg-white border-b border-gray-100 shrink-0">
                        {/* Header Action Buttons */}
                        <div className="flex flex-wrap items-center gap-3 mb-6">
                            <button className="px-5 py-2.5 bg-sky-600 text-white border-transparent rounded-xl text-sm font-bold shadow-[0_4px_12px_rgba(14,165,233,0.3)] hover:bg-sky-500 transition-all hover:-translate-y-0.5 flex items-center gap-2">
                                <Plus className="w-4 h-4" /> عقد جديد
                            </button>
                            <button className="px-5 py-2.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm font-bold shadow-sm hover:bg-indigo-100 transition-all flex items-center gap-2">
                                <Plus className="w-4 h-4" /> زيارة تسويق
                            </button>
                            <button className="px-5 py-2.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm font-bold shadow-sm hover:bg-amber-100 transition-all flex items-center gap-2">
                                <Plus className="w-4 h-4" /> زيارة صيانة
                            </button>
                        </div>

                        {/* Tab Navigation */}
                        <div className="flex items-center gap-1.5 p-1.5 bg-gray-50 border border-gray-200 rounded-2xl w-full xl:w-fit overflow-x-auto shadow-sm no-scrollbar">
                            {[
                                { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
                                { id: 'contacts', label: 'التواصل', icon: Contact2 },
                                { id: 'calllog', label: 'سجل الاتصال', icon: PhoneCall },
                                { id: 'visits', label: 'الزيارات', icon: Navigation },
                                { id: 'contracts', label: 'العقود', icon: ShieldCheck },
                                { id: 'network', label: 'الشبكة', icon: Share2 },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap flex-1 xl:flex-none ${activeTab === tab.id
                                        ? 'text-sky-700 bg-white shadow-sm border border-gray-100'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                                        }`}
                                >
                                    <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-sky-500' : 'text-slate-400'}`} />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 lg:py-8 custom-scroll">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="h-full"
                            >
                                {activeTab === 'overview' && <OverviewTab client={client} />}
                                {activeTab === 'contacts' && (
                                    <ContactsTab
                                        client={client}
                                        refreshKey={callLogRefreshKey}
                                        onCallSaved={() => setCallLogRefreshKey(k => k + 1)}
                                        onClientUpdate={(fields) => setClient(prev => prev ? { ...prev, ...fields } : null)}
                                    />
                                )}
                                {activeTab === 'calllog' && (
                                    <div className="space-y-4 max-w-5xl">
                                        <h3 className="text-lg font-black text-slate-800">سجل الاتصال الكامل</h3>
                                        <CustomerCallLog customerId={client.id} refreshKey={callLogRefreshKey} />
                                    </div>
                                )}
                                {activeTab === 'visits' && <VisitsTab client={client} />}
                                {activeTab === 'contracts' && <ContractsTab client={client} getFullLocationStr={getFullLocationStr} />}
                                {activeTab === 'network' && <NetworkTab client={client} clients={clients} candidates={candidates} />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </main>
            </div>
        </div>
    );
}

{/* ============ TABS COMPONENTS ============ */ }

function OverviewTab({ client }: { client: Client }) {
    const activities = [
        { type: 'call', date: 'منذ ساعتين', title: 'مكالمة متابعة سريعة', desc: 'تأكيد رضا الزبون بعد الصيانة الأخيرة.', status: 'completed' },
        { type: 'visit', date: 'أمس، 10:00 ص', title: 'زيارة صيانة دورية ', desc: 'تم تبديل الفلاتر الأساسية.', status: 'completed' },
        { type: 'referral', date: '15 فبراير', title: 'ترشيح زبون جديد', desc: 'قام بترشيح "محمد الجاسم" .', status: 'new' },
        { type: 'contract', date: '10 يناير', title: 'إضافة عقد جديد', desc: 'توقيع عقد شراء جهاز RO 7 مراحل.', status: 'completed' },
        { type: 'visit', date: '5 يناير', title: 'زيارة تسويق ', desc: 'تم تقييم موقع التركيب وشرح العروض.', status: 'completed' },
    ];

    return (
        <div className="w-full h-full max-w-3xl space-y-10">
            {client.notes && (
                <section>
                    <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                        <Plus className="w-5 h-5 text-sky-500" />
                        ملاحظات الزبون
                    </h3>
                    <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm prose prose-sm max-w-none prose-slate">
                        <div
                            className="rich-notes text-slate-600 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: client.notes }}
                        />
                        <style>{`
                            .rich-notes ul { list-style-type: disc; padding-inline-start: 1.5rem; margin: 1rem 0; }
                            .rich-notes ol { list-style-type: decimal; padding-inline-start: 1.5rem; margin: 1rem 0; }
                            .rich-notes p { margin: 0.5rem 0; }
                            .rich-notes h1, .rich-notes h2, .rich-notes h3 { margin-top: 1.5rem; margin-bottom: 0.5rem; font-weight: bold; }
                        `}</style>
                    </div>
                </section>
            )}

            <section>
                <h3 className="text-lg font-black text-slate-800 mb-6">النشاطات الأخيرة للزبون (Timeline)</h3>
                <div className="space-y-0 relative before:absolute before:right-6 before:top-2 before:bottom-0 before:w-px before:bg-slate-200">
                    {activities.map((act, i) => (
                        <div key={i} className="relative pr-14 pb-8 group last:pb-0">
                            <div className="absolute right-[19px] top-1.5 w-3 h-3 rounded-full border-2 border-slate-50 bg-sky-400 shadow-[0_0_0_4px_white] z-10 group-hover:bg-sky-500 group-hover:scale-110 transition-all" />
                            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm group-hover:border-sky-200 group-hover:shadow-md transition-all">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-black text-sky-600 uppercase tracking-wide bg-sky-50 px-2 py-0.5 rounded-md">{act.type}</span>
                                    <span className="text-xs text-slate-400 font-mono tracking-tighter">{act.date}</span>
                                </div>
                                <h4 className="font-bold text-slate-800 mb-1">{act.title}</h4>
                                <p className="text-sm text-slate-500 leading-relaxed max-w-lg">{act.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

// ── outcome colour helper ─────────────────────────────────────────────────────

function outcomeColor(outcome: string): string {
    const group = getOutcomeMeta(outcome).group;
    switch (group) {
        case 'booked':        return 'border-emerald-500';
        case 'follow_up':     return 'border-amber-400';
        case 'service_request': return 'border-violet-400';
        case 'not_reached':   return 'border-slate-300';
        default:              return 'border-sky-400';
    }
}

function outcomeBadgeClass(outcome: string): string {
    const group = getOutcomeMeta(outcome).group;
    switch (group) {
        case 'booked':        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
        case 'follow_up':     return 'bg-amber-50 text-amber-700 border-amber-100';
        case 'service_request': return 'bg-violet-50 text-violet-700 border-violet-100';
        case 'not_reached':   return 'bg-slate-100 text-slate-500 border-slate-200';
        default:              return 'bg-sky-50 text-sky-700 border-sky-100';
    }
}

function formatCallDate(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        return d.toLocaleString('ar-SY', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

// ── ContactsTab ───────────────────────────────────────────────────────────────

function ContactsTab({ client, refreshKey, onCallSaved, onClientUpdate }: { client: Client; refreshKey?: number; onCallSaved?: () => void; onClientUpdate?: (fields: Partial<Client>) => void }) {
    const [callLogs, setCallLogs] = useState<any[]>([]);
    const [loadingCalls, setLoadingCalls] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalContact, setModalContact] = useState<{ id?: string; number?: string; label?: string } | null>(null);

    const fetchCalls = useCallback(async () => {
        setLoadingCalls(true);
        try {
            const logs = await api.customerCalls.list(client.id);
            setCallLogs(logs);
        } catch {
            setCallLogs([]);
        } finally {
            setLoadingCalls(false);
        }
    }, [client.id]);

    useEffect(() => { fetchCalls(); }, [fetchCalls]);

    return (
        <div className="space-y-6 max-w-5xl">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-800">جهات الاتصال الخاصة بالزبون</h3>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {(client.contacts || []).map((c, i) => {
                    // Logs for this specific contact number
                    const contactLogs = callLogs.filter(
                        (log) => log.contactNumber === c.number || log.contactId === c.id,
                    );
                    const recentLogs = contactLogs.slice(0, 3);

                    return (
                        <div key={c.id || i} className="bg-white rounded-[2rem] border border-gray-200 shadow-sm overflow-hidden flex flex-col xl:flex-row shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 group">

                            {/* === Left Side: Number Info === */}
                            <div className="p-8 bg-gradient-to-br from-slate-50 to-white border-b xl:border-b-0 xl:border-l border-gray-100 xl:w-[400px] flex flex-col justify-between relative overflow-hidden">
                                <div className="absolute -top-10 -right-10 w-40 h-40 bg-sky-400/10 rounded-full blur-3xl pointer-events-none group-hover:bg-sky-400/20 transition-all duration-500" />

                                <div className="relative">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border ${c.isPrimary ? 'bg-sky-500 border-sky-600 text-white' : 'bg-white border-gray-200 text-slate-400'}`}>
                                            <Phone className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 flex items-center justify-between">
                                            <span className="text-sm font-bold text-slate-700">{c.label || 'جهة اتصال'}</span>
                                            {c.isPrimary && (
                                                <span className="px-2.5 py-1 bg-sky-50 text-sky-600 rounded-lg text-[10px] font-black tracking-wide border border-sky-100">أساسي</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mb-6">
                                        <p className="text-3xl font-black text-slate-800 font-mono tracking-widest drop-shadow-sm" dir="ltr">
                                            {c.number}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        <span className="flex items-center gap-1.5 text-[11px] bg-white border border-gray-200 text-slate-600 px-3 py-1.5 rounded-xl font-bold shadow-sm">
                                            {c.type === 'mobile' ? 'موبايل' : 'هاتف أرضي'}
                                        </span>
                                        {c.hasWhatsApp && (
                                            <span className="flex items-center gap-1.5 text-[11px] bg-[#25D366]/10 border border-[#25D366]/20 text-[#128C7E] px-3 py-1.5 rounded-xl font-bold shadow-sm">
                                                <MessageCircle className="w-3.5 h-3.5" /> واتساب متوفر
                                            </span>
                                        )}
                                    <span className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl font-bold shadow-sm border ${
                                        c.status === 'active' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' :
                                        c.status === 'preferred' ? 'bg-sky-50 border-sky-100 text-sky-600' :
                                        c.status === 'out-of-coverage' ? 'bg-orange-50 border-orange-100 text-orange-600' :
                                        c.status === 'invalid' ? 'bg-red-50 border-red-100 text-red-600' :
                                        'bg-slate-50 border-slate-100 text-slate-600'
                                    }`}>
                                        <Activity className="w-3.5 h-3.5" />
                                        {c.status === 'active' ? 'يعمل' :
                                         c.status === 'preferred' ? 'مفضل' :
                                         c.status === 'out-of-coverage' ? 'خارج تغطية' :
                                         c.status === 'unused' ? 'غير مستخدم' :
                                         c.status === 'invalid' ? 'قيمة خاطئة' :
                                         c.status || 'غير محدد'}
                                    </span>
                                    </div>
                                </div>
                            </div>

                            {/* === Right Side: Call Logs === */}
                            <div className="flex-1 p-8 relative bg-white">
                                <div className="flex items-center justify-between mb-6">
                                    <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                        <History className="w-4 h-4 text-sky-500" /> سجل مكالمات هذا الرقم
                                    </h4>
                                    {loadingCalls ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                    ) : (
                                        <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                                            {contactLogs.length > 0
                                                ? `${contactLogs.length} مكالمة`
                                                : 'لا توجد مكالمات'}
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-4">
                                    <PhoneCallLog
                                        customerId={client.id}
                                        contactId={c.id}
                                        contactLabel={c.label || 'جهة اتصال'}
                                        contactNumber={c.number}
                                        refreshKey={refreshKey}
                                        limit={2}
                                        onLogUpdated={onCallSaved}
                                    />
                                </div>

                                <button
                                    onClick={() => {
                                        setModalContact({ id: c.id, number: c.number, label: c.label || 'جهة اتصال' });
                                        setModalOpen(true);
                                    }}
                                    className="mt-6 px-4 py-3 border border-slate-200 text-slate-600 hover:text-sky-600 bg-slate-50 hover:bg-sky-50 font-bold rounded-xl text-sm w-full transition-all flex justify-center items-center gap-2 shadow-sm"
                                >
                                    <Plus className="w-4 h-4" /> تسجيل نتيجة اتصال
                                </button>
                            </div>

                        </div>
                    );
                })}
            </div>

            {/* Outcome Recorder Modal */}
            {modalOpen && modalContact && (
                <OutcomeRecorderModal
                    isOpen={modalOpen}
                    onClose={() => { setModalOpen(false); setModalContact(null); }}
                    entityDetails={client}
                    preselectedContactId={modalContact.id}
                    title="تسجيل مكالمة جديدة"
                    onSave={async (contactId, outcome, notes, extras) => {
                        try {
                            await api.customerCalls.create(client.id, {
                                contactId: contactId || modalContact.id || null,
                                contactNumber: modalContact.number || null,
                                contactLabel: modalContact.label || null,
                                outcome,
                                notes: notes || null,
                                sourceType: 'direct_call',
                                answeredBy: extras?.answeredBy ?? null,
                                communicationChannel: extras?.communicationChannel ?? null,
                                status: extras?.status ?? 'completed',
                                callDate: extras?.callDateTime ?? null,
                            });

                            // Auto-apply phone status update based on outcome
                            const meta = OUTCOME_MAP[outcome];
                            const phoneStatusUpdate = meta?.phoneStatusUpdate;
                            if (phoneStatusUpdate && phoneStatusUpdate !== 'none' && modalContact?.id) {
                                const contactStatus = PHONE_STATUS_TO_CONTACT_ENTRY[phoneStatusUpdate];
                                if (contactStatus) {
                                    const updatedContacts = (client.contacts || []).map((c: any) =>
                                        c.id === modalContact.id ? { ...c, status: contactStatus } : c
                                    );
                                    // Optimistic update
                                    onClientUpdate?.({ contacts: updatedContacts });
                                    // Sync with backend
                                    api.clients.update(client.id, { contacts: updatedContacts }).catch(console.error);
                                }
                            }

                            fetchCalls();
                            onCallSaved?.();
                            setModalOpen(false);
                            setModalContact(null);
                        } catch (err: any) {
                            console.error('Failed to save call:', err);
                        }
                    }}
                />
            )}
        </div>
    );
}

function VisitsTab({ client }: { client: Client }) {
    const navigate = useNavigate();
    const [visits, setVisits] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [contracts, setContracts] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
    const hasIncompleteTask = tasks.some((task) => task.status !== 'completed' && task.status !== 'cancelled');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const taskData = await api.openTasks.listByClient(client.id);
            setTasks(taskData);
        } catch (err) {
            console.error('Failed to fetch tasks:', err);
            setTasks([]);
        }
        try {
            const visitData = await api.fieldVisits.list({ clientId: client.id });
            setVisits(visitData);
        } catch (err) {
            console.error('Failed to fetch visits:', err);
            setVisits([]);
        }
        try {
            const contractData = await api.contracts.list();
            setContracts((contractData as any[]).filter((c: any) => c.customerId === client.id && c.status !== 'cancelled'));
        } catch (err) {
            console.error('Failed to fetch contracts:', err);
            setContracts([]);
        }
        setLoading(false);
    }, [client.id]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return (
        <div className="space-y-6 max-w-5xl h-full flex flex-col">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black text-slate-800">سجل الزيارات والمهام</h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setEmergencyModalOpen(true)}
                        className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl shadow-sm hover:bg-rose-500 transition-all flex items-center gap-1.5 text-sm"
                    >
                        <Zap className="w-4 h-4" /> صيانة طارئة
                    </button>
                    <button
                        onClick={() => setModalOpen(true)}
                        disabled={hasIncompleteTask}
                        className="px-4 py-2 bg-sky-600 text-white font-bold rounded-xl shadow-sm hover:bg-sky-500 transition-all flex items-center gap-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                        <Plus className="w-4 h-4" /> عرض جهاز
                    </button>
                </div>
            </div>
            {hasIncompleteTask && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                    لا يمكن إنشاء عرض جديد ما دامت هناك مهمة غير مكتملة لهذا الزبون.
                </div>
            )}

            {loading ? (
                <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-300" />
                </div>
            ) : (
                <div className="space-y-6">
                    {tasks.length === 0 ? (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-12 text-center flex-1 flex flex-col items-center justify-center">
                            <Navigation className="w-10 h-10 text-slate-300 mb-4" />
                            <h4 className="text-lg text-slate-600 font-black mb-2">لا توجد مهام مسجلة</h4>
                            <p className="text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">اضغط "إضافة عرض جهاز" لإنشاء مهمة جديدة.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {tasks.map((task) => {
                                const preOffers = task.preOffers ?? task.preoffers ?? [];
                                return (
                                    <div key={task.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                                    task.status === 'open' ? 'bg-sky-50 text-sky-600 border-sky-100' :
                                                    task.status === 'scheduled' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                    task.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                    'bg-slate-50 text-slate-500 border-slate-100'
                                                }`}>{task.status}</span>
                                                <span className="text-sm font-bold text-slate-700">مهمة #{task.id}</span>
                                            </div>
                                            {(task.dueDate || task.due_date) && (
                                                <span className="text-xs text-slate-400 font-mono">{task.dueDate || task.due_date}</span>
                                            )}
                                        </div>
                                        {task.devices && task.devices.length > 0 && (
                                            <div className="text-sm text-slate-600 mb-2">
                                                الأجهزة: {task.devices.map((d: any) => `${d.deviceName} × ${d.quantity}`).join('، ')}
                                            </div>
                                        )}
                                        {preOffers.length > 0 && (
                                            <div className="text-sm text-slate-600">
                                                عروض مسبقة: {preOffers.length}
                                            </div>
                                        )}
                                        {task.notes && (
                                            <div className="text-xs text-slate-400 mt-2">{task.notes}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <section className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-base font-black text-slate-800">الزيارات الفعلية</h4>
                            <span className="text-xs text-slate-400">{visits.length} زيارة</span>
                        </div>
                        {visits.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center text-sm text-slate-400">
                                لا توجد زيارات مسجلة لهذا الزبون حتى الآن.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {visits.map((visit) => (
                                    <div key={visit.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-bold text-slate-800">زيارة #{visit.id}</div>
                                                <div className="text-xs text-slate-500 mt-1">{visit.scheduledDate} {visit.scheduledTime ? `• ${visit.scheduledTime}` : ''}</div>
                                            </div>
                                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-slate-50 text-slate-600 border-slate-200">
                                                {visit.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            )}

            {emergencyModalOpen && (
                <RequestEmergencyModal
                    clientId={client.id}
                    clientName={client.name}
                    clientRating={(client as any).rating}
                    contracts={contracts.map((c: any) => ({
                        id: c.id,
                        contractNumber: c.contractNumber,
                        deviceModelName: c.deviceModelName,
                        installationAddressText: c.installationAddressText || null,
                        status: c.status,
                    }))}
                    onClose={() => setEmergencyModalOpen(false)}
                    onCreated={(ticketId) => {
                        setEmergencyModalOpen(false);
                        fetchData();
                        navigate(`/tasks/emergency/${ticketId}`);
                    }}
                />
            )}

            {modalOpen && (
                <DeviceOfferModal
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    client={client}
                    onCreated={() => {
                        setModalOpen(false);
                        fetchData();
                    }}
                />
            )}
        </div>
    );
}

function NetworkTab({ client, clients, candidates }: any) {
    const originTouchpoints = [
        { id: 1, date: client.createdAt, title: ' اقتراح مبدئي', channel: client.sourceChannel || 'App', type: client.referrerType || 'شخصي', ref: client.referrerName || 'مباشر' },
    ];

    const referralsMade = clients.filter((c: any) => c.referralEntityId === client.id && c.referrerType === 'Client');
    const referralsCand = candidates.filter((c: any) => c.referralEntityId === client.id && c.referralType === 'Client');
    const allReferralsMade = [...referralsMade, ...referralsCand];

    return (
        <div className="space-y-10 max-w-5xl">
            {/* Section A: All Origins */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                        <Share2 className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-800">وسطاء الزبون</h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد مرات ترشيح الزبون</p>
                    </div>
                </div>
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 overflow-hidden">
                    <div className="space-y-4">
                        {originTouchpoints.map(tp => (
                            <div key={tp.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100 gap-4 hover:border-indigo-200 transition-colors">
                                <div>
                                    <h5 className="font-bold text-slate-800 mb-1">{tp.title}</h5>
                                    <p className="text-sm text-slate-500 font-medium">بواسطة <span className="font-bold">{tp.ref}</span> ({referrerTypesAr[tp.type] || tp.type})</p>
                                </div>
                                <span className="font-mono text-sm font-bold text-slate-400 bg-white px-3 py-1.5 rounded-lg border border-slate-100 self-start sm:self-auto">{tp.date?.split('T')[0] || '--'}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Section B: Referrals Made */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                        <Users className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-800">الترشيحات الصادرة</h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">الأشخاص الذين قام الزبون بتزكيتهم</p>
                    </div>
                </div>

                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-right">
                        <thead className="bg-slate-50 border-b border-gray-100">
                            <tr>
                                <th className="px-8 py-5 text-xs font-black text-slate-500 uppercase">اسم المرشح</th>
                                <th className="px-8 py-5 text-xs font-black text-slate-500 uppercase">الرقم</th>
                                <th className="px-8 py-5 text-xs font-black text-slate-500 uppercase">الحالة</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {allReferralsMade.map((ref: any, idx: number) => (
                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="px-8 py-6">
                                        <div className="font-bold text-slate-800 text-sm">{ref.name || `${ref.firstName || ''} ${ref.lastName || ''}`}</div>
                                    </td>
                                    <td className="px-8 py-6">
                                        <div className="font-mono text-sm font-bold text-slate-500" dir="ltr">
                                            {ref.contacts?.find((con: any) => con.isPrimary)?.number || ref.contacts?.[0]?.number || ref.mobile || '--'}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6">
                                        <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${ref.isCandidate ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100'}`}>
                                            {ref.isCandidate ? 'قيد المتابعة' : 'زبون فعال'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {allReferralsMade.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="px-8 py-16 text-center">
                                        <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                                        <p className="text-slate-400 font-bold">لم يقم هذا الزبون بترشيح أي أشخاص حتى الآن.</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function PartCard({ item, contract, installed }: { item: any; contract: any; installed: boolean }) {
    const label = item.description || item.name || 'قطعة ملحقة';
    const code = item.code || item.sparePartCode;
    const qty = item.quantity || 1;
    const price = item.unitPrice != null ? Number(item.unitPrice) : null;
    const totalPrice = price != null ? price * qty : null;

    return (
        <div className={`flex items-start p-4 rounded-2xl border transition-colors ${
            installed ? 'bg-slate-50 border-slate-100' : 'bg-amber-50 border-amber-200'
        }`}>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-bold ${installed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {label}
                    </span>
                    {code && (
                        <span className="text-[10px] text-slate-400 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            {code}
                        </span>
                    )}
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        installed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-100 text-amber-700'
                    }`}>
                        {installed ? '✓ مركّب' : '⏳ بانتظار التركيب'}
                    </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-500">الكمية: {qty}</span>
                    {totalPrice != null && (
                        <span className="text-[11px] text-slate-500">
                            السعر: {totalPrice.toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س
                            {qty > 1 && price != null && (
                                <span className="text-slate-400"> ({price.toLocaleString('ar-SY', { numberingSystem: 'latn' })} × {qty})</span>
                            )}
                        </span>
                    )}
                    <span className="text-[11px] text-slate-400">
                        تاريخ الشراء: {contract?.contractDate ? new Date(contract.contractDate).toLocaleDateString('ar-SY') : '—'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                        المصدر: عقد #{contract?.contractNumber || contract?.id}
                    </span>
                    {item.oldPartRemoved === true && (
                        <span className="text-[11px] text-emerald-600 font-medium">✓ تم تبديل القطعة القديمة</span>
                    )}
                </div>
            </div>
        </div>
    );
}

interface ContractsTabProps {
    client: Client;
    getFullLocationStr: (neighborhoodId?: string) => string;
}

function ContractsTab({ client, getFullLocationStr }: ContractsTabProps) {
    const [contracts, setContracts] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedContract, setSelectedContract] = useState<any | null>(null);
    const [selectedContractDetails, setSelectedContractDetails] = useState<any | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [lineItemUpdatingId, setLineItemUpdatingId] = useState<number | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);

        try {
            const contractData = await api.contracts.list({ customerId: client.id });
            const filteredContracts = contractData.filter((c: any) => c.customerId === client.id && c.status !== 'cancelled');
            setContracts(filteredContracts);
        } catch (err) {
            console.error('Failed to fetch contracts:', err);
            setContracts([]);
        }

        try {
            const taskData = await api.openTasks.listByClient(client.id);
            setTasks(taskData);
        } catch (err) {
            console.error('Failed to fetch tasks:', err);
            setTasks([]);
        }

        setLoading(false);
    }, [client.id]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const fetchContractDetails = async (contractId: number) => {
        setDetailsLoading(true);
        try {
            const details = await api.contracts.get(contractId);
            setSelectedContractDetails(details);
        } catch (err) {
            console.error('Failed to fetch contract details', err);
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleSelectContract = (contract: any) => {
        setSelectedContract(contract);
        fetchContractDetails(contract.id);
    };

    const handleCreateTask = async (taskType: 'device_installation' | 'device_activation') => {
        if (!selectedContract) return;
        setActionLoading(true);
        try {
            const taskFamily = 'delivery';
            const reason = 'service_request';
            const dueDate = new Date().toISOString().split('T')[0];
            await api.openTasks.create({
                clientId: client.id,
                branchId: selectedContract.branchId,
                taskType,
                taskFamily,
                reason,
                contractId: selectedContract.id,
                dueDate
            });
            // Refresh main lists
            await fetchData();
            // Refresh current details to update status and task lists
            await fetchContractDetails(selectedContract.id);
        } catch (err) {
            console.error('Failed to create task:', err);
            alert('حدث خطأ أثناء إنشاء المهمة.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleToggleInstallation = async (itemId: number, currentInstalled: boolean) => {
        if (!selectedContract) return;
        setLineItemUpdatingId(itemId);
        try {
            await api.contracts.toggleLineItemInstallation(selectedContract.id, itemId, !currentInstalled);
            // Refresh details to update state
            await fetchContractDetails(selectedContract.id);
        } catch (err) {
            console.error('Failed to toggle installation status:', err);
            alert('حدث خطأ أثناء تحديث حالة تركيب القطعة.');
        } finally {
            setLineItemUpdatingId(null);
        }
    };

    const lineItemsAll = (selectedContractDetails?.lineItems ?? []).filter((item: any) => item.itemType !== 'device');
    const installedItems = lineItemsAll.filter((item: any) => !!item.isInstalled);
    const pendingItems = lineItemsAll.filter((item: any) => !item.isInstalled);
    const installedCount = installedItems.length;
    const pendingCount = pendingItems.length;
    const totalCount = lineItemsAll.length;

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-4" />
                <p className="text-sm font-bold">جاري تحميل العقود...</p>
            </div>
        );
    }

    const steps = [
        { key: 'pending_delivery', label: 'قيد التسليم', desc: 'توليد مهمة تسليم الجهاز' },
        { key: 'delivered', label: 'تم التسليم', desc: 'جدولة مهمة تركيب الجهاز' },
        { key: 'installed', label: 'تم التركيب', desc: 'جدولة مهمة تشغيل وفحص الجهاز' },
        { key: 'active', label: 'نشط', desc: 'تفعيل العقد والجهاز بالكامل' }
    ];

    const currentStatus = selectedContractDetails?.deviceStatus || selectedContract?.deviceStatus || 'pending_delivery';
    let activeStepIndex = 0;
    if (currentStatus === 'delivered') activeStepIndex = 1;
    else if (currentStatus === 'installed') activeStepIndex = 2;
    else if (currentStatus === 'active') activeStepIndex = 3;

    return (
        <div className="space-y-6 max-w-5xl">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-800">عقود شراء الأجهزة وتتبعها</h3>
            </div>

            {contracts.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-100 p-16 text-center flex flex-col items-center justify-center shadow-sm">
                    <FileText className="w-12 h-12 text-slate-300 mb-4" />
                    <h4 className="text-base text-slate-600 font-black mb-2">لا توجد عقود شراء مسجلة</h4>
                    <p className="text-xs text-slate-400 font-bold max-w-md">لم يقم هذا الزبون بشراء أي جهاز أو إبرام عقد بيع بعد.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {contracts.map((c: any) => {
                        let statusLabel = 'قيد التسليم';
                        let statusColor = 'text-amber-600 bg-amber-50 border-amber-100';
                        if (c.deviceStatus === 'delivered') {
                            statusLabel = 'تم التسليم';
                            statusColor = 'text-blue-600 bg-blue-50 border-blue-100';
                        } else if (c.deviceStatus === 'installed') {
                            statusLabel = 'تم التركيب';
                            statusColor = 'text-indigo-600 bg-indigo-50 border-indigo-100';
                        } else if (c.deviceStatus === 'active') {
                            statusLabel = 'نشط (يعمل)';
                            statusColor = 'text-emerald-600 bg-emerald-50 border-emerald-100';
                        }

                        let progressPercentage = 25;
                        if (c.deviceStatus === 'delivered') progressPercentage = 50;
                        else if (c.deviceStatus === 'installed') progressPercentage = 75;
                        else if (c.deviceStatus === 'active') progressPercentage = 100;

                        return (
                            <div
                                key={c.id}
                                onClick={() => handleSelectContract(c)}
                                className="bg-white rounded-3xl border border-slate-100 hover:border-sky-300 hover:shadow-lg transition-all p-6 cursor-pointer flex flex-col justify-between group shadow-sm"
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-xs font-black text-slate-400 font-mono">#{c.contractNumber}</span>
                                        <span className={`text-[10px] font-black px-2.5 py-1.5 rounded-xl border ${statusColor}`}>
                                            {statusLabel}
                                        </span>
                                    </div>
                                    <h4 className="font-bold text-slate-800 text-base mb-2 group-hover:text-sky-600 transition-colors">
                                        {c.deviceModelName}
                                    </h4>
                                    <div className="space-y-1.5 text-xs text-slate-500 font-medium">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span>تاريخ العقد: <span className="font-bold text-slate-700">{new Date(c.contractDate).toLocaleDateString('ar-SY')}</span></span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span>الرقم التسلسلي: <span className="font-mono text-slate-700 font-bold">{c.serialNumber || 'غير محدد بعد'}</span></span>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-6 pt-4 border-t border-slate-50">
                                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-2">
                                        <span>مرحلة التتبع</span>
                                        <span>{progressPercentage}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                        <div
                                            className="bg-gradient-to-l from-sky-500 to-emerald-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${progressPercentage}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Slide-over Drawer */}
            <AnimatePresence>
                {selectedContract && (
                    <>
                        {/* Overlay */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.4 }}
                            exit={{ opacity: 0 }}
                            onClick={() => { setSelectedContract(null); setSelectedContractDetails(null); }}
                            className="fixed inset-0 bg-black z-[90] pointer-events-auto"
                        />
                        {/* Drawer content */}
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                            className="fixed inset-y-0 right-0 w-full max-w-xl bg-slate-50 shadow-2xl z-[100] flex flex-col h-full border-l border-slate-200 overflow-hidden"
                            style={{ direction: 'rtl' }}
                        >
                            {/* Drawer Header */}
                            <div className="px-6 py-5 bg-white border-b border-slate-100 flex items-center justify-between shrink-0">
                                <div>
                                    <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-sky-500" />
                                        تفاصيل عقد البيع #{selectedContract.contractNumber}
                                    </h3>
                                    <p className="text-xs text-slate-400 font-medium mt-1">تتبع دورة حياة وتثبيت الجهاز</p>
                                </div>
                                <button
                                    onClick={() => { setSelectedContract(null); setSelectedContractDetails(null); }}
                                    className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors text-slate-400 hover:text-slate-600"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Drawer Body */}
                            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scroll">
                                {/* Vertical Lifecycle Stepper */}
                                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                                    <h4 className="font-black text-slate-800 text-sm mb-4">حالة تتبع الجهاز</h4>
                                    <div className="relative before:absolute before:right-6 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-100">
                                        {steps.map((step, idx) => {
                                            const isCompleted = idx < activeStepIndex;
                                            const isActive = idx === activeStepIndex;

                                            let stepColor = 'bg-slate-50 border-slate-200 text-slate-400';
                                            if (isCompleted) {
                                                stepColor = 'bg-emerald-500 border-emerald-500 text-white';
                                            } else if (isActive) {
                                                stepColor = 'bg-white border-sky-500 text-sky-600 ring-4 ring-sky-50';
                                            }

                                            return (
                                                <div key={step.key} className="relative pr-14 pb-6 last:pb-0 flex items-start gap-4">
                                                    {/* Circle Badge */}
                                                    <div className={`absolute right-3.5 top-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center font-bold text-xs z-10 transition-all ${stepColor}`}>
                                                        {isCompleted ? (
                                                            <Check className="w-3.5 h-3.5" />
                                                        ) : (
                                                            <span>{idx + 1}</span>
                                                        )}
                                                    </div>

                                                    <div>
                                                        <h5 className={`font-bold text-sm ${isActive ? 'text-sky-600 text-sm font-black' : isCompleted ? 'text-slate-700' : 'text-slate-400'}`}>
                                                            {step.label}
                                                        </h5>
                                                        <p className="text-[11px] text-slate-400 font-medium mt-0.5">{step.desc}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Dynamic Action CTA Button */}
                                {currentStatus === 'delivered' && (
                                    <div className="bg-gradient-to-l from-sky-500 to-indigo-600 rounded-3xl p-6 text-white shadow-[0_8px_20px_rgba(14,165,233,0.15)]">
                                        <h5 className="font-bold text-sm mb-1">الجهاز مسلّم وجاهز للتركيب</h5>
                                        <p className="text-xs text-white/80 font-medium mb-4">يمكنك الآن جدولة مهمة تركيب الجهاز للزبون لإرسال الفنيين للموقع.</p>
                                        <button
                                            onClick={() => handleCreateTask('device_installation')}
                                            disabled={actionLoading}
                                            className="w-full py-3 bg-white text-sky-700 hover:bg-slate-50 font-bold rounded-2xl shadow transition-all hover:scale-[1.01] flex items-center justify-center gap-2 text-xs disabled:opacity-50"
                                        >
                                            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
                                            إضافة مهمة تركيب الجهاز
                                        </button>
                                    </div>
                                )}

                                {currentStatus === 'installed' && (
                                    <div className="bg-gradient-to-l from-indigo-500 to-emerald-600 rounded-3xl p-6 text-white shadow-[0_8px_20px_rgba(99,102,241,0.15)]">
                                        <h5 className="font-bold text-sm mb-1">الجهاز مركّب وجاهز للتشغيل</h5>
                                        <p className="text-xs text-white/80 font-medium mb-4">يمكنك الآن جدولة مهمة تشغيل وفحص الجهاز النهائية لتفعيله بشكل كامل.</p>
                                        <button
                                            onClick={() => handleCreateTask('device_activation')}
                                            disabled={actionLoading}
                                            className="w-full py-3 bg-white text-indigo-700 hover:bg-slate-50 font-bold rounded-2xl shadow transition-all hover:scale-[1.01] flex items-center justify-center gap-2 text-xs disabled:opacity-50"
                                        >
                                            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                            إضافة مهمة تشغيل الجهاز
                                        </button>
                                    </div>
                                )}

                                {currentStatus === 'pending_delivery' && (
                                    <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5 text-amber-800">
                                        <h5 className="font-bold text-xs mb-1 flex items-center gap-1.5">
                                            <Truck className="w-4 h-4 text-amber-500" />
                                            في انتظار تسليم الجهاز
                                        </h5>
                                        <p className="text-[11px] font-bold text-amber-600">
                                            العقد في مرحلة التسليم حالياً. سيتم تحديث هذه الصفحة تلقائياً بمجرد إكمال الفنيين لمهمة تسليم الجهاز.
                                        </p>
                                    </div>
                                )}

                                {currentStatus === 'active' && (
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-5 text-emerald-800">
                                        <h5 className="font-bold text-xs mb-1 flex items-center gap-1.5">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                            الجهاز نشط بالكامل
                                        </h5>
                                        <p className="text-[11px] font-bold text-emerald-600">
                                            تم تسليم، تركيب، وتشغيل الجهاز بنجاح. العقد والجهاز حالياً نشطان وتعمل الصيانة الدورية وفق الخطة.
                                        </p>
                                    </div>
                                )}

                                {/* Linked Tasks */}
                                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
                                    <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
                                        <Activity className="w-4 h-4 text-slate-400" />
                                        مهام التتبع المرتبطة بالعقد
                                    </h4>
                                    {tasks.filter((t: any) => t.contractId === selectedContract.id).length === 0 ? (
                                        <p className="text-xs text-slate-400 font-bold text-center py-4">لا توجد مهام مرتبطة حالياً.</p>
                                    ) : (
                                        <div className="space-y-3">
                                            {tasks.filter((t: any) => t.contractId === selectedContract.id).map((t: any) => {
                                                let typeLabel = t.taskType;
                                                if (t.taskType === 'device_delivery') typeLabel = 'تسليم الجهاز';
                                                else if (t.taskType === 'device_installation') typeLabel = 'تركيب الجهاز';
                                                else if (t.taskType === 'device_activation') typeLabel = 'تشغيل الجهاز';

                                                let statusText = t.status;
                                                let statusStyle = 'bg-slate-50 text-slate-500 border-slate-100';
                                                if (t.status === 'open') {
                                                    statusText = 'مفتوحة';
                                                    statusStyle = 'bg-amber-50 text-amber-700 border-amber-100';
                                                } else if (t.status === 'scheduled') {
                                                    statusText = 'مجدولة';
                                                    statusStyle = 'bg-sky-50 text-sky-700 border-sky-100';
                                                } else if (t.status === 'in_visit') {
                                                    statusText = 'في الزيارة';
                                                    statusStyle = 'bg-purple-50 text-purple-700 border-purple-100';
                                                } else if (t.status === 'completed') {
                                                    statusText = 'مكتملة';
                                                    statusStyle = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                                                } else if (t.status === 'cancelled') {
                                                    statusText = 'ملغية';
                                                    statusStyle = 'bg-rose-50 text-rose-700 border-rose-100';
                                                }

                                                return (
                                                    <div key={t.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                                        <div>
                                                            <h5 className="font-bold text-xs text-slate-800">{typeLabel}</h5>
                                                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">الموعد: {t.dueDate || '--'}</p>
                                                        </div>
                                                        <span className={`text-[10px] font-black px-2 py-1 rounded-lg border ${statusStyle}`}>
                                                            {statusText}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Specifications Grid */}
                                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
                                    <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-slate-400" />
                                        مواصفات الجهاز وموقع التركيب
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4 text-xs">
                                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100/50">
                                            <p className="text-[10px] text-slate-400 font-bold mb-1">موديل الجهاز</p>
                                            <p className="font-bold text-slate-700">{selectedContract.deviceModelName}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100/50">
                                            <p className="text-[10px] text-slate-400 font-bold mb-1">الرقم التسلسلي</p>
                                            <p className="font-mono font-bold text-slate-700">{selectedContract.serialNumber || 'غير محدد'}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100/50">
                                            <p className="text-[10px] text-slate-400 font-bold mb-1">خطة الصيانة</p>
                                            <p className="font-bold text-slate-700">{selectedContract.maintenancePlan || '3'} أشهر</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100/50">
                                            <p className="text-[10px] text-slate-400 font-bold mb-1">نوع البيع</p>
                                            <p className="font-bold text-slate-700">
                                                {selectedContract.saleType === 'direct' ? 'مباشر' : selectedContract.saleType === 'tradein' ? 'مقايضة' : 'حفظ'}
                                            </p>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100/50 col-span-2">
                                            <p className="text-[10px] text-slate-400 font-bold mb-1">عنوان التركيب</p>
                                            <p className="font-bold text-slate-700 flex items-center gap-1">
                                                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                <span>
                                                    {getFullLocationStr(selectedContract.installationGeoUnitId) !== 'غير محدد' ? `${getFullLocationStr(selectedContract.installationGeoUnitId)} - ` : ''}
                                                    {selectedContract.installationAddressText || 'لا يوجد تفاصيل إضافية'}
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Line Items — قطع وملحقات الجهاز */}
                                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
                                    <h4 className="font-black text-slate-800 text-sm flex items-center gap-2">
                                        <Wrench className="w-4 h-4 text-slate-400" />
                                        قطع وملحقات الجهاز
                                    </h4>
                                    {detailsLoading ? (
                                        <div className="text-center py-4">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-300" />
                                        </div>
                                    ) : (
                                        <>
                                            {totalCount > 0 && (
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200">
                                                        <span className="text-xs font-bold text-emerald-700">{installedCount}</span>
                                                        <span className="text-[10px] text-emerald-600">مركّب</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200">
                                                        <span className="text-xs font-bold text-amber-700">{pendingCount}</span>
                                                        <span className="text-[10px] text-amber-600">باقي</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200">
                                                        <span className="text-xs font-bold text-slate-700">{totalCount}</span>
                                                        <span className="text-[10px] text-slate-600">الإجمالي</span>
                                                    </div>
                                                </div>
                                            )}
                                            {pendingItems.length > 0 && (
                                                <div className="space-y-2">
                                                    <h5 className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                                                        <AlertCircle className="w-3.5 h-3.5" />
                                                        بانتظار التركيب ({pendingItems.length})
                                                    </h5>
                                                    {pendingItems.map((item: any) => (
                                                        <PartCard key={item.id} item={item} contract={selectedContract} installed={false} />
                                                    ))}
                                                </div>
                                            )}
                                            {installedItems.length > 0 && (
                                                <div className="space-y-2">
                                                    <h5 className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        مركّب ({installedItems.length})
                                                    </h5>
                                                    {installedItems.map((item: any) => (
                                                        <PartCard key={item.id} item={item} contract={selectedContract} installed={true} />
                                                    ))}
                                                </div>
                                            )}
                                            {totalCount === 0 && (
                                                <p className="text-xs text-slate-400 font-bold text-center py-4">لا توجد قطع أو ملحقات مسجلة.</p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
