import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronRight, Phone, MapPin, Share2,
    History, ArrowLeft,
    Plus, Briefcase, Activity, LayoutDashboard, Contact2, Navigation, Users, MessageCircle, ShieldCheck
} from 'lucide-react';
import { api } from '../lib/api';
import { useCandidateStore } from '../hooks/useCandidateStore';
import type { Client, GeoUnit } from '../lib/types';

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
    const [activeTab, setActiveTab] = useState<'overview' | 'contacts' | 'visits' | 'network'>('overview');
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

    // Format Data Helper
    const getInitials = (name: string) => {
        if (!name) return 'Z';
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`;
        return name[0];
    };

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
                            <div className="w-24 h-24 rounded-full bg-sky-100 border-4 border-white shadow-xl flex items-center justify-center mb-4 relative">
                                <span className="text-3xl font-black text-sky-600 tracking-tighter">{getInitials(client.name)}</span>
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
                                { id: 'visits', label: 'الزيارات', icon: Navigation },
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
                                {activeTab === 'contacts' && <ContactsTab client={client} />}
                                {activeTab === 'visits' && <VisitsTab />}
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

function ContactsTab({ client }: { client: Client }) {
    return (
        <div className="space-y-6 max-w-5xl">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-800">جهات الاتصال الخاصة بالزبون</h3>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {(client.contacts || []).map((c, i) => (
                    <div key={c.id || i} className="bg-white rounded-[2rem] border border-gray-200 shadow-sm overflow-hidden flex flex-col xl:flex-row shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 group">

                        {/* === Left Side: Number Info === */}
                        <div className="p-8 bg-gradient-to-br from-slate-50 to-white border-b xl:border-b-0 xl:border-l border-gray-100 xl:w-[400px] flex flex-col justify-between relative overflow-hidden">
                            {/* Decorative background blur */}
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
                                    <span className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-xl font-bold shadow-sm border ${c.status === 'active' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-red-50 border-red-100 text-red-600'}`}>
                                        <Activity className="w-3.5 h-3.5" />
                                        {c.status === 'active' ? 'يعمل' : 'مفصول'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* === Right Side: Selected Call Logs view Workspace === */}
                        <div className="flex-1 p-8 relative bg-white">
                            <div className="flex items-center justify-between mb-6">
                                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                    <History className="w-4 h-4 text-sky-500" /> سجل مكالمات هذا الرقم
                                </h4>
                                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">آخر 2 مكالمات</span>
                            </div>

                            <div className="space-y-4">
                                {/* Example Log Item 1 */}
                                <div className="relative pl-4 border-r-2 border-sky-500 pr-5 group/log hover:bg-slate-50 transition-colors rounded-l-2xl py-2">
                                    <div className="absolute top-3 -right-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-sky-500" />
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-slate-800 text-sm">مكالمة متابعة صيانة دورية</span>
                                        <span className="text-slate-400 font-mono text-[10px] bg-white border border-slate-100 px-2 py-0.5 rounded-md shadow-sm">27/02/2026 - 10:00 AM</span>
                                    </div>
                                    <p className="text-xs text-slate-500 leading-relaxed max-w-lg">تم الاتصال لتأكيد موعد تغيير الفلاتر، الزبون متجاوب وينتظر الفريق غداً.</p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">موظف: يوسف المنسق</span>
                                        <span className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded font-bold">تم الرد</span>
                                    </div>
                                </div>

                                {/* Example Log Item 2 */}
                                <div className="relative pl-4 border-r-2 border-amber-400 pr-5 group/log hover:bg-slate-50 transition-colors rounded-l-2xl py-2">
                                    <div className="absolute top-3 -right-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-amber-400" />
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-slate-800 text-sm">التسويق المبدئي - طلب تأجيل</span>
                                        <span className="text-slate-400 font-mono text-[10px] bg-white border border-slate-100 px-2 py-0.5 rounded-md shadow-sm">10/01/2026 - 12:30 PM</span>
                                    </div>
                                    <p className="text-xs text-slate-500 leading-relaxed max-w-lg">الزبون مشغول حالياً، طلب التواصل بعد أسبوعين لبحث خيارات أجهزة الفلاتر.</p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">موظف: سارة محمد</span>
                                        <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded font-bold">تأجيل</span>
                                    </div>
                                </div>
                            </div>

                            <button className="mt-6 px-4 py-3 border border-slate-200 text-slate-600 hover:text-sky-600 bg-slate-50 hover:bg-sky-50 font-bold rounded-xl text-sm w-full transition-all flex justify-center items-center gap-2 shadow-sm">
                                <Plus className="w-4 h-4" /> إضافة سجل مكالمة جديدة
                            </button>
                        </div>

                    </div>
                ))}
            </div>
        </div>
    );
}

function VisitsTab() {
    return (
        <div className="space-y-6 max-w-5xl h-full flex flex-col">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-800">سجل الزيارات (مساحة العمل)</h3>
                <button className="px-5 py-2.5 bg-sky-600 text-white font-bold rounded-xl shadow-[0_4px_12px_rgba(14,165,233,0.3)] hover:bg-sky-500 transition-all hover:-translate-y-0.5 flex items-center gap-2 text-sm">
                    <Plus className="w-4 h-4" /> إضافة زيارة جديدة
                </button>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-12 text-center flex-1 flex flex-col items-center justify-center">
                <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <Navigation className="w-10 h-10 text-slate-300" />
                </div>
                <h4 className="text-lg text-slate-600 font-black mb-2">لا توجد زيارات مسجلة بعد</h4>
                <p className="text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">ستظهر هنا تفاصيل الزيارات المستقبلية والسابقة الخاصة بالزبون، بما في ذلك التسويق والصيانة.</p>
                <button className="mt-6 text-sky-600 font-bold text-sm bg-sky-50 px-6 py-2.5 rounded-xl hover:bg-sky-100 transition-all">إضافة أول زيارة</button>
            </div>
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
