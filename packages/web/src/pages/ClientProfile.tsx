import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronRight, Phone, MapPin, Share2,
    History, ArrowLeft,
    Plus, Briefcase, Activity, LayoutDashboard, Contact2, Navigation, Users, MessageCircle, ShieldCheck,
    X, Loader2, PhoneCall, Zap, FileText, CheckCircle2, Wrench, Check, Truck, Calendar, Layers, AlertCircle,
    Cpu, Package, Sparkles, Gift, Clock, DollarSign, Star
} from 'lucide-react';
import { DevicesTab } from './clientProfile/DevicesTab'; // plan §1 — replaces legacy ContractsTab
import { PurchaseHistoryTab } from './clientProfile/PurchaseHistoryTab';
import { PartsStockTab } from './clientProfile/PartsStockTab';
import { PreOffersTab } from './clientProfile/PreOffersTab'; // plan B — device-demo pre-offers audit
import { AccountStatementTab } from './clientProfile/AccountStatementTab';
import GiftsTab from './clientProfile/GiftsTab';
import { api } from '../lib/api';
import type { Client, GeoUnit } from '../lib/types';
import { buildGeoPath, geoLevelLabel } from '../lib/geoPath';
import ClientAvatar from '../components/ClientAvatar';
import { getOutcomeMeta, OUTCOMES_BY_GROUP, TelemarketingOutcomeCode, PHONE_STATUS_TO_CONTACT_ENTRY, OUTCOME_MAP } from '@golden-crm/shared';
import {
    getTaskPhase,
    OPEN_TASK_PHASE_LABELS,
    OPEN_TASK_PHASE_COLORS,
    OPEN_TASK_STATUS_LABELS,
    OPEN_TASK_TYPE_LABELS,
    type OpenTaskStatus,
} from '@golden-crm/shared';
import OutcomeRecorderModal, { SaveExtras } from '../components/telemarketing/OutcomeRecorderModal';
import ContactControlCard from '../components/clients/ContactControlCard';
import CustomerCallLog from '../components/customers/CustomerCallLog';
import PhoneCallLog from '../components/customers/PhoneCallLog';
import DeviceOfferModal from '../components/clients/DeviceOfferModal';
import RequestEmergencyModal from '../components/emergency/RequestEmergencyModal';
import NewServiceRequestModal from '../components/service-requests/NewServiceRequestModal';
import { usePermissions } from '../hooks/usePermissions';

type ClientProfileTabId =
    | 'overview'
    | 'contacts'
    | 'calllog'
    | 'visits'
    | 'network'
    | 'devices'
    | 'purchase_history'
    | 'parts_stock'
    | 'pre_offers'
    | 'gifts'
    | 'rating'
    | 'account_statement';

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
            <p className="text-xs font-bold text-slate-400">{label}</p>
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
            <p className="text-xs font-bold text-slate-400">الملكية / الإسناد</p>
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
            <p className="text-xs font-bold text-slate-400">{label}</p>
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
                <h3 className="text-base font-bold text-slate-800">{title}</h3>
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
                                    <h1 className="break-words text-2xl font-bold leading-9 text-slate-800 sm:text-2xl">
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
                                        <p className="text-xs font-black uppercase tracking-wide text-sky-500">موقع الزبون</p>
                                        <h3 className="text-base font-bold text-slate-800">العنوان والموقع على الخريطة</h3>
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
                                <p className="text-xs font-bold text-slate-400">المسار الجغرافي</p>
                                <p className="mt-1 break-words text-sm font-black leading-6 text-slate-800">
                                    {locationText || EMPTY_VALUE}
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                                <p className="text-xs font-bold text-slate-400">العنوان التفصيلي</p>
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

                {/* ملاحظات الزبون — بوكس مستقل أسفل موقع الزبون (منقول من تبويب «نظرة عامة») */}
                {client.notes ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex items-center gap-2">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                                <FileText className="h-4 w-4" />
                            </div>
                            <h3 className="text-base font-bold text-slate-800">ملاحظات الزبون</h3>
                        </div>
                        <div
                            className="rich-notes prose prose-sm max-w-none leading-relaxed text-slate-600 prose-slate"
                            dangerouslySetInnerHTML={{ __html: client.notes }}
                        />
                        <style>{`
                            .rich-notes ul { list-style-type: disc; padding-inline-start: 1.5rem; margin: 1rem 0; }
                            .rich-notes ol { list-style-type: decimal; padding-inline-start: 1.5rem; margin: 1rem 0; }
                            .rich-notes p { margin: 0.5rem 0; }
                            .rich-notes h1, .rich-notes h2, .rich-notes h3 { margin-top: 1.5rem; margin-bottom: 0.5rem; font-weight: bold; }
                        `}</style>
                    </section>
                ) : (
                    <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-400 shadow-sm">
                        <FileText className="mx-auto mb-2 h-7 w-7 opacity-50" />
                        <p className="text-sm font-bold">لا توجد ملاحظات مسجلة لهذا الزبون.</p>
                    </section>
                )}
            </div>
        </section>
    );
}

