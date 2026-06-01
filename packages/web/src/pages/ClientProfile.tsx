import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronRight, Phone, MapPin, Share2,
    History, ArrowLeft,
    Plus, Briefcase, Activity, LayoutDashboard, Contact2, Navigation, Users, MessageCircle, ShieldCheck,
    X, Loader2, PhoneCall, Zap, FileText, CheckCircle2, Wrench, Check, Truck, Calendar, Layers, AlertCircle,
    Cpu, Package, Sparkles
} from 'lucide-react';
import { DevicesTab } from './clientProfile/DevicesTab'; // plan §1 — replaces legacy ContractsTab
import { PurchaseHistoryTab } from './clientProfile/PurchaseHistoryTab';
import { PartsStockTab } from './clientProfile/PartsStockTab';
import { PreOffersTab } from './clientProfile/PreOffersTab'; // plan B — device-demo pre-offers audit
import { api } from '../lib/api';
import { useCandidateStore } from '../hooks/useCandidateStore';
import type { Client, GeoUnit } from '../lib/types';
import { buildGeoPath, geoLevelLabel } from '../lib/geoPath';
import ClientAvatar from '../components/ClientAvatar';
import { getOutcomeMeta, OUTCOMES_BY_GROUP, TelemarketingOutcomeCode, PHONE_STATUS_TO_CONTACT_ENTRY, OUTCOME_MAP } from '@golden-crm/shared';
import OutcomeRecorderModal, { SaveExtras } from '../components/telemarketing/OutcomeRecorderModal';
import ContactControlCard from '../components/clients/ContactControlCard';
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

const EMPTY_VALUE = '-';

function valueOrEmpty(value?: string | number | null): string {
    if (value === null || value === undefined || value === '') return EMPTY_VALUE;
    return String(value);
}

function formatDate(value?: string | null): string {
    if (!value) return EMPTY_VALUE;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GB');
}

function getClientDisplayName(client: Client): string {
    return [client.firstName, client.fatherName, client.lastName].filter(Boolean).join(' ') || client.name || EMPTY_VALUE;
}