export default function ClientProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { hasPermission, hasAnyPermission } = usePermissions();
    const canViewContacts = hasPermission('clients.contacts.view');
    const canEditContacts = hasPermission('clients.contacts.edit');
    const canViewCallLog = hasPermission('clients.call_log.view');
    const canCreateCallLog = hasAnyPermission('clients.call_log.create', 'telemarketing.calls.create');
    const canEditCallLog = hasAnyPermission('clients.call_log.edit', 'telemarketing.calls.create');
    const canViewVisits = hasPermission('clients.visits.view') || hasAnyPermission('open_tasks.view', 'field_visits.view');
    const canViewDevices = hasAnyPermission('clients.devices.view', 'contracts.view_list');
    const canViewPurchaseHistory = hasPermission('clients.purchase_history.view');
    const canViewPartsStock = hasPermission('clients.parts_stock.view');
    const canViewPreOffers = hasAnyPermission('clients.pre_offers.view', 'contracts.view_list');
    const canViewNetwork = hasPermission('clients.network.view');
    const canViewAccountStatement = hasPermission('clients.account_statement.view');
    const canViewRating = hasPermission('clients.rating.view');
    const canEditRating = hasPermission('clients.rating.edit');
    const canEditContactControl = hasPermission('clients.contact_control.edit') || hasPermission('clients.cooldown_unlock');
    const [activeTab, setActiveTab] = useState<ClientProfileTabId>('overview');
    const [callLogRefreshKey, setCallLogRefreshKey] = useState(0);
    const [client, setClient] = useState<Client | null>(null);
    const [allGeoUnits, setAllGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);

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
                const [clientData, geoUnitsData] = await Promise.all([
                    api.clients.get(clientId),
                    api.geoUnits.list(),
                ]);

                if (!active) return;
                setClient(clientData);
                setAllGeoUnits(geoUnitsData);
            } catch (error) {
                console.error('Failed to fetch client profile:', error);
                if (!active) return;
                setClient(null);
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

    const tabs: Array<{ id: ClientProfileTabId; label: string; icon: any }> = [
        ...(canViewContacts ? [{ id: 'contacts' as const, label: 'ط§ظ„طھظˆط§طµظ„', icon: Contact2 }] : []),
        ...(canViewCallLog ? [{ id: 'calllog' as const, label: 'ط³ط¬ظ„ ط§ظ„ط§طھطµط§ظ„', icon: PhoneCall }] : []),
        ...(canViewVisits ? [{ id: 'visits' as const, label: 'ط§ظ„ط²ظٹط§ط±ط§طھ', icon: Navigation }] : []),
        ...(canViewDevices ? [{ id: 'devices' as const, label: 'ط§ظ„ط£ط¬ظ‡ط²ط©', icon: Cpu }] : []),
        ...(canViewPurchaseHistory ? [{ id: 'purchase_history' as const, label: 'ط³ط¬ظ„ ط§ظ„ظ…ط´طھط±ظٹط§طھ', icon: History }] : []),
        ...(canViewPartsStock ? [{ id: 'parts_stock' as const, label: 'ط§ظ„ظ…ط®ط²ظˆظ†', icon: Package }] : []),
        ...(canViewPreOffers ? [{ id: 'pre_offers' as const, label: 'ط§ظ„ط¹ط±ظˆط¶ ط§ظ„ظ…ط³ط¨ظ‚ط©', icon: Sparkles }] : []),
        { id: 'gifts' as const, label: 'الهدايا', icon: Gift },
        ...(canViewRating ? [{ id: 'rating' as const, label: 'تقييم الالتزام', icon: Star }] : []),
        ...(canViewNetwork ? [{ id: 'network' as const, label: 'ط§ظ„ط´ط¨ظƒط©', icon: Share2 }] : []),
        ...(canViewAccountStatement ? [{ id: 'account_statement' as const, label: 'ظƒط´ظپ ط§ظ„ط­ط³ط§ط¨', icon: FileText }] : []),
    ];
    const safeActiveTab: ClientProfileTabId = tabs.some(tab => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? 'contacts');

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50" style={{ direction: 'rtl' }}>
            {/* Header / Breadcrumbs - Corrected path text */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8">
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
                    <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6 lg:px-8">
                        <div className="mx-auto max-w-7xl overflow-x-auto no-scrollbar">
                            <div className="flex w-max min-w-full items-center gap-1 border-b border-[#E3E7EC]">
                            {[
                                { id: 'contacts', label: 'التواصل', icon: Contact2 },
                                { id: 'calllog', label: 'سجل الاتصال', icon: PhoneCall },
                                { id: 'visits', label: 'الزيارات', icon: Navigation },
                                { id: 'devices', label: 'الأجهزة', icon: Cpu },
                                { id: 'purchase_history', label: 'سجل المشتريات', icon: History },
                                { id: 'parts_stock', label: 'المخزون', icon: Package },
                                { id: 'pre_offers', label: 'العروض المسبقة', icon: Sparkles },
                                { id: 'gifts', label: 'الهدايا', icon: Gift },
                                { id: 'rating', label: 'تقييم الالتزام', icon: Star },
                                { id: 'network', label: 'الشبكة', icon: Share2 },
                                { id: 'account_statement', label: 'كشف الحساب', icon: FileText },
                            ].filter((tab) => tabs.some(allowedTab => allowedTab.id === tab.id)).map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`relative inline-flex shrink-0 items-center justify-center gap-1.5 px-3.5 py-2.5 text-base font-bold whitespace-nowrap transition-colors ${safeActiveTab === tab.id
                                        ? 'text-sky-600 after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:bg-sky-600 after:rounded-t'
                                        : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                >
                                    <tab.icon className={`w-4 h-4 ${safeActiveTab === tab.id ? 'text-sky-600' : 'text-slate-400'}`} />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                            </div>
                        </div>
                    </div>

                    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={safeActiveTab}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                                className="h-full"
                            >
                                {safeActiveTab === 'contacts' && (
                                    <ContactsTab
                                        client={client}
                                        refreshKey={callLogRefreshKey}
                                        onCallSaved={() => setCallLogRefreshKey(k => k + 1)}
                                        onClientUpdate={(fields) => setClient(prev => prev ? { ...prev, ...fields } : null)}
                                        onClientChanged={async () => {
                                            const fresh = await api.clients.get(client.id);
                                            setClient(fresh);
                                        }}
                                        canViewCallLog={canViewCallLog}
                                        canCreateCallLog={canCreateCallLog}
                                        canEditContacts={canEditContacts}
                                        canEditCallLog={canEditCallLog}
                                        canEditContactControl={canEditContactControl}
                                    />
                                )}
                                {safeActiveTab === 'calllog' && (
                                    <div className="space-y-4 max-w-5xl">
                                        <h3 className="text-base font-bold text-slate-800">سجل الاتصال الكامل</h3>
                                        <CustomerCallLog customerId={client.id} refreshKey={callLogRefreshKey} canEdit={canEditCallLog} />
                                    </div>
                                )}
                                {safeActiveTab === 'visits' && <VisitsTab client={client} />}
                                {safeActiveTab === 'devices' && <DevicesTab client={client} />}
                                {safeActiveTab === 'purchase_history' && <PurchaseHistoryTab client={client} />}
                                {safeActiveTab === 'parts_stock' && <PartsStockTab client={client} />}
                                {safeActiveTab === 'pre_offers' && <PreOffersTab client={client} />}
                                {safeActiveTab === 'gifts' && <GiftsTab client={client} />}
                                {safeActiveTab === 'rating' && (
                                    <ClientRatingTab
                                        client={client}
                                        canEdit={canEditRating}
                                        onClientChanged={(updatedClient) => setClient(updatedClient)}
                                    />
                                )}
                                {safeActiveTab === 'network' && <NetworkTab client={client} />}
                                {safeActiveTab === 'account_statement' && <AccountStatementTab client={client} />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </main>
            </div>
        </div>
    );
}

{/* ============ TABS COMPONENTS ============ */ }

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

type RatingValue = 'Committed' | 'NotCommitted' | 'Undefined';

const RATING_OPTIONS: Array<{ value: RatingValue; label: string; className: string }> = [
    { value: 'Committed', label: 'ملتزم', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    { value: 'NotCommitted', label: 'غير ملتزم', className: 'border-rose-200 bg-rose-50 text-rose-700' },
    { value: 'Undefined', label: 'غير محدد', className: 'border-slate-200 bg-slate-50 text-slate-600' },
];

function ratingLabel(value?: string | null): string {
    return RATING_OPTIONS.find(option => option.value === value)?.label ?? 'غير محدد';
}

function ratingClass(value?: string | null): string {
    return RATING_OPTIONS.find(option => option.value === value)?.className ?? RATING_OPTIONS[2].className;
}

function ClientRatingTab({
    client,
    canEdit,
    onClientChanged,
}: {
    client: Client;
    canEdit: boolean;
    onClientChanged: (client: Client) => void;
}) {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedRating, setSelectedRating] = useState<RatingValue>((client.rating || 'Undefined') as RatingValue);
    const [notes, setNotes] = useState('');
    const [error, setError] = useState<string | null>(null);

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await api.clients.getRatingHistory(client.id);
            setHistory(rows);
        } catch (err: any) {
            setError(err?.message || 'تعذر تحميل سجل التقييم');
            setHistory([]);
        } finally {
            setLoading(false);
        }
    }, [client.id]);

    useEffect(() => {
        setSelectedRating((client.rating || 'Undefined') as RatingValue);
        setNotes('');
        fetchHistory();
    }, [client.id, client.rating, fetchHistory]);

    const saveRating = async () => {
        if (!canEdit || saving) return;
        setSaving(true);
        setError(null);
        try {
            const result = await api.clients.updateRating(client.id, {
                rating: selectedRating,
                notes: notes.trim() || null,
            });
            onClientChanged(result.client);
            setNotes('');
            await fetchHistory();
        } catch (err: any) {
            setError(err?.message || 'تعذر حفظ التقييم');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-xs font-black uppercase tracking-wide text-slate-400">آخر تقييم</p>
                        <div className="mt-2 flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-black ${ratingClass(client.rating)}`}>
                                {ratingLabel(client.rating)}
                            </span>
                        </div>
                    </div>
                    {canEdit && (
                        <button
                            type="button"
                            onClick={saveRating}
                            disabled={saving}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            حفظ التقييم
                        </button>
                    )}
                </div>

                {canEdit ? (
                    <div className="mt-5 space-y-4">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            {RATING_OPTIONS.map(option => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setSelectedRating(option.value)}
                                    className={`rounded-xl border px-4 py-3 text-sm font-black transition ${
                                        selectedRating === option.value
                                            ? `${option.className} ring-2 ring-sky-200`
                                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            rows={3}
                            placeholder="ملاحظة سبب تغيير التقييم"
                            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                        />
                    </div>
                ) : (
                    <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                        لا تملك صلاحية تعديل تقييم الالتزام.
                    </p>
                )}

                {error && (
                    <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                        {error}
                    </p>
                )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-4 text-base font-black text-slate-800">السجل التاريخي</h3>
                {loading ? (
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري تحميل السجل...
                    </div>
                ) : history.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">
                        لا يوجد سجل تقييمات بعد.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {history.map(item => (
                            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${ratingClass(item.oldRating)}`}>
                                            {ratingLabel(item.oldRating)}
                                        </span>
                                        <ChevronRight className="h-4 w-4 text-slate-300" />
                                        <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${ratingClass(item.newRating)}`}>
                                            {ratingLabel(item.newRating)}
                                        </span>
                                    </div>
                                    <div className="text-xs font-bold text-slate-500">
                                        {item.changedByName || 'مستخدم غير معروف'} - {formatCallDate(item.changedAt)}
                                    </div>
                                </div>
                                {item.notes && (
                                    <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{item.notes}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function ContactsTab({
    client,
    refreshKey,
    onCallSaved,
    onClientUpdate,
    onClientChanged,
    canViewCallLog,
    canCreateCallLog,
    canEditContacts,
    canEditCallLog,
    canEditContactControl,
}: {
    client: Client;
    refreshKey?: number;
    onCallSaved?: () => void;
    onClientUpdate?: (fields: Partial<Client>) => void;
    onClientChanged?: () => void | Promise<void>;
    canViewCallLog: boolean;
    canCreateCallLog: boolean;
    canEditContacts: boolean;
    canEditCallLog: boolean;
    canEditContactControl: boolean;
}) {
    const [callLogs, setCallLogs] = useState<any[]>([]);
    const [loadingCalls, setLoadingCalls] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalContact, setModalContact] = useState<{ id?: string; number?: string; label?: string } | null>(null);

    const fetchCalls = useCallback(async () => {
        if (!canViewCallLog) {
            setCallLogs([]);
            return;
        }
        setLoadingCalls(true);
        try {
            const logs = await api.customerCalls.list(client.id);
            setCallLogs(logs);
        } catch {
            setCallLogs([]);
        } finally {
            setLoadingCalls(false);
        }
    }, [client.id, canViewCallLog]);

    useEffect(() => { fetchCalls(); }, [fetchCalls]);

    return (
        <div className="space-y-6 max-w-5xl">
            {/* DEC-005 D29 + DEC-006 D32: contact-control surface (cooldown + do_not_contact) — moved here from Overview */}
            {canEditContactControl && onClientChanged && (
                <ContactControlCard client={client} onChange={() => { void onClientChanged(); }} />
            )}

            <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">جهات الاتصال الخاصة بالزبون</h3>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {(client.contacts || []).map((c, i) => {
                    // Logs for this specific contact number
                    const contactLogs = callLogs.filter(
                        (log) => log.contactNumber === c.number || log.contactId === c.id,
                    );
                    const recentLogs = contactLogs.slice(0, 3);

                    return (
                        <div key={c.id || i} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col xl:flex-row shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 group">

                            {/* === Left Side: Number Info === */}
                            <div className="p-8 bg-gradient-to-br from-slate-50 to-white border-b xl:border-b-0 xl:border-l border-slate-100 xl:w-[400px] flex flex-col justify-between relative overflow-hidden">
                                <div className="absolute -top-10 -right-10 w-40 h-40 bg-sky-400/10 rounded-full blur-3xl pointer-events-none group-hover:bg-sky-400/20 transition-all duration-500" />

                                <div className="relative">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border ${c.isPrimary ? 'bg-sky-500 border-sky-600 text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
                                            <Phone className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1 flex items-center justify-between">
                                            <span className="text-sm font-bold text-slate-700">{c.label || 'جهة اتصال'}</span>
                                            {c.isPrimary && (
                                                <span className="px-2.5 py-1 bg-sky-50 text-sky-600 rounded-lg text-xs font-black tracking-wide border border-sky-100">أساسي</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mb-6">
                                        <p className="text-2xl font-black text-slate-800 font-mono tracking-widest drop-shadow-sm" dir="ltr">
                                            {c.number}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        <span className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-xl font-bold shadow-sm">
                                            {c.type === 'mobile' ? 'موبايل' : 'هاتف أرضي'}
                                        </span>
                                        {c.hasWhatsApp && (
                                            <span className="flex items-center gap-1.5 text-xs bg-[#25D366]/10 border border-[#25D366]/20 text-[#128C7E] px-3 py-1.5 rounded-xl font-bold shadow-sm">
                                                <MessageCircle className="w-3.5 h-3.5" /> واتساب متوفر
                                            </span>
                                        )}
                                    <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-bold shadow-sm border ${
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
                                    {canViewCallLog && <PhoneCallLog
                                        customerId={client.id}
                                        contactId={c.id}
                                        contactLabel={c.label || 'جهة اتصال'}
                                        contactNumber={c.number}
                                        refreshKey={refreshKey}
                                        limit={2}
                                        onLogUpdated={onCallSaved}
                                        canEdit={canEditCallLog}
                                    />}
                                </div>

                                <button
                                    onClick={() => {
                                        setModalContact({ id: c.id, number: c.number, label: c.label || 'جهة اتصال' });
                                        if (!canCreateCallLog) return;
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
                            if (canEditContacts && phoneStatusUpdate && phoneStatusUpdate !== 'none' && modalContact?.id) {
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

// ── Visits/Tasks timeline helpers ──────────────────────────────────────────────

type TimelineItem = { kind: 'task' | 'visit'; ts: number; data: any };

const VISIT_STATUS_LABELS: Record<string, string> = {
    scheduled: 'مجدولة',
    in_progress: 'قيد التنفيذ',
    ended: 'منتهية ميدانياً',
    completed: 'مكتملة',
    not_completed: 'لم تكتمل',
    cancelled: 'ملغاة',
    postponed_by_company: 'مؤجلة (الشركة)',
    postponed_by_customer: 'مؤجلة (الزبون)',
    needs_reschedule: 'تحتاج إعادة جدولة',
};

const VISIT_STATUS_COLORS: Record<string, string> = {
    scheduled: 'bg-sky-50 text-sky-700 border-sky-200',
    in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ended: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    not_completed: 'bg-rose-50 text-rose-700 border-rose-200',
    cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

const TASK_TYPE_ICONS: Record<string, any> = {
    device_demo: Sparkles,
    device_purchase: FileText,
    device_delivery: Truck,
    device_installation: Wrench,
    device_activation: Cpu,
    device_disconnection: Wrench,
    device_retrieval: Package,
    device_return: Package,
    periodic_maintenance: Wrench,
    emergency_maintenance: Zap,
    installment_collection: DollarSign,
    maintenance_collection: DollarSign,
    gift_delivery: Gift,
    device_checkup: Activity,
    parts_sale: Package,
    golden_warranty: ShieldCheck,
    golden_warranty_offer: ShieldCheck,
    golden_warranty_card_delivery: ShieldCheck,
};

function taskTypeIcon(taskType?: string): any {
    return (taskType && TASK_TYPE_ICONS[taskType]) || FileText;
}

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function toTime(value?: string | null): number {
    if (!value) return 0;
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
}

function fmtDay(value?: string | null): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('ar-SY', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtTimeOnly(value?: string | null): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
}

function humanizeCode(code?: string | null): string | null {
    if (!code) return null;
    return code.replace(/_/g, ' ');
}

function taskDotClass(status: string): string {
    if (status === 'cancelled') return 'bg-rose-50 text-rose-600 border-rose-200';
    const phase = getTaskPhase(status as OpenTaskStatus);
    const map: Record<string, string> = {
        waiting: 'bg-slate-100 text-slate-600 border-slate-200',
        planning: 'bg-indigo-50 text-indigo-600 border-indigo-200',
        execution: 'bg-amber-50 text-amber-600 border-amber-200',
        closure: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    };
    return map[phase] || map.waiting;
}

function visitDotClass(status: string): string {
    return (VISIT_STATUS_COLORS[status] || 'bg-sky-50 text-sky-600 border-sky-200');
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${className || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {children}
        </span>
    );
}

function TaskNode({ task }: { task: any }) {
    const status = task.status as string;
    const phase = getTaskPhase(status as OpenTaskStatus);
    const typeLabel = OPEN_TASK_TYPE_LABELS[task.taskType] ?? task.taskType ?? 'مهمة';
    const statusLabel = OPEN_TASK_STATUS_LABELS[status as OpenTaskStatus] ?? status;
    const due = task.dueDate ?? task.due_date ?? null;
    const overdue = phase === 'waiting' && due && new Date(due) < startOfToday();
    const devices: any[] = task.devices ?? [];
    const preOffers: any[] = task.preOffers ?? task.preoffers ?? [];
    const attempts: number = task.attemptsCount ?? 0;
    const lastAttempt = task.lastAttempt ?? null;
    const activeVisit = task.activeVisit ?? null;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-black text-slate-800">{typeLabel}</span>
                    <span className="text-xs font-bold text-slate-400">مهمة #{task.id}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Chip className={OPEN_TASK_PHASE_COLORS[phase]}>{OPEN_TASK_PHASE_LABELS[phase]}</Chip>
                    <Chip className="bg-white text-slate-600 border-slate-200">{statusLabel}</Chip>
                    {overdue && <Chip className="bg-rose-50 text-rose-700 border-rose-200"><AlertCircle className="h-3 w-3" /> متأخرة</Chip>}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {fmtDay(task.createdAt) && <span>أُنشئت: {fmtDay(task.createdAt)}</span>}
                {fmtDay(due) && <span className={overdue ? 'font-bold text-rose-600' : ''}>التاريخ المطلوب: {fmtDay(due)}</span>}
            </div>

            {devices.length > 0 && (
                <div className="mt-3 text-sm text-slate-600">
                    <span className="font-bold text-slate-500">الأجهزة: </span>
                    {devices.map((d: any) => `${d.deviceName} × ${d.quantity}`).join('، ')}
                </div>
            )}

            {preOffers.length > 0 && (
                <div className="mt-1 text-sm text-slate-600">
                    <span className="font-bold text-slate-500">عروض مسبقة: </span>{preOffers.length}
                </div>
            )}

            {task.notes && <div className="mt-2 text-xs leading-relaxed text-slate-400">{task.notes}</div>}

            {(attempts > 0 || activeVisit || lastAttempt) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                    {attempts > 0 && (
                        <Chip className="bg-slate-50 text-slate-600 border-slate-200"><Layers className="h-3 w-3" /> {attempts} محاولة تنفيذ</Chip>
                    )}
                    {activeVisit && (
                        <Chip className="bg-indigo-50 text-indigo-700 border-indigo-200"><Navigation className="h-3 w-3" /> زيارة نشطة #{activeVisit.id}</Chip>
                    )}
                    {lastAttempt?.finalDecision && (
                        <Chip className="bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="h-3 w-3" /> آخر نتيجة: {humanizeCode(lastAttempt.finalDecision)}</Chip>
                    )}
                </div>
            )}
        </div>
    );
}

function VisitNode({ visit, navigate }: { visit: any; navigate: ReturnType<typeof useNavigate> }) {
    const status = visit.status as string;
    const statusLabel = VISIT_STATUS_LABELS[status] ?? status;
    const visitTypeLabel = visit.visitType === 'emergency' ? 'طوارئ' : 'تسويقية';
    const summary: any[] = visit.tasksSummary ?? [];
    const taskCount: number = visit.taskCount ?? 0;
    const documented: number = visit.documentedTaskCount ?? 0;
    const escalated: number[] = visit.escalationTiers ?? [];
    const teamName: string | null = visit.team?.teamName ?? null;
    const startT = fmtTimeOnly(visit.actualStartTime);
    const endT = fmtTimeOnly(visit.actualEndTime);

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-black text-slate-800">زيارة ميدانية</span>
                    <Chip className="bg-slate-50 text-slate-500 border-slate-200">{visitTypeLabel}</Chip>
                    <span className="text-xs font-bold text-slate-400">#{visit.id}</span>
                    {visit.originType === 'field_initiated' && (
                        <Chip className="bg-violet-50 text-violet-700 border-violet-200">فورية</Chip>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Chip className={visitDotClass(status)}>{statusLabel}</Chip>
                    <button
                        onClick={() => navigate(`/field-visits/${visit.id}`)}
                        className="text-xs font-bold text-sky-600 hover:text-sky-500 hover:underline"
                    >
                        عرض الزيارة
                    </button>
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                {fmtDay(visit.scheduledDate) && (
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5 text-slate-400" /> {fmtDay(visit.scheduledDate)}{visit.scheduledTime ? ` • ${visit.scheduledTime}` : ''}</span>
                )}
                {teamName && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5 text-slate-400" /> {teamName}</span>}
                {(startT || endT) && (
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-slate-400" /> {startT || '—'}{endT ? ` ← ${endT}` : ''}</span>
                )}
            </div>

            {summary.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {summary.map((t: any, i: number) => (
                        <Chip key={i} className="bg-slate-50 text-slate-600 border-slate-200">
                            {OPEN_TASK_TYPE_LABELS[t.taskType] ?? t.taskType}
                        </Chip>
                    ))}
                </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                {taskCount > 0 && (
                    <Chip className={documented >= taskCount ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>
                        {documented}/{taskCount} مهمة موثّقة
                    </Chip>
                )}
                <Chip className={visit.hasSurvey ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-slate-50 text-slate-400 border-slate-200'}>
                    {visit.hasSurvey ? (visit.surveySkipped ? 'استبيان (مُتخطّى)' : 'استبيان موجود') : 'بلا استبيان'}
                </Chip>
                {escalated.length > 0 && (
                    <Chip className="bg-rose-50 text-rose-700 border-rose-200"><AlertCircle className="h-3 w-3" /> تصعيد توثيق</Chip>
                )}
            </div>
        </div>
    );
}

function TimelineRow({ item, isLast, navigate }: { item: TimelineItem; isLast: boolean; navigate: ReturnType<typeof useNavigate> }) {
    const isTask = item.kind === 'task';
    const Icon = isTask ? taskTypeIcon(item.data.taskType) : Navigation;
    const dotClass = isTask ? taskDotClass(item.data.status) : visitDotClass(item.data.status);
    return (
        <li className="relative flex gap-3">
            <div className="flex flex-col items-center">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${dotClass}`}>
                    <Icon className="h-4 w-4" />
                </span>
                {!isLast && <span className="mt-1 w-px flex-1 bg-slate-200" />}
            </div>
            <div className="min-w-0 flex-1 pb-6">
                {isTask ? <TaskNode task={item.data} /> : <VisitNode visit={item.data} navigate={navigate} />}
            </div>
        </li>
    );
}

function SummaryStat({ label, value, icon: Icon, className }: { label: string; value: number | string; icon: any; className: string }) {
    return (
        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${className}`}>
            <Icon className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
                <p className="text-lg font-black leading-none">{value}</p>
                <p className="mt-1 text-xs font-bold opacity-70">{label}</p>
            </div>
        </div>
    );
}

export function VisitsTab({ client }: { client: Client }) {
    const navigate = useNavigate();
    const [visits, setVisits] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [contracts, setContracts] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
    const [serviceRequestModalOpen, setServiceRequestModalOpen] = useState(false);
    const serviceRequestsUiEnabled =
        typeof window !== 'undefined' &&
        localStorage.getItem('gc_service_requests_ui') === 'on';
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

    // Unified chronological record: open-task commitments + field visits, newest first.
    const timeline = useMemo<TimelineItem[]>(() => {
        const items: TimelineItem[] = [];
        for (const t of tasks) items.push({ kind: 'task', ts: toTime(t.createdAt), data: t });
        for (const v of visits) items.push({ kind: 'visit', ts: toTime(v.scheduledDate ?? v.actualStartTime ?? v.createdAt), data: v });
        items.sort((a, b) => b.ts - a.ts);
        return items;
    }, [tasks, visits]);

    const activeTaskCount = tasks.filter((t) => !['completed', 'closed', 'cancelled'].includes(t.status)).length;

    return (
        <div className="space-y-6 max-w-5xl">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-bold text-slate-800">سجل الزيارات والمهام</h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setEmergencyModalOpen(true)}
                        className="px-4 py-2 border border-rose-200 text-rose-600 font-bold rounded-xl hover:bg-rose-50 transition-all flex items-center gap-1.5 text-sm"
                    >
                        <Zap className="w-4 h-4" /> صيانة طارئة
                    </button>
                    {serviceRequestsUiEnabled && (
                        <button
                            onClick={() => setServiceRequestModalOpen(true)}
                            className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl shadow-sm hover:bg-emerald-500 transition-all flex items-center gap-1.5 text-sm"
                        >
                            <Zap className="w-4 h-4" /> طلب صيانة جديد
                        </button>
                    )}
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
            ) : timeline.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center flex flex-col items-center justify-center">
                    <Navigation className="w-10 h-10 text-slate-300 mb-4" />
                    <h4 className="text-lg text-slate-600 font-black mb-2">لا توجد مهام أو زيارات مسجلة</h4>
                    <p className="text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">اضغط "عرض جهاز" لإنشاء أول مهمة لهذا الزبون.</p>
                </div>
            ) : (
                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <SummaryStat label="مهام نشطة" value={activeTaskCount} icon={Layers} className="border-indigo-100 bg-indigo-50 text-indigo-700" />
                        <SummaryStat label="إجمالي المهام" value={tasks.length} icon={FileText} className="border-slate-200 bg-slate-50 text-slate-700" />
                        <SummaryStat label="الزيارات الميدانية" value={visits.length} icon={Navigation} className="border-sky-100 bg-sky-50 text-sky-700" />
                    </div>

                    <ol className="relative">
                        {timeline.map((item, i) => (
                            <TimelineRow
                                key={`${item.kind}-${item.data.id}`}
                                item={item}
                                isLast={i === timeline.length - 1}
                                navigate={navigate}
                            />
                        ))}
                    </ol>
                </div>
            )}

            {serviceRequestModalOpen && (
                <NewServiceRequestModal
                    channel="client_detail_button"
                    beneficiaryClientId={client.id}
                    beneficiaryClientName={client.name}
                    onClose={() => setServiceRequestModalOpen(false)}
                />
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
    if (ref.convertedToLeadId || ref.isCandidate === false || ref.isClient === true) {
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

function NetworkTab({ client }: { client: Client }) {
    const [network, setNetwork] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const fetchNetwork = async () => {
            try {
                setLoading(true);
                const data = await api.clients.getNetwork(client.id);
                if (active) setNetwork(data);
            } catch (e) {
                console.error('Failed to load network:', e);
            } finally {
                if (active) setLoading(false);
            }
        };
        fetchNetwork();
        return () => { active = false; };
    }, [client.id]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span className="font-bold">جاري تحميل بيانات الشبكة...</span>
            </div>
        );
    }

    const incoming = network?.incoming ?? [];
    const outgoing = network?.outgoing ?? [];

    return (
        <div className="space-y-10 max-w-5xl">

            {/* ══ القسم 1: وسطاء الزبون ══════════════════════════════════════════ */}
            <section>
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                        <Share2 className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-800">وسطاء الزبون</h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد الوسطاء: {incoming.length}</p>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    {incoming.length > 0 ? (
                        <>
                            <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-100 text-xs font-black text-slate-500">
                                <span className="col-span-1">#</span>
                                <span className="col-span-2">اسم الوسيط</span>
                                <span className="col-span-2">الاسم المقترح</span>
                                <span className="col-span-2">النوع</span>
                                <span className="col-span-2">العنوان</span>
                                <span className="col-span-2">تاريخ الإحالة</span>
                                <span className="col-span-1">رابط</span>
                            </div>
                            {incoming.map((ref: any, i: number) => (
                                <div key={i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-50 hover:bg-slate-50/50 items-center text-sm">
                                    <span className="col-span-1 font-mono text-xs text-slate-400">{i + 1}</span>
                                    <span className="col-span-2 font-bold text-slate-800">{ref.name}</span>
                                    <span className="col-span-2 font-bold text-slate-700">{ref.candidateName || '--'}</span>
                                    <span className="col-span-2">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${typeBadgeClass(ref.type)}`}>
                                            {referrerTypeLabel(ref.type)}
                                        </span>
                                    </span>
                                    <span className="col-span-2 text-slate-600">{ref.address || '--'}</span>
                                    <span className="col-span-2 font-mono text-xs text-slate-500">{ref.referralDate || '--'}</span>
                                    <span className="col-span-1">
                                        {ref.id ? (
                                            <Link to={`/clients/${ref.id}`} className="text-sky-600 font-bold hover:underline">
                                                عرض
                                            </Link>
                                        ) : (
                                            <span className="text-slate-400">--</span>
                                        )}
                                    </span>
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
                        <h3 className="text-base font-bold text-slate-800">الأسماء المقترحة</h3>
                        <p className="text-xs text-slate-400 font-medium mt-0.5">عدد الأسماء: {outgoing.length}</p>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    {outgoing.length > 0 ? (
                        <>
                            <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-50 border-b border-slate-100 text-xs font-black text-slate-500">
                                <span className="col-span-1">#</span>
                                <span className="col-span-3">الاسم</span>
                                <span className="col-span-2">الرقم</span>
                                <span className="col-span-2">العنوان</span>
                                <span className="col-span-2">الحالة</span>
                                <span className="col-span-2">رابط</span>
                            </div>
                            {outgoing.map((ref: any, i: number) => (
                                <div key={ref.id ?? i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-50 hover:bg-slate-50/50 items-center text-sm">
                                    <span className="col-span-1 font-mono text-xs text-slate-400">{i + 1}</span>
                                    <span className="col-span-3 font-bold text-slate-800">{ref.name}</span>
                                    <span className="col-span-2 font-mono text-slate-500" dir="ltr">{ref.mobile || '--'}</span>
                                    <span className="col-span-2 text-slate-600">{ref.address || '--'}</span>
                                    <span className="col-span-2">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${outgoingStatusBadge(ref).cls}`}>
                                            {outgoingStatusBadge(ref).label}
                                        </span>
                                    </span>
                                    <span className="col-span-2">
                                        {ref.id ? (
                                            <Link
                                                to={ref.isClient ? `/clients/${ref.id}` : `/candidates/${ref.id}`}
                                                className="text-sky-600 font-bold hover:underline"
                                            >
                                                عرض
                                            </Link>
                                        ) : (
                                            <span className="text-slate-400">--</span>
                                        )}
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