function getLifecycleMeta(client: Client) {
    const stage = ((client as any).lifecycleStage || client.candidateStatus || 'Lead') as string;
    const map: Record<string, { label: string; className: string }> = {
        OP: { label: 'زبون فعلي (OP)', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
        FOP: { label: 'مستهدف (FOP)', className: 'bg-orange-50 text-orange-700 border-orange-200' },
        Lead: { label: 'مرشح (Lead)', className: 'bg-sky-50 text-sky-700 border-sky-200' },
    };
    return map[stage] || { label: stage || 'مرشح (Lead)', className: 'bg-slate-50 text-slate-600 border-slate-200' };
}

function getRatingLabel(rating?: string | null): string {
    if (rating === 'Committed') return 'زبون ملتزم';
    if (rating === 'NotCommitted') return 'زبون غير ملتزم';
    return EMPTY_VALUE;
}

function getLocationLeafId(client: Client): number | null {
    const candidates = [client.neighborhood, client.district, client.governorate];
    for (const candidate of candidates) {
        if (candidate === null || candidate === undefined || candidate === '') continue;
        const id = Number(candidate);
        if (!Number.isNaN(id)) return id;
    }
    return null;
}

function formatWesternNumber(value?: string | number | null): string {
    if (value === null || value === undefined || value === '') return EMPTY_VALUE;
    return String(value).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function InfoItem({ label, value, dir }: { label: string; value?: string | number | null; dir?: 'rtl' | 'ltr' }) {
    return (
        <div className="min-w-0 rounded-xl border border-slate-100 bg-white/80 px-3 py-2.5">
            <p className="text-[11px] font-bold text-slate-400">{label}</p>
            <p className="mt-1 break-words text-sm font-bold leading-6 text-slate-800" dir={dir}>
                {valueOrEmpty(value)}
            </p>
        </div>
    );
}

function OwnershipItem({ client }: { client: Client }) {
    const assignments = client.assignments?.filter((assignment) => assignment.userName) || [];
    const ownerLabel = client.ownership?.ownerLabel;

    return (
        <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-bold text-slate-400">الملكية / الإسناد</p>
            {assignments.length > 1 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {assignments.map((assignment) => (
                        <span key={assignment.userId} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                            {assignment.userName}
                            {assignment.roleDisplayName ? <span className="text-slate-400"> - {assignment.roleDisplayName}</span> : null}
                        </span>
                    ))}
                </div>
            ) : (
                <p className="mt-1 break-words text-sm font-bold leading-6 text-slate-800">
                    {ownerLabel || assignments[0]?.userName || EMPTY_VALUE}
                </p>
            )}
        </div>
    );
}

function HeaderMetaItem({ label, value }: { label: string; value?: string | number | null }) {
    return (
        <div className="min-w-[8rem] rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-bold text-slate-400">{label}</p>
            <p className="mt-0.5 break-words text-sm font-black text-slate-800">{valueOrEmpty(value)}</p>
        </div>
    );
}

function InfoGroup({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-black text-slate-800">{title}</h3>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{children}</div>
        </section>
    );
}

function ProfileHeaderSection({ client, geoUnits }: { client: Client; geoUnits: GeoUnit[] }) {
    const displayName = getClientDisplayName(client);
    const lifecycle = getLifecycleMeta(client);
    const locationPath = buildGeoPath(geoUnits, getLocationLeafId(client));
    const locationText = locationPath.map((unit) => unit.name).join('، ');
    const hasGps =
        client.gpsCoordinates &&
        typeof client.gpsCoordinates.lat === 'number' &&
        typeof client.gpsCoordinates.lng === 'number';
    const lat = hasGps ? client.gpsCoordinates!.lat : null;
    const lng = hasGps ? client.gpsCoordinates!.lng : null;
    const mapEmbedUrl = hasGps
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng! - 0.01}%2C${lat! - 0.01}%2C${lng! + 0.01}%2C${lat! + 0.01}&layer=mapnik&marker=${lat!}%2C${lng!}`
        : '';
    const mapOpenUrl = hasGps
        ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
        : '';

    return (
        <section className="border-b border-slate-200 bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
                            <ClientAvatar
                                gender={client.gender}
                                dataQuality={client.dataQuality}
                                size="lg"
                                className="shrink-0 border-4 border-white shadow-lg"
                            />
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="break-words text-2xl font-black leading-9 text-slate-900 sm:text-3xl">
                                        {displayName}
                                    </h1>
                                    {client.nickname && (
                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500">
                                            {client.nickname}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${lifecycle.className}`}>
                                        {lifecycle.label}
                                    </span>
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                        الالتزام: {getRatingLabel(client.rating)}
                                    </span>
                                </div>
                                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-2xl">
                                    <HeaderMetaItem label="فرع التسجيل" value={client.branchName} />
                                    <HeaderMetaItem label="تاريخ الإنشاء" value={formatDate(client.createdAt)} />
                                    <HeaderMetaItem label="منشئ السجل" value={client.createdByUserName} />
                                </div>
                            </div>
                        </div>
                        <div className="w-full lg:max-w-md">
                            <OwnershipItem client={client} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
                    <div className="space-y-4">
                        <InfoGroup title="الهوية الشخصية" icon={ShieldCheck}>
                            <InfoItem label="الرقم الوطني" value={formatWesternNumber(client.nationalId)} dir="ltr" />
                            <InfoItem label="تاريخ الميلاد" value={formatDate(client.birthDate)} />
                            <InfoItem label="اسم الأم" value={client.motherName} />
                            <InfoItem label="القيد" value={client.nationalIdRegistry} />
                            <InfoItem label="أمانة الإصدار" value={client.nationalIdIssuedBy} />
                            <InfoItem label="تاريخ الإصدار" value={formatDate(client.nationalIdIssueDate)} />
                            <InfoItem label="الخانة" value={formatWesternNumber(client.nationalIdBox)} />
                        </InfoGroup>

                        <InfoGroup title="العمل والمعيشة" icon={Briefcase}>
                            <InfoItem label="المهنة" value={client.occupation} />
                            <InfoItem label="مهنة الزوجة" value={client.spouseOccupation} />
                            <InfoItem label="مصدر المياه" value={client.waterSource} />
                        </InfoGroup>
                    </div>

                    <section className="rounded-2xl border border-sky-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="mb-2 flex items-center gap-2">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                                        <MapPin className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-wide text-sky-500">موقع الزبون</p>
                                        <h3 className="text-base font-black text-slate-900">العنوان والموقع على الخريطة</h3>
                                    </div>
                                </div>
                                {locationPath.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {locationPath.map((unit) => (
                                            <span key={unit.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
                                                <span className="text-slate-400">{geoLevelLabel(unit.level)}: </span>
                                                {unit.name}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm font-bold text-slate-400">{EMPTY_VALUE}</p>
                                )}
                            </div>
                        </div>

                        <div className="mb-4 space-y-3">
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                                <p className="text-[11px] font-bold text-slate-400">المسار الجغرافي</p>
                                <p className="mt-1 break-words text-sm font-black leading-6 text-slate-800">
                                    {locationText || EMPTY_VALUE}
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                                <p className="text-[11px] font-bold text-slate-400">العنوان التفصيلي</p>
                                <p className="mt-1 break-words text-sm font-bold leading-6 text-slate-800">
                                    {valueOrEmpty(client.detailedAddress)}
                                </p>
                            </div>
                        </div>

                        {hasGps ? (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                                <iframe
                                    src={mapEmbedUrl}
                                    className="h-64 w-full sm:h-72 xl:h-80"
                                    style={{ border: 0 }}
                                    loading="lazy"
                                    title="خريطة موقع الزبون"
                                />
                                <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                                    <span className="font-mono text-xs text-slate-500" dir="ltr">
                                        {formatWesternNumber(lat)}, {formatWesternNumber(lng)}
                                    </span>
                                    <a
                                        href={mapOpenUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-500"
                                    >
                                        <Navigation className="h-4 w-4" />
                                        فتح الخريطة
                                    </a>
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center text-slate-400">
                                <Navigation className="mb-2 h-6 w-6" />
                                <p className="text-sm font-bold">لا توجد إحداثيات GPS لهذا الزبون</p>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </section>
    );
}

export default function ClientProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'overview' | 'contacts' | 'calllog' | 'visits' | 'network' | 'devices' | 'purchase_history' | 'parts_stock' | 'pre_offers'>('overview');
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

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50" style={{ direction: 'rtl' }}>
            {/* Header / Breadcrumbs - Corrected path text */}
            <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
                    <button onClick={() => navigate('/clients')} className="flex items-center gap-2 font-bold text-slate-500 transition-colors hover:text-sky-600">
                        <ArrowLeft className="h-4 w-4" />
                        <span className="hidden sm:inline">سجلات الزبائن</span>
                        <span className="sm:hidden">رجوع</span>
                    </button>
                    <ChevronRight className="hidden h-4 w-4 text-slate-300 sm:block" />
                    <span className="min-w-0 break-words font-bold text-slate-900">{getClientDisplayName(client)}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scroll">
                <ProfileHeaderSection client={client} geoUnits={allGeoUnits} />

                <main className="min-w-0 bg-slate-50">
                    <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6 lg:px-8">
                        <div className="mx-auto max-w-7xl overflow-x-auto no-scrollbar">
                            <div className="flex w-max min-w-full items-center gap-1.5 rounded-2xl border border-gray-200 bg-gray-50 p-1.5 shadow-sm">
                            {[
                                { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
                                { id: 'contacts', label: 'التواصل', icon: Contact2 },
                                { id: 'calllog', label: 'سجل الاتصال', icon: PhoneCall },
                                { id: 'visits', label: 'الزيارات', icon: Navigation },
                                { id: 'devices', label: 'الأجهزة', icon: Cpu },
                                { id: 'purchase_history', label: 'سجل المشتريات', icon: History },
                                { id: 'parts_stock', label: 'المخزون', icon: Package },
                                { id: 'pre_offers', label: 'العروض المسبقة', icon: Sparkles },
                                { id: 'network', label: 'الشبكة', icon: Share2 },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all whitespace-nowrap sm:px-5 ${activeTab === tab.id
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
                    </div>

                    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="h-full"
                            >
                                {activeTab === 'overview' && (
                                    <OverviewTab
                                        client={client}
                                        onClientChanged={async () => {
                                            const fresh = await api.clients.get(client.id);
                                            setClient(fresh);
                                        }}
                                    />
                                )}
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
                                {activeTab === 'devices' && <DevicesTab client={client} />}
                                {activeTab === 'purchase_history' && <PurchaseHistoryTab client={client} />}
                                {activeTab === 'parts_stock' && <PartsStockTab client={client} />}
                                {activeTab === 'pre_offers' && <PreOffersTab client={client} />}
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

function OverviewTab({ client, onClientChanged }: { client: Client; onClientChanged: () => void | Promise<void> }) {
    return (
        <div className="w-full h-full max-w-4xl space-y-4">
            {/* DEC-005 D29 + DEC-006 D32: contact-control surface (cooldown + do_not_contact) */}
            <ContactControlCard client={client} onChange={() => { void onClientChanged(); }} />

            {client.notes ? (
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
            ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-slate-400 shadow-sm">
                    <FileText className="mx-auto mb-3 h-8 w-8 opacity-50" />
                    <p className="text-sm font-bold">لا توجد ملاحظات مسجلة لهذا الزبون.</p>
                </div>
            )}
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
    const hasActiveDeviceDemo = tasks.some((task) => {
        const taskType = task.taskType ?? task.task_type ?? task.openTaskType;
        return taskType === 'device_demo' && !['completed', 'cancelled', 'closed'].includes(task.status);
    });

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
                        disabled={hasActiveDeviceDemo}
                        className="px-4 py-2 bg-sky-600 text-white font-bold rounded-xl shadow-sm hover:bg-sky-500 transition-all flex items-center gap-1.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                        <Plus className="w-4 h-4" /> عرض جهاز
                    </button>
                </div>
            </div>
            {hasActiveDeviceDemo && (
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

function referrerTypeLabel(type: string): string {
    const map: Record<string, string> = {
        client: 'زبون', employee: 'موظف', personal: 'شخصي', customer: 'عميل', unknown: 'غير محدد',
    };
    return map[type?.toLowerCase()] ?? type ?? 'غير محدد';
}

function typeBadgeClass(type: string): string {
    const map: Record<string, string> = {
        client: 'bg-sky-100 text-sky-700', employee: 'bg-violet-100 text-violet-700',
        personal: 'bg-amber-100 text-amber-700', customer: 'bg-emerald-100 text-emerald-700',
        unknown: 'bg-slate-100 text-slate-500',
    };
    return map[type?.toLowerCase()] ?? 'bg-slate-100 text-slate-500';
}

function outgoingStatusBadge(ref: any): { cls: string; label: string } {
    if (ref.convertedToLeadId || ref.isCandidate === false) {
        return { cls: 'bg-emerald-100 text-emerald-700', label: 'تحوّل لزبون' };
    }
    const statusMap: Record<string, { cls: string; label: string }> = {
        Suggested: { cls: 'bg-slate-100 text-slate-600', label: 'مقترح' },
        FollowUp:  { cls: 'bg-amber-100 text-amber-700', label: 'قيد المتابعة' },
        Contacted: { cls: 'bg-sky-100 text-sky-700', label: 'تم التواصل' },
        Qualified: { cls: 'bg-blue-100 text-blue-700', label: 'مؤهل' },
        Junk:      { cls: 'bg-red-100 text-red-700', label: 'رفض' },
        New:       { cls: 'bg-slate-100 text-slate-600', label: 'جديد' },
    };
    return statusMap[ref.status] ?? { cls: 'bg-slate-100 text-slate-500', label: ref.status ?? 'غير محدد' };
}

function NetworkTab({ client, clients, candidates }: any) {
    let incomingReferrals: Array<{ id?: number; name: string; type: string }> = client.referrers ?? [];
    if (incomingReferrals.length === 0 && client.referrerName && client.referrerName !== 'مجهول') {
        incomingReferrals = [{ name: client.referrerName, type: client.referrerType || 'unknown' }];
    }

    const clientReferrals = clients.filter((c: any) => c.referralEntityId === client.id);
    const candidateReferrals = candidates.filter((c: any) => c.referralEntityId === client.id);
    const allOutgoing = [...clientReferrals, ...candidateReferrals];

    return (
        <div className="space-y-10 max-w-5xl">

            {/* ══ القسم 1: وسطاء الزبون ══════════════════════════════════════════ */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                        <Share2 className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-800">وسطاء الزبون</h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد الوسطاء: {incomingReferrals.length}</p>
                    </div>
                </div>
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                    {incomingReferrals.length > 0 ? (
                        <>
                            <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-gray-100 text-xs font-black text-slate-500">
                                <span className="col-span-1">#</span>
                                <span className="col-span-5">اسم الوسيط</span>
                                <span className="col-span-3">النوع</span>
                                <span className="col-span-3">تاريخ الاقتراح</span>
                            </div>
                            {incomingReferrals.map((ref, i) => (
                                <div key={i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-50 hover:bg-slate-50/50 items-center text-sm">
                                    <span className="col-span-1 font-mono text-xs text-slate-400">{i + 1}</span>
                                    <span className="col-span-5 font-bold text-slate-800">{ref.name}</span>
                                    <span className="col-span-3">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${typeBadgeClass(ref.type)}`}>
                                            {referrerTypeLabel(ref.type)}
                                        </span>
                                    </span>
                                    <span className="col-span-3 font-mono text-xs text-slate-500">{client.createdAt?.split('T')[0] || '--'}</span>
                                </div>
                            ))}
                        </>
                    ) : (
                        <div className="px-6 py-12 text-center">
                            <Share2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                            <p className="text-slate-400 font-bold">لا يوجد وسطاء مسجّلين لهذا الزبون.</p>
                        </div>
                    )}
                </div>
            </section>

            {/* ══ القسم 2: الأسماء المقترحة ════════════════════════════════════ */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                        <Users className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-800">الأسماء المقترحة</h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد الأسماء: {allOutgoing.length}</p>
                    </div>
                </div>
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                    {allOutgoing.length > 0 ? (
                        <>
                            <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-gray-100 text-xs font-black text-slate-500">
                                <span className="col-span-1">#</span>
                                <span className="col-span-4">الاسم</span>
                                <span className="col-span-3">الرقم</span>
                                <span className="col-span-4">الحالة</span>
                            </div>
                            {allOutgoing.map((ref: any, i: number) => (
                                <div key={ref.id ?? i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-gray-50 hover:bg-slate-50/50 items-center text-sm">
                                    <span className="col-span-1 font-mono text-xs text-slate-400">{i + 1}</span>
                                    <span className="col-span-4 font-bold text-slate-800">
                                        {ref.name || `${ref.firstName || ''} ${ref.lastName || ''}`.trim()}
                                    </span>
                                    <span className="col-span-3 font-mono text-slate-500" dir="ltr">
                                        {ref.mobile || ref.contacts?.find((c: any) => c.isPrimary)?.number || ref.contacts?.[0]?.number || '--'}
                                    </span>
                                    <span className="col-span-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${outgoingStatusBadge(ref).cls}`}>
                                            {outgoingStatusBadge(ref).label}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </>
                    ) : (
                        <div className="px-6 py-12 text-center">
                            <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                            <p className="text-slate-400 font-bold">لم يقم هذا الزبون بترشيح أي أشخاص حتى الآن.</p>
                        </div>
                    )}
                </div>
            </section>

        </div>
    );
}
