import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FileText, ChevronDown, Search, Calendar, Monitor, Hash,
    DollarSign, CreditCard, Banknote, Truck, Trash2, Save,
    RotateCcw, CheckCircle2, User, Calculator, MapPin,
    AlertTriangle, ShieldCheck, ArrowRightLeft, Globe, Landmark,
    BadgeDollarSign, Plus, X, Edit2,
    ExternalLink, Smartphone, Clipboard, Loader2
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import MapPicker from '../../components/MapPicker';
import GeoSmartSearch, { buildPath as buildGeoPath, pathToSelection as geoPathToSelection } from '../../components/GeoSmartSearch';
import type { GeoSelection } from '../../components/GeoSmartSearch';
import type { GeoUnit } from '../../lib/types';
import type { ClientReferrer } from '@golden-crm/shared';
import Select from '../../components/ui/Select';

/* ------------------------------------------------------------------ */
/*  Customer type                                                       */
/* ------------------------------------------------------------------ */

interface MockCustomer {
    id: number;
    name: string;
    mobile: string;
    fatherName?: string;
    nationalId?: string;
    motherName?: string | null;
    birthDate?: string | null;
    gender?: 'male' | 'female' | null;
    nationalIdRegistry?: string | null;
    nationalIdIssuedBy?: string | null;
    nationalIdIssueDate?: string | null;
    nationalIdBox?: string | null;
    referrers?: ClientReferrer[];
}

/* ------------------------------------------------------------------ */
/*  Local form-only types (moved outside component for stable identity) */
/* ------------------------------------------------------------------ */

type SaleType = 'tradein' | 'retention' | 'direct';
type SaleSource = 'device_demo_task' | 'app' | 'social_media';
type OldDeviceCondition = 'good' | 'damaged';
type PaymentMethod = 'cash' | 'sham_cash' | 'syriatel_cash' | 'mtn_cash' | 'alharam' | 'bank_transfer' | 'barter';
type PaymentCategory = 'hand' | 'transfer' | 'barter';

interface PaymentEntryDraft {
    id?: number;
    paymentCategory: PaymentCategory;
    method: PaymentMethod;
    currency: 'SYP' | 'USD';
    amountValue: string;
    exchangeRate: string;
    referenceNumber: string;
    barterName: string;
    barterValueSyp: string;
    notes: string;
}

interface InstallmentDraft {
    id?: number;
    installmentNumber: number;
    dueDate: string;
    amountSyp: string;
}

interface LineItem {
    itemType: 'device' | 'accessory' | 'service_fee';
    sparePartId?: number | null;
    description: string;
    quantity: number;
    unitPrice: number;
}

/* ------------------------------------------------------------------ */
/*  Sale type config                                                    */
/* ------------------------------------------------------------------ */

const saleTypes: { value: SaleType; label: string; icon: any; desc: string; color: string; activeBg: string; activeBorder: string }[] = [
    { value: 'tradein',   label: 'استبدال',   icon: ArrowRightLeft, desc: 'تبديل جهاز قديم',   color: 'text-purple-600', activeBg: 'bg-purple-50', activeBorder: 'border-purple-300' },
    { value: 'retention', label: 'احتفاظ',    icon: ShieldCheck,    desc: 'شراء بدون استبدال', color: 'text-emerald-600', activeBg: 'bg-emerald-50', activeBorder: 'border-emerald-300' },
    { value: 'direct',    label: 'بيع مباشر', icon: Banknote,       desc: 'بيع مباشر للزبون', color: 'text-blue-600', activeBg: 'bg-blue-50', activeBorder: 'border-blue-300' },
];

const saleSources: { value: SaleSource; label: string; icon: any; desc: string; color: string; activeBg: string; activeBorder: string }[] = [
    { value: 'device_demo_task', label: 'مهمة عرض جهاز',     icon: Monitor,    desc: 'من نتيجة مهمة عرض', color: 'text-sky-600',    activeBg: 'bg-sky-50',    activeBorder: 'border-sky-300' },
    { value: 'app',              label: 'التطبيق',            icon: Smartphone, desc: 'طلب من التطبيق',     color: 'text-blue-600',   activeBg: 'bg-blue-50',   activeBorder: 'border-blue-300' },
    { value: 'social_media',     label: 'وسائل التواصل',     icon: Globe,      desc: 'من التواصل الاجتماعي', color: 'text-violet-600', activeBg: 'bg-violet-50', activeBorder: 'border-violet-300' },
];

/* ------------------------------------------------------------------ */
/*  Collapsible Section                                                 */
/* ------------------------------------------------------------------ */

function Section({ title, icon: Icon, children, defaultOpen = true, badge, status }: {
    title: string;
    icon: any;
    children: React.ReactNode;
    defaultOpen?: boolean;
    badge?: React.ReactNode;
    status?: 'valid' | 'warning' | 'error';
}) {
    const [open, setOpen] = useState(defaultOpen);
    // overflow-hidden is only needed while the collapse height animation
    // is running. After it finishes we drop it so descendants like the
    // customer/device search dropdowns can render above the next section.
    const [isAnimating, setIsAnimating] = useState(false);
    const statusColors = {
        valid: 'border-emerald-200 bg-emerald-50',
        warning: 'border-amber-200 bg-amber-50',
        error: 'border-red-200 bg-red-50',
    };
    const iconStatusColors = {
        valid: 'bg-emerald-50 border-emerald-200',
        warning: 'bg-amber-50 border-amber-200',
        error: 'bg-red-50 border-red-200',
    };
    const iconTextColors = {
        valid: 'text-emerald-600',
        warning: 'text-amber-600',
        error: 'text-red-600',
    };

    return (
        <div className={`bg-white rounded-xl border shadow-sm ${status ? statusColors[status] : 'border-slate-200'}`}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 px-5 py-4 text-right hover:bg-slate-50/50 transition-colors"
            >
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${status ? iconStatusColors[status] : 'bg-sky-50 border-sky-200'}`}>
                    <Icon className={`w-4 h-4 ${status ? iconTextColors[status] : 'text-sky-600'}`} />
                </div>
                <span className="flex-1 text-sm font-bold text-slate-800">{title}</span>
                {badge}
                <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                </motion.div>
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onAnimationStart={() => setIsAnimating(true)}
                        onAnimationComplete={() => setIsAnimating(false)}
                        className={isAnimating ? 'overflow-hidden' : 'overflow-visible'}
                    >
                        <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Field helper                                                        */
/* ------------------------------------------------------------------ */

function Field({ label, children, hint, required }: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                {label}
                {required && <span className="text-red-400">*</span>}
            </label>
            {children}
            {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
    );
}

const inputClass = "w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 focus:outline-none transition-all";
const selectClass = "w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 focus:outline-none transition-all appearance-none cursor-pointer";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

// Arabic label for a referrer type. Case-insensitive — stored values may be
// capitalized ("Client") or lowercase ("client").
function referrerTypeLabel(type?: string | null): string {
    switch (String(type || '').toLowerCase()) {
        case 'client':
        case 'customer': return 'زبون';
        case 'employee': return 'موظف';
        case 'personal': return 'شخصي';
        case 'unknown':  return 'غير معروف';
        default: return type || '—';
    }
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function ContractForm() {
    const navigate = useNavigate();
    const { id: editId } = useParams<{ id: string }>();
    const isEdit = Boolean(editId);
    const currentUser = useAuthStore(s => s.user);
    const hasPermission = useAuthStore(s => s.hasPermission);
    const getPermissionScope = useAuthStore(s => s.getPermissionScope);
    const contextBranchId = useBranchContextStore(s => s.branchId);
    // A GLOBAL creator must pick a branch context first; otherwise the server
    // silently creates the contract in their home branch. Mirrors the list-page
    // guard and the super-admin server rule (covers direct-link entry too).
    const mustPickBranch = !isEdit
        && getPermissionScope('contracts.create') === 'GLOBAL'
        && contextBranchId == null;
    // ─── API Data ───
    const [customers, setCustomers] = useState<MockCustomer[]>([]);
    const [deviceModels, setDeviceModels] = useState<any[]>([]);
    // Installation options are scoped to the operational branch (the branch the
    // contract is created under). The server resolves that branch from the
    // session / X-Branch-Id, and api.geoUnits.list() is filtered accordingly —
    // see geoUnits route + geoScopeService. The field does NOT depend on the
    // selected customer's branch.
    const [geoUnits, setGeoUnits] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [step, setStep] = useState<'type_selection' | 'details'>(isEdit ? 'details' : 'type_selection');
    const contractType = 'sale_contract' as const;
    const [saleSubtype, setSaleSubtype] = useState<'definitive' | 'temporary' | 'free'>('definitive');
    const [closers, setClosers] = useState<any[]>([]);
    const [noClosingReasons, setNoClosingReasons] = useState<any[]>([]);
    const [noClosingReasonId, setNoClosingReasonId] = useState<number | ''>('');
    const [customSaleSources, setCustomSaleSources] = useState<any[]>([]);

    // ─── Tracing & Offer Wizard States ───
    const [loadingTasks, setLoadingTasks] = useState(false);
    const [clientTasks, setClientTasks] = useState<any[]>([]);
    const [detailedVisits, setDetailedVisits] = useState<any[]>([]);
    const [selectedTask, setSelectedTask] = useState<any | null>(null);
    const [selectedOffer, setSelectedOffer] = useState<any | null>(null);
    // Derived — always false to allow full editing/additional parts per user request
    const isOfferLocked = false;

    const [sourceOpenTaskId, setSourceOpenTaskId] = useState<number | null>(null);
    const [sourceTaskOfferId, setSourceTaskOfferId] = useState<number | null>(null);
    const [saleReferenceNumber, setSaleReferenceNumber] = useState<string | null>(null);
    const [selectedOfferVisitId, setSelectedOfferVisitId] = useState<string | null>(null);
    const [selectedOfferTaskId, setSelectedOfferTaskId] = useState<string | null>(null);

    useEffect(() => {
        setCanAssignSaleOwner(hasPermission('contracts.assign_sale_owner'));
        const baseRequests: Promise<any>[] = [
            api.clients.list(),
            api.deviceModels.list(),
            api.geoUnits.list(),
            api.spareParts.list(),
            // Optional lookups: a 403 here (e.g. a supervisor without the sale-
            // owner permission) must NOT abort the whole form load — otherwise
            // the customer/device/geo data never loads and the form looks empty.
            api.employees.closers().catch(() => []),
            api.systemLists.list({ category: 'no_closing_reasons' }).catch(() => []),
            api.systemLists.list({ category: 'contract_sale_source' }).catch(() => []),
            api.employees.list().catch(() => []),
        ];
        if (isEdit && editId) baseRequests.push(api.contracts.get(Number(editId)));

        Promise.all(baseRequests)
            .then(([clientsData, modelsData, geoData, partsData, closersData, reasonsData, sourcesData, employeesData, existingContract]) => {
                setBranchEmployees(Array.isArray(employeesData) ? employeesData : []);
                const mappedCustomers = clientsData.map((c: any) => ({
                    id: c.id,
                    name: c.name,
                    mobile: c.mobile || c.phone || '',
                    fatherName: c.fatherName,
                    nationalId: c.nationalId,
                    motherName: c.motherName,
                    birthDate: c.birthDate,
                    gender: c.gender,
                    nationalIdRegistry: c.nationalIdRegistry,
                    nationalIdIssuedBy: c.nationalIdIssuedBy,
                    nationalIdIssueDate: c.nationalIdIssueDate,
                    nationalIdBox: c.nationalIdBox,
                    referrers: Array.isArray(c.referrers) ? c.referrers : [],
                }));
                setCustomers(mappedCustomers);
                setDeviceModels(modelsData);
                setGeoUnits(geoData);
                setSpareParts(partsData);
                setClosers(closersData);
                setNoClosingReasons(reasonsData);
                setCustomSaleSources(sourcesData);

                if (existingContract) {
                    const c = existingContract;
                    if (c.contractType === 'maintenance_contract') {
                        throw new Error('تم نقل عقود الصيانة إلى اتفاقيات الخدمة، ولم تعد تعدل من شاشة العقود.');
                    }
                    if (c.status !== 'draft') {
                        setLoadError('لا يمكن تعديل عقد بعد اعتماده.');
                        return;
                    }
                    setSaleSubtype(c.saleSubtype || 'definitive');
                    setSaleType(c.saleType || 'direct');
                    setContractDate(c.contractDate?.slice(0, 10) || new Date().toISOString().slice(0, 10));
                    setDeliveryDate(c.deliveryDate?.slice(0, 10) || '');
                    setInstallationDate(c.installationDate?.slice(0, 10) || '');
                    setSaleSource(c.saleSource || '');
                    setSourceTaskId(c.sourceVisit || '');
                    setDeviceModelId(c.deviceModelId || '');
                    setSerialNumber(c.serialNumber || '');
                    setDetailedAddress(c.detailedAddress || c.installationAddressText || '');
                    const restoredMapPosition = c.mapPosition
                        || (c.installationLat != null && c.installationLng != null
                            ? [Number(c.installationLat), Number(c.installationLng)] as [number, number]
                            : null);
                    setMapPosition(restoredMapPosition);
                    setShowMapPicker(Boolean(restoredMapPosition));
                    setClosingEmployeeId(c.closingEmployeeId || '');
                    setInvoiceNotes(c.invoiceNotes || '');
                    setNoClosingReasonId(c.noClosingReasonId || '');
                    setSourceOpenTaskId(c.sourceOpenTaskId || null);
                    setSourceTaskOfferId(c.sourceTaskOfferId || null);
                    setSaleReferenceNumber(c.saleReferenceNumber || null);
                    const clientSnapshot = c.client || {};
                    setFatherNameOverride(c.fatherName || clientSnapshot.fatherName || '');
                    setNationalIdOverride(c.nationalId || clientSnapshot.nationalId || '');
                    setBuyerBirthDate((c.buyerBirthDate || clientSnapshot.birthDate)?.slice(0, 10) || '');
                    setBuyerGender(c.buyerGender || clientSnapshot.gender || '');
                    setBuyerMotherName(c.buyerMotherName || clientSnapshot.motherName || '');
                    setBuyerNationalIdRegistry(c.buyerNationalIdRegistry || clientSnapshot.nationalIdRegistry || '');
                    setBuyerNationalIdIssuedBy(c.buyerNationalIdIssuedBy || clientSnapshot.nationalIdIssuedBy || '');
                    setBuyerNationalIdIssueDate((c.buyerNationalIdIssueDate || clientSnapshot.nationalIdIssueDate)?.slice(0, 10) || '');
                    setBuyerNationalIdBox(c.buyerNationalIdBox || clientSnapshot.nationalIdBox || '');

                    // Plan §2.1 — reconstruct full geo selection from the single
                    // installationGeoUnitId returned by the API. The contract API
                    // does not return the full geo hierarchy, so we walk up the
                    // tree locally using the geoUnits already loaded.
                    const leafGeoId = Number(c.installationGeoUnitId || 0);
                    if (leafGeoId > 0) {
                        const unitsMap = new Map<number, GeoUnit>();
                        (geoData as GeoUnit[]).forEach(u => unitsMap.set(u.id, u));
                        const leaf = unitsMap.get(leafGeoId);
                        if (leaf) {
                            const path = buildGeoPath(leaf, unitsMap);
                            setGeoSelection(geoPathToSelection(path));
                        } else {
                            setGeoSelection({ govId: '', regionId: '', subId: '', neighborhoodId: String(leafGeoId) });
                        }
                    }

                    if (c.customerId) {
                        const contractReferrers = Array.isArray(c.contractReferrers) ? c.contractReferrers : [];
                        const clientReferrers = Array.isArray(clientSnapshot.referrers) ? clientSnapshot.referrers : [];
                        const match = mappedCustomers.find((m: any) => m.id === c.customerId);
                        const restoredCustomer = match
                            ? {
                                ...match,
                                referrers: match.referrers?.length
                                    ? match.referrers
                                    : (clientReferrers.length ? clientReferrers : contractReferrers),
                            }
                            : {
                                id: c.customerId,
                                name: c.customerName || clientSnapshot.name || '',
                                mobile: clientSnapshot.mobile || '',
                                fatherName: clientSnapshot.fatherName,
                                nationalId: clientSnapshot.nationalId,
                                motherName: clientSnapshot.motherName,
                                birthDate: clientSnapshot.birthDate,
                                gender: clientSnapshot.gender,
                                nationalIdRegistry: clientSnapshot.nationalIdRegistry,
                                nationalIdIssuedBy: clientSnapshot.nationalIdIssuedBy,
                                nationalIdIssueDate: clientSnapshot.nationalIdIssueDate,
                                nationalIdBox: clientSnapshot.nationalIdBox,
                                referrers: clientReferrers.length ? clientReferrers : contractReferrers,
                            };
                        setSelectedCustomer(restoredCustomer);
                        // Single-mediator rule: keep only the first on restore (legacy
                        // contracts may carry more than one).
                        setSelectedReferrerIds(contractReferrers.slice(0, 1).map((referrer: any) => String(referrer.id)));
                    }

                    // Plan §2.2 — discount: API returns discountId / appliedDeviceDiscountId,
                    // not selectedDiscountId. Read the correct field.
                    const restoredDiscountId = c.appliedDeviceDiscountId ?? c.discountId ?? null;
                    if (restoredDiscountId) setSelectedDiscountId(Number(restoredDiscountId));

                    // Signature the device line-item sync effect waits for before
                    // arming, so it preserves the restored items on initial load.
                    restoredLineItemSigRef.current = `${c.deviceModelId || ''}|${restoredDiscountId ? Number(restoredDiscountId) : ''}`;

                    // Plan §2.3 — warranty months/visits. The device-change effect
                    // (zeroing logic below) is now opt-out on initial load so this
                    // value survives.
                    if (c.warrantyMonths) setWarrantyMonths(Number(c.warrantyMonths) || 0);
                    if (c.warrantyVisits) setWarrantyVisits(Number(c.warrantyVisits) || 0);

                    // Plan §4 — sale owner (the deal originator).
                    if (c.saleOwnerId) setSaleOwnerId(Number(c.saleOwnerId));

                    if (Array.isArray(c.lineItems)) setLineItems(c.lineItems.map((li: any) => ({
                        itemType: li.itemType,
                        description: li.description,
                        quantity: li.quantity,
                        unitPrice: li.unitPrice,
                        sparePartId: li.sparePartId || undefined,
                    })));
                    if (c.paymentType) setPaymentType(c.paymentType);
                    if (Array.isArray(c.paymentEntries) && c.paymentEntries.length > 0) {
                        const entries: PaymentEntryDraft[] = c.paymentEntries.map((e: any, idx: number) => ({
                            id: idx,
                            paymentCategory: (['transfer', 'barter'].includes(e.method) ? e.method : 'hand') as PaymentCategory,
                            method: e.method,
                            currency: e.currency || 'SYP',
                            amountValue: String(e.amountValue || 0),
                            exchangeRate: String(e.exchangeRate || ''),
                            referenceNumber: e.referenceNumber || '',
                            barterName: e.barterName || '',
                            barterValueSyp: String(e.barterValueSyp || ''),
                            notes: e.notes || '',
                        }));
                        setPaymentEntries(entries);
                        setConfirmedEntries(new Set(entries.map((_, i) => i)));
                        setHasDownPayment(true);
                    }

                    // Plan §2.4 — installment drafts. The schedule and its confirmed
                    // state must be restored or the user can never re-save a TPL contract.
                    if (Array.isArray(c.installments) && c.installments.length > 0) {
                        const restoredConfirmed = c.installments.some((i: any) => i.confirmed);
                        setInstallmentDrafts(c.installments.map((inst: any) => ({
                            id: inst.id,
                            installmentNumber: inst.installmentNumber,
                            dueDate: inst.dueDate?.slice(0, 10) || '',
                            amountSyp: String(inst.amountSyp || 0),
                        })));
                        setInstallmentsConfirmed(restoredConfirmed);
                        setPersistedInstallmentsConfirmed(restoredConfirmed);
                        setInstallmentCount(String(c.installments.length));
                    }
                }
            })
            .catch(err => console.error('Failed to load form data:', err))
            .finally(() => setLoading(false));
    }, [isEdit, editId]);

    // ─── 1. Customer & Legal ───
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<MockCustomer | null>(null);
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [selectedReferrerIds, setSelectedReferrerIds] = useState<string[]>([]);
    const [fatherNameOverride, setFatherNameOverride] = useState('');
    const [nationalIdOverride, setNationalIdOverride] = useState('');
    const [buyerBirthDate, setBuyerBirthDate] = useState('');
    const [buyerGender, setBuyerGender] = useState<'male' | 'female' | ''>('');
    const [buyerMotherName, setBuyerMotherName] = useState('');
    const [buyerNationalIdRegistry, setBuyerNationalIdRegistry] = useState('');
    const [buyerNationalIdIssuedBy, setBuyerNationalIdIssuedBy] = useState('');
    const [buyerNationalIdIssueDate, setBuyerNationalIdIssueDate] = useState('');
    const [buyerNationalIdBox, setBuyerNationalIdBox] = useState('');

    // ─── 2. Sale Details ───
    const [saleType, setSaleType] = useState<SaleType>('direct');
    const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0, 10));
    const [deliveryDate, setDeliveryDate] = useState('');
    const [installationDate, setInstallationDate] = useState('');
    const [warrantyMonths, setWarrantyMonths] = useState(0);
    const [warrantyVisits, setWarrantyVisits] = useState(0);
    // Trade-in context
    const [oldContractNumber, setOldContractNumber] = useState('');
    const [oldDeviceCondition, setOldDeviceCondition] = useState<OldDeviceCondition>('good');
    // Sale source
    const [saleSource, setSaleSource] = useState<SaleSource | ''>('');
    const [sourceTaskId, setSourceTaskId] = useState('');

    // ─── 3. Device & Location ───
    const [deviceModelId, setDeviceModelId] = useState<number | ''>('');
    const [serialNumber, setSerialNumber] = useState('');
    // Geo — single smart search
    const [geoSelection, setGeoSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
    const [detailedAddress, setDetailedAddress] = useState('');
    const [mapPosition, setMapPosition] = useState<[number, number] | null>(null);
    const [showMapPicker, setShowMapPicker] = useState(false);

    // ─── 4. Financials ───
    const [paymentType, setPaymentType] = useState<'cash' | 'installment'>('cash');
    const [paymentEntries, setPaymentEntries] = useState<PaymentEntryDraft[]>([]);
    const [confirmedEntries, setConfirmedEntries] = useState<Set<number>>(new Set());
    const [entryErrors, setEntryErrors] = useState<Record<number, string[]>>({});
    const [hasDownPayment, setHasDownPayment] = useState(false);
    const [installmentDrafts, setInstallmentDrafts] = useState<InstallmentDraft[]>([]);
    const [installmentsConfirmed, setInstallmentsConfirmed] = useState(false);
    const [persistedInstallmentsConfirmed, setPersistedInstallmentsConfirmed] = useState(false);
    const [installmentCount, setInstallmentCount] = useState('6');
    const [closingEmployeeId, setClosingEmployeeId] = useState<number | ''>('');
    const [invoiceNotes, setInvoiceNotes] = useState('');

    // Plan 2026-06-10 §4 — sale_owner_id is the deal originator and may differ
    // from the data-entry user. Defaults to the latest device-demo team leader
    // for the client when one exists; otherwise stays empty (= data-entry user
    // on save). Editable while draft and frozen at approval time.
    const [saleOwnerId, setSaleOwnerId] = useState<number | ''>('');
    const [branchEmployees, setBranchEmployees] = useState<any[]>([]);
    const [canAssignSaleOwner, setCanAssignSaleOwner] = useState(false);

    // ─── 5. Discounts & Line Items ───
    const [spareParts, setSpareParts] = useState<any[]>([]);
    const [deviceDiscounts, setDeviceDiscounts] = useState<any[]>([]);
    const [selectedDiscountId, setSelectedDiscountId] = useState<number | ''>('');
    const [lineItems, setLineItems] = useState<LineItem[]>([]);
    const [addingAccessoryCategory, setAddingAccessoryCategory] = useState<string>('');

    // ─── Computed ───
    const selectedDevice = useMemo(() => deviceModels.find(d => d.id === deviceModelId) || null, [deviceModelId, deviceModels]);
    const basePrice = selectedDevice?.basePrice || 0;

    // ─── Effect: fetch active discounts when device changes ───
    useEffect(() => {
        if (!deviceModelId) {
            setDeviceDiscounts([]);
            setSelectedDiscountId('');
            return;
        }
        api.deviceModels.getDiscounts(Number(deviceModelId))
            .then(setDeviceDiscounts)
            .catch(() => setDeviceDiscounts([]));
    }, [deviceModelId]);

    // ─── Effect: reset warranty selection when device changes ───
    // Plan §2.3 — On edit mode initial load, the device id is set from the saved
    // contract and we must NOT zero the warranty values we just restored. Only
    // genuine user-driven device changes (subsequent transitions) should reset.
    const prevDeviceModelIdRef = useRef<number | '' | null>(null);
    useEffect(() => {
        if (prevDeviceModelIdRef.current === null) {
            prevDeviceModelIdRef.current = deviceModelId;
            return;
        }
        if (prevDeviceModelIdRef.current !== deviceModelId) {
            setWarrantyMonths(0);
            setWarrantyVisits(0);
            prevDeviceModelIdRef.current = deviceModelId;
        }
    }, [deviceModelId]);

    // ─── Effect: auto-update device line item ───
    // Edit mode hazard: the line items were restored from the saved contract.
    // This sync effect must NOT wipe/rebuild them on initial load — the saved
    // device model may not even be inside the current user's scoped lookup
    // (selectedDevice === null), which would clear the items and zero the total.
    // So we suppress the effect until the restored (device|discount) signature
    // has settled, then arm it to respond normally to genuine user changes.
    const lineItemSyncArmedRef = useRef<boolean>(!isEdit);
    const restoredLineItemSigRef = useRef<string | null>(isEdit ? null : '');
    useEffect(() => {
        if (isOfferLocked) return;
        if (!lineItemSyncArmedRef.current) {
            // Restore hasn't applied yet — leave line items untouched.
            if (restoredLineItemSigRef.current === null) return;
            const currentSig = `${deviceModelId}|${selectedDiscountId}`;
            // Restored values are now in effect → arm without rebuilding (preserve
            // the saved items). If they already differ, the user changed something
            // first, so arm and fall through to sync.
            lineItemSyncArmedRef.current = true;
            if (currentSig === restoredLineItemSigRef.current) return;
        }
        if (saleSubtype === 'free') {
            // Free-sale / gift contracts keep the selected device informational only.
            // Do not add it to financial line items.
            setLineItems(prev => prev.filter((i: LineItem) => i.itemType !== 'device'));
            return;
        }
        if (!selectedDevice) {
            setLineItems([]);
            return;
        }
        
        let devicePrice = 0;
        if (selectedOffer && deviceModelId === selectedOffer.deviceModelId && String(selectedDiscountId) === String(selectedOffer.appliedDeviceDiscountId || '')) {
            devicePrice = Number(selectedOffer.totalAmount) || 0;
        } else {
            const disc = deviceDiscounts.find(d => d.id === Number(selectedDiscountId));
            devicePrice = disc
                ? Math.round(selectedDevice.basePrice * (1 - disc.percentage / 100))
                : selectedDevice.basePrice;
        }

        setLineItems(prev => {
            const nonDevice = prev.filter((i: LineItem) => i.itemType !== 'device');
            return [{ itemType: 'device' as const, description: selectedDevice.nameAr || selectedDevice.name, quantity: 1, unitPrice: devicePrice }, ...nonDevice];
        });
    }, [selectedDevice, selectedDiscountId, deviceDiscounts, isOfferLocked, saleSubtype, selectedOffer, deviceModelId]);

    // ─── Effect: auto-populate legal fields from selected customer ───
    // Plan §2 — In edit mode the buyer info was frozen on the contract and
    // restored above; do NOT overwrite it with the current client profile,
    // which may have diverged. Only run the auto-populate when the user
    // picks a customer manually (after the initial restore window closes).
    const customerAutoPopulateLockedRef = useRef<boolean>(isEdit);
    useEffect(() => {
        if (!selectedCustomer) return;
        if (customerAutoPopulateLockedRef.current) {
            // First selection in edit mode is the restored client — unlock so any
            // subsequent (rare) customer change still auto-populates as before.
            customerAutoPopulateLockedRef.current = false;
            return;
        }
        setBuyerBirthDate(selectedCustomer.birthDate?.slice(0, 10) || '');
        setBuyerGender(selectedCustomer.gender || '');
        setBuyerMotherName(selectedCustomer.motherName || '');
        setBuyerNationalIdRegistry(selectedCustomer.nationalIdRegistry || '');
        setBuyerNationalIdIssuedBy(selectedCustomer.nationalIdIssuedBy || '');
        setBuyerNationalIdIssueDate(selectedCustomer.nationalIdIssueDate?.slice(0, 10) || '');
        setBuyerNationalIdBox(selectedCustomer.nationalIdBox || '');
        setFatherNameOverride(selectedCustomer.fatherName || '');
        setNationalIdOverride(selectedCustomer.nationalId || '');
        setSelectedReferrerIds([]);
    }, [selectedCustomer, isEdit]);

    const getTaskSourceOpenTaskId = (task: any) =>
        task?.sourceOpenTaskId ?? task?.source_open_task_id ?? task?.source_open_taskId ?? null;

    const getTaskOffers = (task: any) => {
        if (!task) return [];
        if (Array.isArray(task.offers) && task.offers.length > 0) return task.offers;
        if (Array.isArray(task.preOffers) && task.preOffers.length > 0) return task.preOffers;
        if (Array.isArray(task.pre_offers) && task.pre_offers.length > 0) return task.pre_offers;
        return [];
    };

    const getOffersForVisit = (v: any, taskIdentifier?: string | number) => {
        if (!v) return [];
        
        // If taskIdentifier is provided, search in v.tasks first
        if (taskIdentifier && Array.isArray(v.tasks)) {
            const match = v.tasks.find((t: any) => 
                String(t.id) === String(taskIdentifier) || 
                String(getTaskSourceOpenTaskId(t)) === String(taskIdentifier)
            );
            const matchOffers = getTaskOffers(match);
            if (matchOffers.length > 0) {
                return matchOffers;
            }
        }
        
        let offers = getTaskOffers(v.task);
        if (offers.length === 0 && Array.isArray(v.tasks)) {
            const matchingTask = v.tasks.find((t: any) => String(t.id) === String(v.task?.id));
            offers = getTaskOffers(matchingTask);
        }
        
        // Final fallback: if offers still empty, check if any task in v.tasks has offers
        if (offers.length === 0 && Array.isArray(v.tasks)) {
            for (const t of v.tasks) {
                const taskOffers = getTaskOffers(t);
                if (taskOffers.length > 0) {
                    offers = taskOffers;
                    break;
                }
            }
        }
        return offers;
    };

    const isAcceptedUnlinkedOffer = (offer: any) =>
        offer?.customerResponse === 'accepted' && offer?.contractId == null;

    useEffect(() => {
        if (!selectedCustomer) {
            setClientTasks([]);
            setDetailedVisits([]);
            setSelectedTask(null);
            setSelectedOffer(null);
            setSourceOpenTaskId(null);
            setSourceTaskOfferId(null);
            setSaleReferenceNumber(null);
            setSelectedOfferVisitId(null);
            setSelectedOfferTaskId(null);
            return;
        }
        setLoadingTasks(true);
        // Load device_demo tasks for this client, then fetch detail only for
        // visits linked to those tasks (via marketingVisitId) — avoids N+1 over all visits.
        api.openTasks.listByClient(selectedCustomer.id)
            .then(async (tasksData: any[]) => {
                const demoTasks = tasksData.filter((t: any) => t.taskType === 'device_demo');
                const detailedTasks = await Promise.all(
                    demoTasks.map((task: any) => api.openTasks.get(Number(task.id)).catch(() => task))
                );
                setDetailedVisits([]);

                const filteredTasks = detailedTasks.filter((task: any) =>
                    getTaskOffers(task).some(isAcceptedUnlinkedOffer)
                );
                setClientTasks(filteredTasks);

                // Plan 2026-06-10 §4 — auto-fill sale_owner_id with the latest
                // device-demo team supervisor (مسؤول الفريق) regardless of saleSource.
                // Only apply when the field is still empty (create mode) so we
                // never clobber a restored value or an explicit user pick.
                if (!isEdit) {
                    const tasksWithTeam = detailedTasks
                        .filter((t: any) => t?.teamSnapshot?.supervisor?.id)
                        .sort((a: any, b: any) => {
                            const da = new Date(a.completedAt || a.updatedAt || a.createdAt || 0).getTime();
                            const db = new Date(b.completedAt || b.updatedAt || b.createdAt || 0).getTime();
                            return db - da;
                        });
                    const leaderId = tasksWithTeam[0]?.teamSnapshot?.supervisor?.id;
                    if (leaderId) {
                        setSaleOwnerId(prev => prev === '' ? Number(leaderId) : prev);
                    }
                }
            })
            .catch((err: any) => console.error('Failed to load client tasks & visits:', err))
            .finally(() => setLoadingTasks(false));
    }, [selectedCustomer]);

    const availableOffers = useMemo(() => {
        if (!selectedTask) return [];
        const taskOffers = getTaskOffers(selectedTask);
        if (taskOffers.length > 0) return taskOffers.filter(isAcceptedUnlinkedOffer);

        const matchingVisit = detailedVisits.find((v: any) => 
            (v.tasks || []).some((t: any) => String(getTaskSourceOpenTaskId(t)) === String(selectedTask.id)) ||
            String(getTaskSourceOpenTaskId(v.task)) === String(selectedTask.id)
        );
        if (!matchingVisit) return [];
        const offers = getOffersForVisit(matchingVisit, selectedTask.id);
        return offers.filter(isAcceptedUnlinkedOffer);
    }, [selectedTask, detailedVisits]);

    const handleSelectOffer = useCallback((offer: any) => {
        if (!offer) return;
        setSelectedOffer(offer);
        setDeviceModelId(offer.deviceModelId);
        setSelectedDiscountId(offer.appliedDeviceDiscountId || '');
        setPaymentType(offer.offerType);
        
        // Find matching task and visit for linkage
        const matchingVisit = detailedVisits.find((v: any) => 
            (v.tasks || []).some((t: any) => String(getTaskSourceOpenTaskId(t)) === String(selectedTask?.id)) ||
            String(getTaskSourceOpenTaskId(v.task)) === String(selectedTask?.id)
        );
        if (matchingVisit) {
            setSelectedOfferVisitId(String(matchingVisit.id));
            const matchingTask = (matchingVisit.tasks || []).find((t: any) => String(getTaskSourceOpenTaskId(t)) === String(selectedTask?.id)) || matchingVisit.task;
            setSelectedOfferTaskId(String(matchingTask?.id));
        } else if (selectedTask?.lastAttemptDetail?.visitId && selectedTask?.lastAttemptDetail?.visitTaskId) {
            setSelectedOfferVisitId(String(selectedTask.lastAttemptDetail.visitId));
            setSelectedOfferTaskId(String(selectedTask.lastAttemptDetail.visitTaskId));
        }
        setSourceOpenTaskId(selectedTask?.id || null);
        setSourceTaskOfferId(offer.id || null);
        setSaleReferenceNumber(offer.saleReferenceNumber || null);

        // Autofill line item price to offer's totalAmount
        const offerPrice = Number(offer.totalAmount) || 0;
        
        setLineItems(prev => {
            const nonDevice = prev.filter((i: LineItem) => i.itemType !== 'device');
            const dev = deviceModels.find(d => d.id === offer.deviceModelId);
            return [{
                itemType: 'device' as const,
                description: dev ? (dev.nameAr || dev.name) : 'الجهاز المعروض',
                quantity: 1,
                unitPrice: offerPrice
            }, ...nonDevice];
        });

        // Autofill payments/installments:
        if (offer.offerType === 'cash') {
            setPaymentEntries([
                {
                    paymentCategory: 'hand',
                    method: 'cash',
                    currency: 'SYP',
                    amountValue: String(offerPrice),
                    exchangeRate: '',
                    referenceNumber: '',
                    barterName: '',
                    barterValueSyp: '',
                    notes: 'دفع نقدي تلقائي من العرض المقبول',
                }
            ]);
            setConfirmedEntries(new Set([0]));
            setInstallmentDrafts([]);
            setInstallmentsConfirmed(false);
            setPersistedInstallmentsConfirmed(false);
        } else if (offer.offerType === 'installment') {
            const downPayment = Number(offer.firstPaymentAmount) || 0;
            if (downPayment > 0) {
                setHasDownPayment(true);
                setPaymentEntries([
                    {
                        paymentCategory: 'hand',
                        method: 'cash',
                        currency: 'SYP',
                        amountValue: String(downPayment),
                        exchangeRate: '',
                        referenceNumber: '',
                        barterName: '',
                        barterValueSyp: '',
                        notes: 'دفعة أولى تلقائية من العرض المقبول',
                    }
                ]);
                setConfirmedEntries(new Set([0]));
            } else {
                setHasDownPayment(false);
                setPaymentEntries([]);
                setConfirmedEntries(new Set());
            }

            const months = String(offer.installmentMonths || '6');
            setInstallmentCount(months);
            
            const remaining = offerPrice - downPayment;
            const count = parseInt(months, 10) || 6;
            if (remaining > 0 && count > 0) {
                const monthly = Math.floor(remaining / count);
                const last = remaining - monthly * (count - 1);
                const drafts: InstallmentDraft[] = [];
                for (let i = 0; i < count; i++) {
                    const d = new Date(contractDate);
                    d.setMonth(d.getMonth() + i + 1);
                    drafts.push({
                        installmentNumber: i + 1,
                        dueDate: d.toISOString().slice(0, 10),
                        amountSyp: String(i === count - 1 ? last : monthly),
                    });
                }
                setInstallmentDrafts(drafts);
                setInstallmentsConfirmed(true);
                setPersistedInstallmentsConfirmed(false);
            }
        }
    }, [selectedTask, detailedVisits, deviceModels, contractDate]);

    const handleResetOffer = useCallback(() => {
        setSelectedOffer(null);
        setSelectedTask(null);
        setSourceTaskId('');
        setSourceOpenTaskId(null);
        setSourceTaskOfferId(null);
        setSaleReferenceNumber(null);
        setSelectedOfferVisitId(null);
        setSelectedOfferTaskId(null);
        
        setDeviceModelId('');
        setSelectedDiscountId('');
        setPaymentType('cash');
        setPaymentEntries([]);
        setConfirmedEntries(new Set());
        setEntryErrors({});
        setHasDownPayment(false);
        setInstallmentDrafts([]);
        setInstallmentsConfirmed(false);
        setPersistedInstallmentsConfirmed(false);
        setInstallmentCount('6');
        
        // Also clear device line item
        setLineItems([]);
    }, []);

    // Payment helpers
    const isBarter = (m: PaymentMethod) => m === 'barter';
    const methodLabel = (m: PaymentMethod): string => {
        const labels: Record<string, string> = {
            cash: 'نقد', sham_cash: 'شام كاش', syriatel_cash: 'سيرياتيل كاش',
            mtn_cash: 'MTN كاش', alharam: 'الهرم', bank_transfer: 'حوالة بنكية',
            barter: 'مقايضة',
        };
        return labels[m] ?? m;
    };
    const entrySyp = (e: PaymentEntryDraft): number => {
        if (isBarter(e.method)) return Number(e.barterValueSyp) || 0;
        const val = Number(e.amountValue) || 0;
        if (e.currency === 'USD') return val * (Number(e.exchangeRate) || 0);
        return val;
    };
    const newPaymentEntry = (): PaymentEntryDraft => ({
        paymentCategory: 'hand', method: 'cash', currency: 'SYP',
        amountValue: '', exchangeRate: '', referenceNumber: '', barterName: '', barterValueSyp: '', notes: '',
    });
    const updateEntry = (idx: number, patch: Partial<PaymentEntryDraft>) => {
        setPaymentEntries(prev => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
        setEntryErrors(prev => { const next = { ...prev }; delete next[idx]; return next; });
    };
    const validateEntry = (idx: number): string[] => {
        const e = paymentEntries[idx];
        const errors: string[] = [];
        if (e.paymentCategory === 'hand') {
            if (!(Number(e.amountValue) > 0)) errors.push('المبلغ مطلوب');
        }
        if (e.paymentCategory === 'transfer') {
            if (!(Number(e.amountValue) > 0)) errors.push('المبلغ مطلوب');
            if (!e.referenceNumber.trim()) errors.push('رقم الحوالة مطلوب');
        }
        if (e.paymentCategory === 'barter') {
            if (!e.barterName.trim()) errors.push('اسم المقايضة مطلوب');
            if (!(Number(e.barterValueSyp) > 0)) errors.push('قيمة المقايضة مطلوبة');
        }
        if (e.currency === 'USD' && e.paymentCategory !== 'barter' && !(Number(e.exchangeRate) > 0)) {
            errors.push('سعر الصرف مطلوب');
        }
        return errors;
    };
    const confirmEntry = (idx: number) => {
        const errors = validateEntry(idx);
        if (errors.length > 0) {
            setEntryErrors(prev => ({ ...prev, [idx]: errors }));
            return;
        }
        setEntryErrors(prev => { const next = { ...prev }; delete next[idx]; return next; });
        setConfirmedEntries(prev => { const s = new Set(prev); s.add(idx); return s; });
    };
    const unconfirmEntry = (idx: number) => setConfirmedEntries(prev => { const s = new Set(prev); s.delete(idx); return s; });
    const deleteEntry = (idx: number) => {
        setPaymentEntries(prev => prev.filter((_, i) => i !== idx));
        setConfirmedEntries(prev => {
            const s = new Set<number>();
            prev.forEach(i => { if (i < idx) s.add(i); else if (i > idx) s.add(i - 1); });
            return s;
        });
        setEntryErrors(prev => {
            const next: Record<number, string[]> = {};
            Object.entries(prev).forEach(([k, v]) => {
                const n = Number(k);
                if (n < idx) next[n] = v;
                else if (n > idx) next[n - 1] = v;
            });
            return next;
        });
    };

    const grandTotal = useMemo(() => lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [lineItems]);
    const totalPaidSyp = useMemo(() => paymentEntries.reduce((s, e) => s + entrySyp(e), 0), [paymentEntries]);
    const totalInstallmentSyp = useMemo(() => installmentDrafts.reduce((s, i) => s + (Number(i.amountSyp) || 0), 0), [installmentDrafts]);
    const remainingAfterPayments = grandTotal - totalPaidSyp;
    const hasConfirmedPayments = useMemo(() => confirmedEntries.size > 0, [confirmedEntries]);

    // Compatible spare parts for selected device
    const compatibleSpareParts = useMemo(
        () => deviceModelId ? spareParts.filter((p: any) => (p.compatibleDeviceIds || []).includes(Number(deviceModelId))) : [],
        [spareParts, deviceModelId]
    );
    const lineItemsTotal = useMemo(() => lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [lineItems]);

    // Geo — handled by GeoSmartSearch component

    // Customer search
    const filteredCustomers = useMemo(() => {
        const query = customerSearch.trim();
        if (!showCustomerDropdown) return [];
        if (!query) return customers.slice(0, 25);
        return customers
            .filter(c => c.name.includes(query) || c.mobile.includes(query))
            .slice(0, 25);
    }, [customerSearch, customers, showCustomerDropdown]);

    // Plan 2026-06-10 §1 — mirror backend deriveContractStatus:
    // a contract with no closing employee is saved as a draft, which DEC-CT-01
    // declares to have zero side effects. Drafts therefore need only the minimal
    // fields required to identify the deal; full validation kicks in only for
    // active contracts.
    const isDraftMode = !closingEmployeeId;

    // Plan 2026-06-10 §3 — legal info constraint is governed by payment type:
    //   • cash (active)    → documentary only, all 9 optional
    //   • installment      → legally binding, all 9 required
    //   • draft            → always optional (completed at approval time)
    // National ID, if entered, must be exactly 11 digits — this rule is
    // independent of required-ness ("if you enter something it must be valid").
    const nidIsValid = nationalIdOverride.trim().length === 0 || /^\d{11}$/.test(nationalIdOverride.trim());
    const legalRequiredForActive = !isDraftMode && paymentType === 'installment'
        && saleSubtype !== 'temporary' && saleSubtype !== 'free';
    const legalFieldsPresent =
        fatherNameOverride.trim().length > 0
        && nationalIdOverride.trim().length > 0
        && buyerMotherName.trim().length > 0
        && Boolean(buyerGender)
        && buyerBirthDate.length > 0
        && buyerNationalIdRegistry.trim().length > 0
        && buyerNationalIdIssuedBy.trim().length > 0
        && buyerNationalIdIssueDate.length > 0
        && buyerNationalIdBox.trim().length > 0;
    const legalMissing = legalRequiredForActive;
    const legalResolved = legalRequiredForActive ? (legalFieldsPresent && nidIsValid) : nidIsValid;

    const formatPrice = (n: number) => `${String(n)} ل.س`;

    const generateInstallments = useCallback(() => {
        const downPaid = hasDownPayment ? totalPaidSyp : 0;
        const remaining = grandTotal - downPaid;
        const count = parseInt(installmentCount, 10) || 6;
        if (remaining <= 0 || count <= 0) return;
        const monthly = Math.floor(remaining / count);
        const last = remaining - monthly * (count - 1);
        const drafts: InstallmentDraft[] = [];
        for (let i = 0; i < count; i++) {
            const d = new Date(contractDate);
            d.setMonth(d.getMonth() + i + 1);
            drafts.push({
                installmentNumber: i + 1,
                dueDate: d.toISOString().slice(0, 10),
                amountSyp: String(i === count - 1 ? last : monthly),
            });
        }
        setInstallmentDrafts(drafts);
        setInstallmentsConfirmed(false);
        setPersistedInstallmentsConfirmed(false);
    }, [installmentCount, grandTotal, totalPaidSyp, hasDownPayment, contractDate]);

    // ─── Validity ───
    // Plan 2026-06-10 — return a list of human-readable issues instead of a
    // bare boolean so the user always knows exactly which field is blocking
    // submission. isValid is derived from the list being empty.
    const validationIssues = useMemo<string[]>(() => {
        const issues: string[] = [];

        // Base fields — required for both draft and active.
        if (!selectedCustomer) issues.push('اختر الزبون');
        if (!deviceModelId) issues.push('اختر نموذج الجهاز');
        if (!serialNumber.trim()) issues.push('أدخل الرقم التسلسلي للجهاز');
        if (!geoSelection.govId) issues.push('اختر المحافظة في عنوان التركيب');
        else if (!geoSelection.neighborhoodId) issues.push('اختر الحي (الموقع التفصيلي) في عنوان التركيب');

        // National ID format applies always when entered (even in draft).
        if (!nidIsValid) issues.push('الرقم الوطني يجب أن يكون 11 رقم بالضبط');

        // Plan 2026-06-10 (revised) — Financials are required even for drafts.
        // Without complete financial info the draft cannot be approved later
        // without re-opening it; we make this a hard requirement up-front so
        // approval from ContractDetail can succeed in one click.
        if (saleSubtype !== 'temporary' && saleSubtype !== 'free') {
            if (saleSource === 'device_demo_task' && !sourceTaskId.trim()) {
                issues.push('اختر زيارة عرض الجهاز المرتبطة');
            }
            if (paymentType === 'cash') {
                if (paymentEntries.length === 0) {
                    issues.push('عقد كاش — أضف دفعة واحدة على الأقل');
                } else {
                    if (confirmedEntries.size !== paymentEntries.length) {
                        issues.push('عقد كاش — أكّد كل الدفعات المُدخَلة');
                    }
                    if (Math.abs(totalPaidSyp - grandTotal) > 1) {
                        issues.push(`عقد كاش — مجموع الدفعات (${totalPaidSyp}) لا يساوي الإجمالي (${grandTotal})`);
                    }
                }
            }
            if (paymentType === 'installment') {
                if (!installmentsConfirmed) issues.push('عقد تقسيط — أكّد جدول الأقساط');
                if (hasDownPayment) {
                    if (paymentEntries.length === 0) {
                        issues.push('عقد تقسيط — أدخل دفعة المقدم');
                    } else if (confirmedEntries.size !== paymentEntries.length) {
                        issues.push('عقد تقسيط — أكّد دفعة المقدم');
                    }
                }
                const sumDown = hasDownPayment ? totalPaidSyp : 0;
                if (Math.abs(totalInstallmentSyp + sumDown - grandTotal) > 1) {
                    issues.push(`عقد تقسيط — مجموع الأقساط${hasDownPayment ? ' + المقدم' : ''} (${totalInstallmentSyp + sumDown}) لا يساوي الإجمالي (${grandTotal})`);
                }
            }
        }

        // Draft: financials enforced above; legal info is deferred to approval.
        if (isDraftMode) return issues;

        // Active contract — additional legal validation for installment.
        if (legalRequiredForActive && !legalFieldsPresent) {
            if (!fatherNameOverride.trim()) issues.push('عقد تقسيط — اسم الأب مطلوب');
            if (!nationalIdOverride.trim()) issues.push('عقد تقسيط — الرقم الوطني مطلوب');
            if (!buyerMotherName.trim()) issues.push('عقد تقسيط — اسم الأم مطلوب');
            if (!buyerGender) issues.push('عقد تقسيط — الجنس مطلوب');
            if (!buyerBirthDate) issues.push('عقد تقسيط — تاريخ الميلاد مطلوب');
            if (!buyerNationalIdRegistry.trim()) issues.push('عقد تقسيط — القيد مطلوب');
            if (!buyerNationalIdIssuedBy.trim()) issues.push('عقد تقسيط — أمانة السجل مطلوبة');
            if (!buyerNationalIdIssueDate) issues.push('عقد تقسيط — تاريخ منح الهوية مطلوب');
            if (!buyerNationalIdBox.trim()) issues.push('عقد تقسيط — الخانة مطلوبة');
        }

        // Financial validation already enforced above (applies to draft + active alike).
        return issues;
    }, [
        selectedCustomer, deviceModelId, serialNumber, geoSelection,
        isDraftMode, nidIsValid, legalRequiredForActive, legalFieldsPresent,
        fatherNameOverride, nationalIdOverride, buyerMotherName, buyerGender,
        buyerBirthDate, buyerNationalIdRegistry, buyerNationalIdIssuedBy,
        buyerNationalIdIssueDate, buyerNationalIdBox, saleSubtype, saleSource,
        sourceTaskId, paymentType, paymentEntries, confirmedEntries,
        totalPaidSyp, grandTotal, hasDownPayment, installmentsConfirmed,
        totalInstallmentSyp,
    ]);
    const isValid = validationIssues.length === 0;

    const handleSubmit = useCallback(async () => {
        if (!isValid || saving) return;
        setSaving(true);
        try {
            const isFreeSale = saleSubtype === 'free';
            const isTemporarySale = saleSubtype === 'temporary';
            const isNoFinancialObligations = isFreeSale;
            const isNoInitialPayments = isFreeSale || isTemporarySale;
            const nextContractStatus = closingEmployeeId ? 'active' : 'draft';

            const finalBasePrice = isNoFinancialObligations ? 0 : (selectedDevice?.basePrice || 0);
            const finalPriceVal = isNoFinancialObligations ? 0 : grandTotal;
            const finalPaymentType = isNoInitialPayments ? 'cash' : paymentType;
            const finalInstallmentsCount = (isNoInitialPayments || paymentType === 'cash') ? 0 : installmentDrafts.length;

            const payload = {
                customerId: selectedCustomer?.id,
                customerName: selectedCustomer?.name,
                selectedReferrers: (selectedCustomer?.referrers || []).filter(referrer => selectedReferrerIds.includes(String(referrer.id))),
                deviceModelId,
                deviceModelName: selectedDevice?.nameAr || selectedDevice?.name,
                serialNumber,
                contractDate,
                deliveryDate: deliveryDate || null,
                installationDate: installationDate || null,
                warrantyMonths: warrantyMonths > 0 ? warrantyMonths : 0,
                warrantyVisits: (warrantyMonths > 0 && warrantyVisits > 0) ? warrantyVisits : null,
                saleType,
                saleSource: saleSource || null,
                sourceVisit: saleSource === 'device_demo_task' ? (sourceTaskId.trim() || null) : null,
                discountId: (isNoFinancialObligations || !selectedDiscountId) ? null : Number(selectedDiscountId),
                appliedDeviceDiscountId: (isNoFinancialObligations || !selectedDiscountId) ? null : Number(selectedDiscountId),
                paymentType: finalPaymentType,
                basePrice: finalBasePrice,
                finalPrice: finalPriceVal,
                downPayment: 0,
                installmentsCount: finalInstallmentsCount,
                geoSelection,
                detailedAddress,
                mapPosition,
                fatherName: fatherNameOverride || selectedCustomer?.fatherName,
                nationalId: nationalIdOverride || selectedCustomer?.nationalId,
                buyerBirthDate: buyerBirthDate || null,
                buyerGender: buyerGender || null,
                buyerMotherName: buyerMotherName.trim() || null,
                buyerNationalIdRegistry: buyerNationalIdRegistry.trim() || null,
                buyerNationalIdIssuedBy: buyerNationalIdIssuedBy.trim() || null,
                buyerNationalIdIssueDate: buyerNationalIdIssueDate || null,
                buyerNationalIdBox: buyerNationalIdBox.trim() || null,
                closingEmployeeId: closingEmployeeId ? Number(closingEmployeeId) : null,
                noClosingReasonId: noClosingReasonId ? Number(noClosingReasonId) : null,
                invoiceNotes: invoiceNotes.trim() || null,
                contractType,
                saleSubtype,
                // DEC-CT-01: `temporary` is no longer a status; it's a saleSubtype.
                // Status follows draft→active rule: active iff a closing_employee_id
                // is assigned at creation, otherwise draft.
                status: nextContractStatus,
                sourceOpenTaskId: sourceOpenTaskId || null,
                sourceTaskOfferId: sourceTaskOfferId || null,
                saleReferenceNumber: saleReferenceNumber || null,
                // Plan 2026-06-10 §4 — sale_owner_id = deal originator
                // (defaults to data-entry user on backend when null).
                saleOwnerId: saleOwnerId ? Number(saleOwnerId) : null,
                lineItems: isFreeSale ? [] : lineItems.map(item => ({
                    itemType: item.itemType,
                    sparePartId: item.sparePartId || null,
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: isNoFinancialObligations ? 0 : item.unitPrice,
                    totalPrice: isNoFinancialObligations ? 0 : (item.quantity * item.unitPrice),
                })),
                paymentEntries: isNoInitialPayments ? [] : paymentEntries
                    .filter(e => e.method && (Number(e.amountValue) > 0 || isBarter(e.method)))
                    .map(e => ({
                        method: e.method,
                        currency: e.currency,
                        amountValue: Number(e.amountValue) || 0,
                        exchangeRate: e.currency === 'USD' ? Number(e.exchangeRate) || null : null,
                        amountSyp: entrySyp(e),
                        referenceNumber: e.paymentCategory === 'transfer' ? e.referenceNumber || null : null,
                        barterName: isBarter(e.method) ? e.barterName || null : null,
                        barterValueSyp: isBarter(e.method) ? Number(e.barterValueSyp) || null : null,
                        notes: e.notes || null,
                    })),
                installments: isNoInitialPayments ? [] : (paymentType === 'installment'
                    ? installmentDrafts.map(i => ({
                        installmentNumber: i.installmentNumber,
                        dueDate: i.dueDate,
                        amountSyp: Number(i.amountSyp) || 0,
                        confirmed: installmentsConfirmed,
                    }))
                    : []),
            };

            const result = isEdit && editId
                ? await api.contracts.update(Number(editId), payload)
                : await api.contracts.create(payload);
            const savedContractId = Number(result.id ?? editId);

            if (isEdit && savedContractId && isDraftMode) {
                if (isNoInitialPayments) {
                    await api.contracts.savePaymentEntries(savedContractId, []);
                    await api.contracts.saveInstallments(savedContractId, []);
                } else {
                    await api.contracts.savePaymentEntries(savedContractId, payload.paymentEntries);
                    if (paymentType === 'installment' && installmentsConfirmed && !persistedInstallmentsConfirmed) {
                        await api.contracts.saveInstallments(savedContractId, payload.installments);
                        await api.contracts.confirmInstallments(savedContractId);
                    }
                }
            }

            // Post-insertion offer linkage (create only)
            if (!isEdit && selectedOfferVisitId && selectedOfferTaskId && sourceTaskOfferId) {
                try {
                    await api.marketingVisits.linkOfferContract(
                        selectedOfferVisitId,
                        selectedOfferTaskId,
                        sourceTaskOfferId,
                        result.id
                    );
                } catch (linkErr) {
                    console.error('Failed to link offer to contract:', linkErr);
                }
            }
            navigate(`/contracts/${savedContractId}`);
        } catch (err) {
            console.error('Failed to save contract:', err);
        } finally {
            setSaving(false);
        }
    }, [
        isValid, saving, isEdit, editId, isDraftMode, selectedCustomer, deviceModelId, selectedDevice, serialNumber,
        contractDate, saleType, saleSource, sourceTaskId, selectedDiscountId,
        paymentType, grandTotal, basePrice, installmentDrafts, installmentsConfirmed,
        persistedInstallmentsConfirmed, paymentEntries, closingEmployeeId,
        invoiceNotes, lineItems, geoSelection, detailedAddress, mapPosition, fatherNameOverride,
        nationalIdOverride, saleSubtype, selectedReferrerIds, sourceOpenTaskId, sourceTaskOfferId, saleReferenceNumber,
        selectedOfferVisitId, selectedOfferTaskId, noClosingReasonId, saleOwnerId, navigate,
        warrantyMonths, warrantyVisits, deliveryDate, installationDate,
        buyerBirthDate, buyerGender, buyerMotherName, buyerNationalIdRegistry,
        buyerNationalIdIssuedBy, buyerNationalIdIssueDate, buyerNationalIdBox,
    ]);

    const handleSaleSubtypeChange = (subtype: 'definitive' | 'temporary' | 'free') => {
        setSaleSubtype(subtype);
        setPaymentEntries([]);
        setConfirmedEntries(new Set());
        setEntryErrors({});
        setHasDownPayment(false);
        setInstallmentDrafts([]);
        setInstallmentsConfirmed(false);
        setPersistedInstallmentsConfirmed(false);
        setPaymentType('cash');
        if (subtype === 'free') {
            setSelectedDiscountId('');
            setLineItems([]);
        }
    };

    const handleReset = () => {
        setSelectedCustomer(null); setCustomerSearch(''); setSelectedReferrerIds([]); setFatherNameOverride(''); setNationalIdOverride('');
        setBuyerBirthDate(''); setBuyerGender('');
        setBuyerMotherName(''); setBuyerNationalIdRegistry(''); setBuyerNationalIdIssuedBy(''); setBuyerNationalIdIssueDate(''); setBuyerNationalIdBox('');
        setSaleType('direct'); setContractDate(new Date().toISOString().slice(0, 10));
        setOldContractNumber(''); setOldDeviceCondition('good');
        setSaleSource(''); setSourceTaskId('');
        setDeviceModelId(''); setSerialNumber('');
        setGeoSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
        setDetailedAddress(''); setMapPosition(null); setShowMapPicker(false);
        setPaymentType('cash'); setPaymentEntries([]); setConfirmedEntries(new Set()); setEntryErrors({}); setHasDownPayment(false);
        setInstallmentDrafts([]); setInstallmentsConfirmed(false); setPersistedInstallmentsConfirmed(false); setInstallmentCount('6');
        setClosingEmployeeId(''); setNoClosingReasonId(''); setInvoiceNotes('');
        setDeviceDiscounts([]); setSelectedDiscountId(''); setLineItems([]); setAddingAccessoryCategory('');
        setSaleSubtype('definitive');
        if (!isEdit) setStep('type_selection');
        setSelectedTask(null);
        setSelectedOffer(null);
        setSourceOpenTaskId(null);
        setSourceTaskOfferId(null);
        setSaleReferenceNumber(null);
        setSelectedOfferVisitId(null);
        setSelectedOfferTaskId(null);
        setSaleOwnerId('');
        setWarrantyMonths(0);
        setWarrantyVisits(0);
    };

    const handleLocationSelect = useCallback((lat: number, lng: number) => {
        if (lat === 0 && lng === 0) { setMapPosition(null); } else { setMapPosition([lat, lng]); }
    }, []);

    // Single-mediator rule: a sale has exactly one referrer. Selecting a chip
    // replaces any previous choice; clicking the active chip clears it.
    const toggleReferrer = useCallback((referrerId: string) => {
        setSelectedReferrerIds(prev => (prev.includes(referrerId) ? [] : [referrerId]));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50">
                <div className="max-w-lg mx-auto px-4 py-16">
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
                        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle className="w-6 h-6" />
                        </div>
                        <h1 className="text-lg font-bold text-slate-800 mb-2">العقد غير قابل للتعديل</h1>
                        <p className="text-sm text-slate-500 mb-5">{loadError}</p>
                        <button
                            type="button"
                            onClick={() => navigate(editId ? `/contracts/${editId}` : '/contracts')}
                            className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl px-5 py-2.5 text-sm font-bold transition-colors"
                        >
                            العودة إلى تفاصيل العقد
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (mustPickBranch) {
        return (
            <div className="h-full overflow-y-auto bg-slate-50">
                <div className="max-w-lg mx-auto px-4 py-16">
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
                        <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto mb-4">
                            <AlertTriangle className="w-6 h-6" />
                        </div>
                        <h1 className="text-lg font-bold text-slate-800 mb-2">اختر فرعاً أولاً</h1>
                        <p className="text-sm text-slate-500 mb-5">
                            يجب تحديد الفرع المستهدف من فلتر الإدارة قبل إضافة عقد، حتى لا يُنشأ العقد في فرعك الأساسي بالخطأ.
                        </p>
                        <button
                            type="button"
                            onClick={() => navigate('/contracts')}
                            className="bg-sky-600 hover:bg-sky-700 text-white rounded-xl px-5 py-2.5 text-sm font-bold transition-colors"
                        >
                            العودة إلى قائمة العقود
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const paymentsValid = paymentType === 'cash'
        ? (paymentEntries.length > 0 && confirmedEntries.size === paymentEntries.length && Math.abs(totalPaidSyp - grandTotal) <= 1)
        : (paymentType === 'installment' && hasDownPayment
            ? (paymentEntries.length > 0 && confirmedEntries.size === paymentEntries.length && totalPaidSyp < grandTotal)
            : true);

    /* ── شاشة اختيار نوع العقد (الخطوة الأولى) ─────────────────── */
    if (step === 'type_selection') {
        return (
            <div className="h-full overflow-y-auto">
                <div className="max-w-xl mx-auto py-12 px-4 space-y-6">
                    {/* Header */}
                    <div className="text-center space-y-1">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-bl from-sky-500 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/25 mx-auto mb-4">
                            <FileText className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-lg font-bold text-slate-800">عقد جديد</h1>
                        <p className="text-sm text-slate-400">اختر نوع عقد البيع للمتابعة</p>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                        <p className="text-xs font-bold text-slate-500">نوع عقد البيع</p>
                        <div className="grid grid-cols-3 gap-2">
                            <button type="button" onClick={() => handleSaleSubtypeChange('definitive')}
                                className={`py-3 px-2 rounded-xl border text-xs font-semibold transition-all text-center ${saleSubtype === 'definitive' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                                بيع قطعي
                            </button>
                            <button type="button" onClick={() => handleSaleSubtypeChange('temporary')}
                                className={`py-3 px-2 rounded-xl border text-xs font-semibold transition-all text-center ${saleSubtype === 'temporary' ? 'bg-amber-500 border-amber-500 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                                عقد مؤقت
                            </button>
                            <button type="button" onClick={() => handleSaleSubtypeChange('free')}
                                className={`py-3 px-2 rounded-xl border text-xs font-semibold transition-all text-center ${saleSubtype === 'free' ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                                مجاني / هبة
                            </button>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        تم نقل عقود الصيانة إلى <span className="font-bold">اتفاقيات الخدمة</span>، ولم تعد تنشأ من شاشة العقود.
                    </div>

                    {/* Continue Button */}
                    <button
                        type="button"
                        onClick={() => setStep('details')}
                        className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-2"
                    >
                        <span>متابعة لإدخال التفاصيل</span>
                        <ArrowRightLeft className="w-4 h-4 rotate-180" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto">
            <div className="space-y-5 max-w-3xl mx-auto py-6 px-4">
                {/* Page Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-bl from-sky-500 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/25">
                            <FileText className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-800">{isEdit ? 'تعديل العقد' : 'عقد جديد'}</h1>
                            <p className="text-xs text-slate-400">
                                {saleSubtype === 'definitive' ? 'بيع قطعي' : saleSubtype === 'temporary' ? 'عقد مؤقت' : 'مجاني / هبة'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleReset} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
                            <RotateCcw className="w-4 h-4" /><span>إعادة تعيين</span>
                        </button>
                        <button onClick={handleSubmit} disabled={!isValid || saving}
                            title={!isValid ? validationIssues.join(' • ') : (isDraftMode ? 'حفظ كمسودة' : 'حفظ العقد')}
                            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors shadow-sm disabled:shadow-none">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}<span>{saving ? 'جاري الحفظ...' : (isDraftMode ? 'حفظ كمسودة' : 'حفظ العقد')}</span>
                        </button>
                    </div>
                </div>
                {validationIssues.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <div className="flex-1">
                                <p className="text-xs font-bold text-amber-800 mb-1">
                                    {isDraftMode ? 'لحفظ المسودة أكمل ما يلي:' : 'لحفظ العقد كنشط أكمل ما يلي:'}
                                </p>
                                <ul className="text-xs text-amber-700 space-y-0.5 list-disc pr-4">
                                    {validationIssues.map((issue, i) => (
                                        <li key={i}>{issue}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 1. CUSTOMER & LEGAL INFO                               */}
                {/* ═══════════════════════════════════════════════════════ */}
                <Section
                    title="بيانات الزبون والهوية"
                    icon={ShieldCheck}
                    status={selectedCustomer ? (legalMissing && !legalResolved ? 'warning' : 'valid') : undefined}
                    badge={selectedCustomer && legalMissing && !legalResolved ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> بيانات ناقصة
                        </span>
                    ) : undefined}
                >
                    {/* Customer Search */}
                    <Field label="اختر الزبون" required>
                        <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowCustomerDropdown(false); }}>
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                                <input
                                    type="text"
                                    value={selectedCustomer ? selectedCustomer.name : customerSearch}
                                    onChange={e => { setCustomerSearch(e.target.value); setSelectedCustomer(null); setSelectedReferrerIds([]); setShowCustomerDropdown(true); setFatherNameOverride(''); setNationalIdOverride(''); }}
                                    onFocus={() => setShowCustomerDropdown(true)}
                                    placeholder="بحث بالاسم أو رقم الموبايل..."
                                    className={`${inputClass} pr-10`}
                                />
                            </div>
                            {showCustomerDropdown && !selectedCustomer && (
                                <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                                    {filteredCustomers.length === 0 ? (
                                        <div className="p-3 text-center text-sm text-slate-400">لا يوجد نتائج</div>
                                    ) : (
                                        filteredCustomers.map(c => (
                                            <button key={c.id} type="button"
                                                className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-b-0"
                                                onClick={async () => {
                                                    setCustomerSearch('');
                                                    setShowCustomerDropdown(false);
                                                    setFatherNameOverride('');
                                                    setNationalIdOverride('');
                                                    try {
                                                        const freshClient = await api.clients.get(c.id);
                                                        setSelectedCustomer(freshClient);
                                                    } catch {
                                                        setSelectedCustomer(c);
                                                    }
                                                }}>
                                                <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center">
                                                    <User className="w-4 h-4 text-sky-600" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                                                    <p className="text-xs text-slate-400" dir="ltr">{c.mobile}</p>
                                                </div>
                                                {(!c.fatherName || !c.nationalId) && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-50 text-amber-500 border border-amber-100">ناقص</span>
                                                )}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </Field>

                    {/* Plan §3 — Unified legal identity section. Required-ness is
                        driven by payment type: cash = documentary (all optional);
                        installment = legally binding (all 9 required). Drafts
                        always treat this section as optional. */}
                    {selectedCustomer && (() => {
                        const required = legalRequiredForActive;
                        const inputCls = (filled: boolean) => required && !filled
                            ? 'w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm placeholder:text-amber-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/10 focus:outline-none'
                            : inputClass;
                        const labelCls = (filled: boolean) => `text-xs font-semibold ${required && !filled ? 'text-amber-700' : 'text-slate-600'}`;
                        const star = (filled: boolean) => required && !filled ? <span className="text-red-400">*</span> : null;
                        const nidFilled = nationalIdOverride.trim().length > 0;
                        const nidLengthWrong = nidFilled && !nidIsValid;
                        const sectionColor = required && !legalFieldsPresent
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-slate-50 border-slate-200';

                        return (
                            <div className={`rounded-xl border p-4 space-y-3 ${sectionColor}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        {required && !legalFieldsPresent
                                            ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                            : <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                        }
                                        <span className={`text-xs font-bold ${required && !legalFieldsPresent ? 'text-amber-700' : 'text-slate-600'}`}>
                                            البيانات القانونية للعقد
                                        </span>
                                    </div>
                                    <span className="text-xs text-slate-400">
                                        {isDraftMode
                                            ? 'مسودة — البيانات اختيارية وتُكمل عند الاعتماد'
                                            : required
                                                ? 'مطلوبة لعقد التقسيط'
                                                : 'توثيقية — اختيارية في عقد الكاش'}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    {/* صف 1: الأب | الأم */}
                                    <div className="space-y-1">
                                        <label className={labelCls(fatherNameOverride.trim().length > 0)}>
                                            اسم الأب {star(fatherNameOverride.trim().length > 0)}
                                        </label>
                                        <input
                                            type="text"
                                            value={fatherNameOverride}
                                            onChange={e => setFatherNameOverride(e.target.value)}
                                            placeholder="اسم الأب"
                                            className={inputCls(fatherNameOverride.trim().length > 0)}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className={labelCls(buyerMotherName.trim().length > 0)}>
                                            اسم الأم {star(buyerMotherName.trim().length > 0)}
                                        </label>
                                        <input
                                            type="text"
                                            value={buyerMotherName}
                                            onChange={e => setBuyerMotherName(e.target.value)}
                                            placeholder="اسم الأم"
                                            className={inputCls(buyerMotherName.trim().length > 0)}
                                        />
                                    </div>

                                    {/* صف 2: الرقم الوطني | الجنس */}
                                    <div className="space-y-1">
                                        <label className={`${labelCls(nidFilled && !nidLengthWrong)} ${nidLengthWrong ? 'text-red-600' : ''}`}>
                                            الرقم الوطني (11 رقم) {star(nidFilled && !nidLengthWrong)}
                                        </label>
                                        <input
                                            type="text"
                                            value={nationalIdOverride}
                                            onChange={e => setNationalIdOverride(e.target.value.replace(/\D/g, '').slice(0, 11))}
                                            placeholder="11 رقم"
                                            dir="ltr"
                                            maxLength={11}
                                            inputMode="numeric"
                                            pattern="\d{11}"
                                            className={`${nidLengthWrong
                                                ? 'w-full bg-white border border-red-300 rounded-lg px-3 py-2 text-sm font-mono focus:border-red-400 focus:ring-2 focus:ring-red-400/10 focus:outline-none'
                                                : inputCls(nidFilled)} font-mono`}
                                        />
                                        {nidLengthWrong && (
                                            <p className="text-xs text-red-600">يجب أن يكون 11 رقماً بالضبط</p>
                                        )}
                                    </div>

                                    <div className="space-y-1">
                                        <label className={labelCls(Boolean(buyerGender))}>
                                            الجنس {star(Boolean(buyerGender))}
                                        </label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setBuyerGender(buyerGender === 'male' ? '' : 'male')}
                                                className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${buyerGender === 'male' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-slate-200 text-slate-500'}`}>
                                                ذكر
                                            </button>
                                            <button type="button" onClick={() => setBuyerGender(buyerGender === 'female' ? '' : 'female')}
                                                className={`flex-1 py-2 rounded-lg border text-sm font-bold transition-all ${buyerGender === 'female' ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-500'}`}>
                                                أنثى
                                            </button>
                                        </div>
                                    </div>

                                    {/* صف 3: تاريخ الميلاد | القيد */}
                                    <div className="space-y-1">
                                        <label className={labelCls(buyerBirthDate.length > 0)}>
                                            تاريخ الميلاد {star(buyerBirthDate.length > 0)}
                                        </label>
                                        <input type="date" value={buyerBirthDate}
                                            onChange={e => setBuyerBirthDate(e.target.value)}
                                            className={inputCls(buyerBirthDate.length > 0)} />
                                    </div>

                                    <div className="space-y-1">
                                        <label className={labelCls(buyerNationalIdRegistry.trim().length > 0)}>
                                            القيد {star(buyerNationalIdRegistry.trim().length > 0)}
                                        </label>
                                        <input type="text" value={buyerNationalIdRegistry}
                                            onChange={e => setBuyerNationalIdRegistry(e.target.value)}
                                            placeholder="رقم القيد"
                                            className={inputCls(buyerNationalIdRegistry.trim().length > 0)} />
                                    </div>

                                    {/* صف 4: أمانة السجل | تاريخ منح الهوية */}
                                    <div className="space-y-1">
                                        <label className={labelCls(buyerNationalIdIssuedBy.trim().length > 0)}>
                                            أمانة السجل المدني {star(buyerNationalIdIssuedBy.trim().length > 0)}
                                        </label>
                                        <input type="text" value={buyerNationalIdIssuedBy}
                                            onChange={e => setBuyerNationalIdIssuedBy(e.target.value)}
                                            placeholder="أمين السجل المدني"
                                            className={inputCls(buyerNationalIdIssuedBy.trim().length > 0)} />
                                    </div>

                                    <div className="space-y-1">
                                        <label className={labelCls(buyerNationalIdIssueDate.length > 0)}>
                                            تاريخ منح الهوية {star(buyerNationalIdIssueDate.length > 0)}
                                        </label>
                                        <input type="date" value={buyerNationalIdIssueDate}
                                            onChange={e => setBuyerNationalIdIssueDate(e.target.value)}
                                            className={inputCls(buyerNationalIdIssueDate.length > 0)} />
                                    </div>

                                    {/* صف 5: الخانة (بمفردها) */}
                                    <div className="space-y-1">
                                        <label className={labelCls(buyerNationalIdBox.trim().length > 0)}>
                                            الخانة {star(buyerNationalIdBox.trim().length > 0)}
                                        </label>
                                        <input type="text" value={buyerNationalIdBox}
                                            onChange={e => setBuyerNationalIdBox(e.target.value)}
                                            placeholder="رقم أو اسم الخانة"
                                            className={inputCls(buyerNationalIdBox.trim().length > 0)} />
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {selectedCustomer && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-600">وسيط البيعة</span>
                                <span className="text-xs text-slate-400">اختر وسيطاً واحداً فقط</span>
                            </div>
                            {(selectedCustomer.referrers?.length || 0) === 0 ? (
                                <p className="text-xs text-slate-400 italic">لا يوجد وسطاء مسجّلون لهذا الزبون.</p>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    {selectedCustomer.referrers!.map(referrer => {
                                        const isActive = selectedReferrerIds.includes(String(referrer.id));
                                        return (
                                            <button
                                                key={referrer.id}
                                                type="button"
                                                onClick={() => toggleReferrer(String(referrer.id))}
                                                aria-pressed={isActive}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${isActive
                                                    ? 'bg-sky-600 border-sky-600 text-white shadow-sm'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
                                            >
                                                <span>{referrer.referrerName}</span>
                                                <span className={`text-xs rounded-full px-1.5 py-0.5 ${isActive ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                                    {referrerTypeLabel(referrer.referrerType)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </Section>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 2. SALE DETAILS / MAINTENANCE DATE                      */}
                {/* ═══════════════════════════════════════════════════════ */}
                <Section title="تفاصيل البيع" icon={Landmark}>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="نوع البيع" required>
                                <div className="grid grid-cols-3 gap-2">
                                    {saleTypes.map(st => {
                                        const isActive = saleType === st.value;
                                        return (
                                            <button key={st.value} type="button"
                                                onClick={() => setSaleType(st.value)}
                                                className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl border-2 transition-all ${isActive
                                                    ? `${st.activeBg} ${st.activeBorder} ${st.color} shadow-sm`
                                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                                                <st.icon className="w-4 h-4" />
                                                <span className="text-xs font-bold">{st.label}</span>
                                                <span className={`text-[9px] ${isActive ? 'opacity-70' : 'text-slate-400'}`}>{st.desc}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </Field>

                            <Field label="تاريخ العقد" required>
                                <div className="relative">
                                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                    <input type="date" value={contractDate} readOnly disabled className={`${inputClass} pr-10 bg-slate-50 text-slate-500 cursor-not-allowed`} />
                                </div>
                                <p className="text-xs text-slate-400 mt-1 pr-1">يؤخذ تلقائياً من تاريخ اليوم ولا يعدل من هذه الشاشة.</p>
                            </Field>
                        </div>

                        {/* Trade-in context */}
                        <AnimatePresence>
                            {saleType === 'tradein' && (
                                <motion.div key="tradein" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                    <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <ArrowRightLeft className="w-4 h-4 text-purple-600" />
                                            <span className="text-xs font-bold text-purple-700">بيانات الاستبدال</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <Field label="رقم العقد القديم" required>
                                                <div className="relative">
                                                    <Clipboard className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-300 pointer-events-none" />
                                                    <input type="text" value={oldContractNumber} onChange={e => setOldContractNumber(e.target.value)}
                                                        placeholder="CNT-XXXX-XXX" dir="ltr"
                                                        className="w-full bg-white border border-purple-200 rounded-lg px-3 py-2.5 pr-10 text-sm font-mono placeholder:text-purple-300 focus:border-purple-400 focus:outline-none" />
                                                </div>
                                            </Field>
                                            <Field label="حالة الجهاز القديم" required>
                                                <div className="flex gap-2">
                                                    <button type="button" onClick={() => setOldDeviceCondition('good')}
                                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 text-xs font-bold transition-all ${oldDeviceCondition === 'good'
                                                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm'
                                                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                                                        <CheckCircle2 className="w-3.5 h-3.5" /><span>بحالة جيدة</span>
                                                    </button>
                                                    <button type="button" onClick={() => setOldDeviceCondition('damaged')}
                                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 text-xs font-bold transition-all ${oldDeviceCondition === 'damaged'
                                                            ? 'bg-red-50 border-red-300 text-red-700 shadow-sm'
                                                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                                                        <AlertTriangle className="w-3.5 h-3.5" /><span>تالف</span>
                                                    </button>
                                                </div>
                                            </Field>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Redesigned Sales Source Component */}
                        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                            <Field label="مصدر البيع السريع">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const newSource = saleSource === 'device_demo_task' ? '' : 'device_demo_task';
                                        setSaleSource(newSource);
                                        if (newSource !== 'device_demo_task') {
                                            handleResetOffer();
                                        }
                                    }}
                                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${saleSource === 'device_demo_task'
                                        ? 'bg-sky-50 border-sky-300 text-sky-700 shadow-sm font-bold animate-pulse'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
                                >
                                    <Monitor className="w-4 h-4" />
                                    <span>مهمة عرض جهاز</span>
                                </button>
                            </Field>

                            <Field label="مصادر أخرى">
                                <Select<string>
                                    value={saleSource !== 'device_demo_task' ? saleSource : ''}
                                    onChange={(v) => {
                                        setSaleSource(v as SaleSource);
                                        // Reset offer wizard if choosing another source
                                        handleResetOffer();
                                    }}
                                    placeholder="اختر مصدراً آخر..."
                                    ariaLabel="مصادر أخرى"
                                    className="w-full"
                                    options={[{ value: '', label: 'اختر مصدراً آخر...' }, ...customSaleSources.map(item => ({ value: item.value, label: item.valueAr || item.value }))]}
                                />
                            </Field>
                        </div>

                        {/* Plan 2026-06-10 §4 — Sale owner (موظف نسبة البيعة).
                            Auto-fills from the latest device-demo team supervisor
                            for this client. Read-only unless the user has the
                            contracts.assign_sale_owner permission. Frozen once
                            the contract is approved (status !== 'draft'). */}
                        {selectedCustomer && (() => {
                            const saleOwnerFrozen = isEdit && !isDraftMode;
                            const canEdit = canAssignSaleOwner && !saleOwnerFrozen;
                            // sale_owner_id FKs to employees(id) (migration 298) — the
                            // owner is any employee, with or without a system account.
                            // Match/emit employees.id (NOT hrUserId).
                            const selectedEmp = branchEmployees.find((e: any) => Number(e.id) === Number(saleOwnerId));
                            const fallbackLabel = currentUser?.name ? `${currentUser.name} (المُدخِل نفسه)` : 'المُدخِل نفسه';
                            return (
                                <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4">
                                    <Field label="موظف نسبة البيعة" hint={saleOwnerFrozen ? 'مُجمَّد — البيعة منسوبة عند الاعتماد' : (canEdit ? 'يمكنك تغييره' : 'يُحدَّد تلقائياً من فريق العرض')}>
                                        {canEdit ? (
                                            <Select
                                                value={saleOwnerId === '' ? '' : String(saleOwnerId)}
                                                onChange={(v) => setSaleOwnerId(v ? Number(v) : '')}
                                                placeholder={fallbackLabel}
                                                ariaLabel="موظف نسبة البيعة"
                                                className="w-full"
                                                options={[{ value: '', label: fallbackLabel }, ...branchEmployees.filter((emp: any) => emp.status == null || emp.status === 'active').map((emp: any) => ({ value: String(emp.id), label: emp.name }))]}
                                            />
                                        ) : (
                                            <div className={`w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm flex items-center gap-2 ${saleOwnerFrozen ? 'text-slate-500' : 'text-slate-700'}`}>
                                                <User className="w-4 h-4 text-slate-400" />
                                                <span className="flex-1">{selectedEmp?.name || fallbackLabel}</span>
                                                {saleOwnerFrozen && <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded">مُجمَّد</span>}
                                                {!saleOwnerFrozen && saleOwnerId && <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded">تلقائي</span>}
                                            </div>
                                        )}
                                    </Field>
                                </div>
                            );
                        })()}

                        {/* Two-Step Verification Wizard */}
                        <AnimatePresence>
                            {saleSource === 'device_demo_task' && selectedCustomer && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden mt-4"
                                >
                                    <div className="bg-sky-50/50 rounded-xl border border-sky-200 p-4 space-y-4">
                                        <div className="flex items-center gap-2 text-sky-800">
                                            <Monitor className="w-4 h-4 text-sky-600" />
                                            <span className="text-xs font-bold">ربط مهمة عرض جهاز وعرض مقبول</span>
                                        </div>

                                        {/* Step A: Task Selection */}
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-semibold text-sky-700">الخطوة أ: اختر مهمة العرض للزبون</label>
                                            {loadingTasks ? (
                                                <div className="flex items-center gap-2 py-2 text-xs text-sky-600">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    <span>جاري تحميل المهام...</span>
                                                </div>
                                            ) : clientTasks.length === 0 ? (
                                                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                                    <span>لا يوجد مهام عرض جهاز تحتوي على عروض مقبولة غير مرتبطة لهذا العميل.</span>
                                                </div>
                                            ) : (
                                                <Select
                                                    value={selectedTask ? String(selectedTask.id) : ''}
                                                    onChange={(v) => {
                                                        const task = clientTasks.find(t => String(t.id) === v);
                                                        setSelectedTask(task || null);
                                                        setSelectedOffer(null);
                                                        setSourceTaskId(task ? String(task.id) : '');
                                                    }}
                                                    placeholder="اختر المهمة..."
                                                    ariaLabel="المهمة"
                                                    className="w-full"
                                                    options={[{ value: '', label: 'اختر المهمة...' }, ...clientTasks.map(t => ({ value: String(t.id), label: `مهمة رقم #${t.id} - بتاريخ ${t.completedAt ? t.completedAt.slice(0,10) : t.createdAt.slice(0,10)}` }))]}
                                                />
                                            )}
                                        </div>

                                        {/* Step B: Offer Selection */}
                                        {selectedTask && (
                                            <div className="space-y-1.5 border-t border-sky-100 pt-3">
                                                <label className="text-xs font-semibold text-sky-700">الخطوة ب: اختر العرض المقبول لتعبئة العقد تلقائياً</label>
                                                {availableOffers.length === 0 ? (
                                                    <p className="text-xs text-amber-600">لا يوجد عروض مقبولة غير مرتبطة لهذه المهمة</p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {availableOffers.map((o: any, idx: number) => {
                                                            const isSelected = selectedOffer && selectedOffer.id === o.id;
                                                            const dev = deviceModels.find(d => d.id === o.deviceModelId);
                                                            return (
                                                                <button
                                                                    key={o.id || idx}
                                                                    type="button"
                                                                    onClick={() => handleSelectOffer(o)}
                                                                    className={`w-full flex items-center justify-between p-3 rounded-lg border text-right transition-all ${isSelected
                                                                        ? 'bg-sky-100 border-sky-400 text-sky-900 font-bold shadow-sm'
                                                                        : 'bg-white border-sky-100 text-slate-700 hover:border-sky-300'}`}
                                                                >
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-xs font-bold text-slate-800">
                                                                            {dev ? (dev.nameAr || dev.name) : `جهاز معرّف #${o.deviceModelId}`}
                                                                        </p>
                                                                        <p className="text-xs text-slate-500 mt-1">
                                                                            النوع: {o.offerType === 'cash' ? 'نقدي' : 'أقساط'} | الإجمالي: {formatPrice(o.totalAmount)}
                                                                            {o.offerType === 'installment' && ` | دفعة أولى: ${formatPrice(o.firstPaymentAmount || 0)} | ${o.installmentMonths} أشهر`}
                                                                        </p>
                                                                    </div>
                                                                    {o.saleReferenceNumber && (
                                                                        <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                                                                            Ref: {o.saleReferenceNumber}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </Section>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 3. DEVICE & LOCATION                                    */}
                {/* ═══════════════════════════════════════════════════════ */}
                {selectedOffer && (
                    <div className="flex items-center justify-between gap-3 bg-sky-50/80 border border-sky-300 rounded-xl p-4 shadow-sm mb-4">
                        <div className="flex items-center gap-2 text-sky-800">
                            <span className="p-1.5 rounded-lg bg-sky-500 text-white animate-pulse">✨</span>
                            <div>
                                <p className="text-xs font-bold">تم تعبئة بيانات العقد تلقائياً من العرض المقبول (البيانات قابلة للتعديل والزيادة بحرية)</p>
                                <p className="text-xs text-sky-600 mt-0.5">تم استيراد مواصفات الجهاز، السعر، وجدولة الدفعات بنجاح. يمكنك تعديلها وإضافة قطع إضافية.</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleResetOffer}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white border border-sky-300 text-sky-700 hover:bg-sky-50 text-xs font-bold transition-all shadow-sm"
                        >
                            <span>إعادة تعيين العرض</span>
                        </button>
                    </div>
                )}
                <Section title="الجهاز وعنوان التركيب" icon={Monitor} badge={
                    selectedDevice && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
                            {selectedDevice.brand}
                        </span>
                    )
                }>
                    {/* Device Row */}
                    <div className="grid grid-cols-3 gap-4">
                        <Field label="موديل الجهاز" required>
                            <Select
                                value={deviceModelId === '' ? '' : String(deviceModelId)}
                                onChange={(v) => { setDeviceModelId(Number(v) || ''); setSelectedDiscountId(''); }}
                                disabled={isOfferLocked}
                                placeholder="اختر الموديل..."
                                ariaLabel="الموديل"
                                className="w-full"
                                options={[{ value: '', label: 'اختر الموديل...' }, ...deviceModels.map(d => ({ value: String(d.id), label: d.nameAr || d.name }))]}
                            />
                        </Field>
                        <Field label="الرقم التسلسلي" required>
                            <div className="relative">
                                <Hash className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                <input type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="SN-XXXXX" className={`${inputClass} pr-10 font-mono`} dir="ltr" />
                            </div>
                        </Field>
                    </div>

                    {/* Discount selection */}
                    <AnimatePresence>
                        {selectedDevice && saleSubtype !== 'free' && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                <Field label="حسم الجهاز">
                                    <Select
                                        value={selectedDiscountId === '' ? '' : String(selectedDiscountId)}
                                        onChange={(v) => setSelectedDiscountId(Number(v) || '')}
                                        disabled={isOfferLocked}
                                        placeholder="بدون حسم"
                                        ariaLabel="الحسم"
                                        className="w-full"
                                        options={[{ value: '', label: 'بدون حسم' }, ...deviceDiscounts.map((d: any) => ({ value: String(d.id), label: `${d.label} — ${d.percentage}%` }))]}
                                    />
                                    {selectedDiscountId && (() => {
                                        const disc = deviceDiscounts.find(d => d.id === Number(selectedDiscountId));
                                        if (!disc) return null;
                                        const discPrice = Math.round(selectedDevice.basePrice * (1 - disc.percentage / 100));
                                        return (
                                            <p className="text-xs text-emerald-600 mt-1">
                                                السعر بعد الحسم: <strong className="font-mono">{String(discPrice)} ل.س</strong>
                                            </p>
                                        );
                                    })()}
                                </Field>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Line items table */}
                    {lineItems.length > 0 && saleSubtype !== 'free' && (
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                            <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-100">
                                <span className="text-xs font-bold text-slate-700">بنود العقد</span>
                                <span className="text-xs text-slate-400">{lineItems.length} بند</span>
                            </div>
                            {lineItems.length > 0 ? (
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                                        <tr>
                                            <th className="px-3 py-2 text-right">#</th>
                                            <th className="px-3 py-2 text-right">البيان</th>
                                            <th className="px-3 py-2 text-right">الكمية</th>
                                            <th className="px-3 py-2 text-right">السعر</th>
                                            <th className="px-3 py-2 text-right">الإجمالي</th>
                                            <th className="px-3 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {lineItems.map((item, idx) => (
                                            <tr key={idx} className={item.itemType === 'device' ? 'bg-sky-50/40' : 'hover:bg-slate-50/60'}>
                                                <td className="px-3 py-2.5 text-slate-400 text-xs">{idx + 1}</td>
                                                <td className="px-3 py-2.5">
                                                    <span className="text-sm font-medium text-slate-700">{item.description}</span>
                                                </td>
                                                <td className="px-3 py-2.5 w-16">
                                                    {item.itemType === 'device' ? (
                                                        <span className="text-sm text-slate-600">1</span>
                                                    ) : (
                                                        <input type="number" min={1} value={item.quantity}
                                                            onChange={e => setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, quantity: Math.max(1, parseInt(e.target.value) || 1) } : li))}
                                                            className="w-14 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-sky-400" />
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 w-28">
                                                    {item.itemType === 'device' ? (
                                                        <span className="text-sm font-mono text-slate-700">{String(item.unitPrice)}</span>
                                                    ) : (
                                                        <input type="number" min={0} value={item.unitPrice}
                                                            onChange={e => setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, unitPrice: Math.max(0, parseInt(e.target.value) || 0) } : li))}
                                                            className="w-24 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-sky-400 font-mono" dir="ltr" />
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 font-bold text-slate-700 font-mono text-sm">
                                                    {String(item.quantity * item.unitPrice)}
                                                </td>
                                                <td className="px-3 py-2.5 text-center">
                                                    {item.itemType !== 'device' && (
                                                        <button type="button" onClick={() => setLineItems(prev => prev.filter((_, i) => i !== idx))}
                                                            className="text-red-500 hover:text-red-700 transition-colors">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t border-slate-200">
                                        <tr>
                                            <td colSpan={4} className="px-3 py-2 text-xs font-bold text-slate-500">المجموع</td>
                                            <td className="px-3 py-2 font-black text-slate-800 font-mono">{String(lineItemsTotal)}</td>
                                            <td />
                                        </tr>
                                    </tfoot>
                                </table>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-6 text-slate-400 bg-slate-50/50">
                                    <span className="text-lg mb-1">🔧</span>
                                    <p className="text-xs">لا يوجد بنود مضافة حالياً. يمكنك إضافة رسوم صيانة أو ملحقات من الخيارات أدناه.</p>
                                </div>
                            )}
                            {/* Add buttons — two-step accessory flow */}
                            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 space-y-2">
                                {compatibleSpareParts.length > 0 && (
                                    <div className="flex gap-2 items-center">
                                        {/* Step 1: category */}
                                        <Select
                                            value={addingAccessoryCategory}
                                            onChange={setAddingAccessoryCategory}
                                            placeholder="+ إضافة ملحق — اختر الفئة..."
                                            ariaLabel="فئة الملحق"
                                            className="flex-1"
                                            options={[
                                                { value: '', label: '+ إضافة ملحق — اختر الفئة...' },
                                                ...([['Periodic', 'قطع الصيانة الدورية'], ['Emergency', 'قطع الصيانة الطارئة'], ['Accessory', 'اكسسوارات']] as [string, string][])
                                                    .filter(([v]) => compatibleSpareParts.some((p: any) => p.maintenanceType === v))
                                                    .map(([v, l]) => ({ value: v, label: l })),
                                            ]}
                                        />
                                        {/* Step 2: pick specific part */}
                                        {addingAccessoryCategory && (
                                            <Select
                                                value=""
                                                onChange={(v) => {
                                                    const part = spareParts.find((p: any) => p.id === Number(v));
                                                    if (!part) return;
                                                    setLineItems(prev => [...prev, { itemType: 'accessory', sparePartId: part.id, description: part.name, quantity: 1, unitPrice: part.basePrice || 0 }]);
                                                    setAddingAccessoryCategory('');
                                                }}
                                                placeholder="اختر القطعة..."
                                                ariaLabel="القطعة"
                                                className="flex-1"
                                                options={[{ value: '', label: 'اختر القطعة...' }, ...compatibleSpareParts.filter((p: any) => p.maintenanceType === addingAccessoryCategory).map((p: any) => ({ value: String(p.id), label: `${p.name} (${p.code})` }))]}
                                            />
                                        )}
                                    </div>
                                )}
                                <button type="button"
                                    onClick={() => setLineItems(prev => [...prev, { itemType: 'service_fee', description: 'رسوم خدمة', quantity: 1, unitPrice: 0 }])}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                                    + إضافة رسوم خدمة
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <Field label="تاريخ التسليم المتوقع">
                            <div className="relative">
                                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={`${inputClass} pr-10`} />
                            </div>
                        </Field>
                        <Field label="تاريخ التركيب المتوقع">
                            <div className="relative">
                                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                <input type="date" value={installationDate} onChange={e => setInstallationDate(e.target.value)} className={`${inputClass} pr-10`} />
                            </div>
                        </Field>
                    </div>

                    {selectedDevice && (
                        <Field label="فترة كفالة العقد">
                            <div className="relative">
                                <ShieldCheck className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
                                <Select<number>
                                    value={warrantyMonths}
                                    onChange={(months) => {
                                        setWarrantyMonths(months);
                                        const period = (selectedDevice.warrantyPeriods as Array<{ months: number; label: string; visits: number }> || []).find((p: { months: number }) => p.months === months);
                                        setWarrantyVisits((period as any)?.visits ?? 0);
                                    }}
                                    ariaLabel="مدة الكفالة"
                                    className="w-full"
                                    options={[
                                        { value: 0, label: 'بدون كفالة' },
                                        ...((selectedDevice.warrantyPeriods || []).length > 0
                                            ? (selectedDevice.warrantyPeriods as Array<{ months: number; label: string; visits: number }> || []).map((p) => ({ value: p.months, label: p.label }))
                                            : [
                                                { value: 6, label: '6 أشهر' },
                                                { value: 12, label: '12 شهرًا' },
                                                { value: 24, label: '24 شهرًا' },
                                                { value: 36, label: '36 شهرًا' },
                                            ]),
                                    ]}
                                />
                            </div>
                            {warrantyMonths > 0 && (
                                <p className="text-xs text-slate-400 mt-1 pr-1">
                                    {warrantyVisits > 0 ? `${warrantyVisits} زيارة ضمن مدة الكفالة` : 'تطبق الكفالة عند تشغيل الجهاز ودخوله الخدمة الفعلية.'}
                                </p>
                            )}
                        </Field>
                    )}

                    {/* Smart Geo Search */}
                    <GeoSmartSearch
                        geoUnits={geoUnits}
                        value={geoSelection}
                        onChange={setGeoSelection}
                        label="عنوان التركيب"
                        required
                        minSelectableLevel={4}
                        placeholder="ابحث: المنصور، الكرادة، حي العدل..."
                    />

                    {/* Detailed Address */}
                    <Field label="أقرب نقطة دالة / تفاصيل العنوان">
                        <textarea value={detailedAddress} onChange={e => setDetailedAddress(e.target.value)}
                            className={`${inputClass} min-h-[50px] resize-none`} placeholder="مثال: مقابل جامع الرحمن، بناية 5، طابق 3" />
                    </Field>

                    {/* GPS Map */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5" /><span>تحديد الموقع GPS</span>
                            </label>
                            <div className="flex items-center gap-3">
                                {mapPosition && (
                                    <span className="text-xs font-mono text-slate-400" dir="ltr">
                                        {mapPosition[0].toFixed(5)}, {mapPosition[1].toFixed(5)}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setShowMapPicker(prev => !prev)}
                                    className="text-xs font-semibold text-sky-600 hover:text-sky-500 transition-colors"
                                >
                                    {showMapPicker ? 'إخفاء الخريطة' : 'إظهار الخريطة'}
                                </button>
                            </div>
                        </div>
                        {showMapPicker ? (
                            <MapPicker position={mapPosition} onLocationSelect={handleLocationSelect} />
                        ) : (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                                الخريطة اختيارية الآن ومؤجلة لتسريع فتح النموذج. يمكنك فتحها عند الحاجة لتثبيت الموقع بدقة.
                            </div>
                        )}
                    </div>
                </Section>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 4. FINANCIALS                                           */}
                {/* ═══════════════════════════════════════════════════════ */}
                {saleSubtype === 'definitive' && (
                    <Section title="المالية" icon={BadgeDollarSign} badge={
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${paymentType === 'cash'
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                            : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                            {paymentType === 'cash' ? 'نقدي' : 'أقساط'}
                        </span>
                    }>
                        {/* Grand Total Summary */}
                        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-500">إجمالي البنود</span>
                                <span className="font-mono text-slate-700">{formatPrice(grandTotal)}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                                <span className="text-sm font-bold text-slate-800">الإجمالي النهائي</span>
                                <span className="text-lg font-black text-slate-900 font-mono">{formatPrice(grandTotal)}</span>
                            </div>
                        </div>

                        {/* Payment Type Toggle */}
                        <div className="flex gap-3">
                            <button type="button"
                                disabled={hasConfirmedPayments || isOfferLocked}
                                title={hasConfirmedPayments ? 'يوجد دفعات مؤكدة — احذفها أولاً' : isOfferLocked ? 'مغلق تلقائياً من العرض' : ''}
                                onClick={() => { setPaymentType('cash'); setInstallmentDrafts([]); setInstallmentsConfirmed(false); setPersistedInstallmentsConfirmed(false); }}
                                className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-4 rounded-xl border-2 transition-all ${paymentType === 'cash'
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'} ${(hasConfirmedPayments || isOfferLocked) ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <Banknote className="w-5 h-5" /><span className="text-sm font-bold">نقدي</span>
                            </button>
                            <button type="button"
                                disabled={hasConfirmedPayments || isOfferLocked}
                                title={hasConfirmedPayments ? 'يوجد دفعات مؤكدة — احذفها أولاً' : isOfferLocked ? 'مغلق تلقائياً من العرض' : ''}
                                onClick={() => setPaymentType('installment')}
                                className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-4 rounded-xl border-2 transition-all ${paymentType === 'installment'
                                    ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'} ${(hasConfirmedPayments || isOfferLocked) ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <CreditCard className="w-5 h-5" /><span className="text-sm font-bold">أقساط</span>
                            </button>
                        </div>
                        {hasConfirmedPayments && (
                            <p className="text-xs text-slate-400 text-center">
                                يوجد دفعات مؤكدة — احذفها أولاً لتغيير نوع الدفع
                            </p>
                        )}

                        {/* Installment: down payment toggle */}
                        {paymentType === 'installment' && (
                            <Field label="هل يوجد دفعة أولى؟">
                                <div className="flex gap-2">
                                    <button type="button"
                                        disabled={hasConfirmedPayments || isOfferLocked}
                                        title={hasConfirmedPayments ? 'يوجد دفعات مؤكدة — احذفها أولاً' : isOfferLocked ? 'مغلق تلقائياً من العرض' : ''}
                                        onClick={() => setHasDownPayment(true)}
                                        className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold transition-all ${hasDownPayment ? 'bg-sky-50 border-sky-300 text-sky-700' : 'border-slate-200 text-slate-500'} ${(hasConfirmedPayments || isOfferLocked) ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                        نعم
                                    </button>
                                    <button type="button"
                                        disabled={hasConfirmedPayments || isOfferLocked}
                                        title={hasConfirmedPayments ? 'يوجد دفعات مؤكدة — احذفها أولاً' : isOfferLocked ? 'مغلق تلقائياً من العرض' : ''}
                                        onClick={() => { setHasDownPayment(false); setPaymentEntries([]); setConfirmedEntries(new Set()); setEntryErrors({}); }}
                                        className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold transition-all ${!hasDownPayment ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-500'} ${(hasConfirmedPayments || isOfferLocked) ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                        لا
                                    </button>
                                </div>
                                {hasConfirmedPayments && (
                                    <p className="text-xs text-slate-400 text-center mt-1">
                                        يوجد دفعات مؤكدة — احذفها أولاً لتغيير الإجابة
                                    </p>
                                )}
                            </Field>
                        )}

                        {/* Payment Entries (cash always, installment only if hasDownPayment) */}
                        {(paymentType === 'cash' || (paymentType === 'installment' && hasDownPayment)) && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-slate-600">{paymentType === 'cash' ? 'الدفعات' : 'الدفعة الأولى'}</span>
                                    {!isOfferLocked && (
                                        <button type="button"
                                            onClick={() => setPaymentEntries(prev => [...prev, newPaymentEntry()])}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 text-xs font-bold hover:bg-sky-100 transition-colors">
                                            <Plus className="w-3.5 h-3.5" /> إضافة دفعة
                                        </button>
                                    )}
                                </div>

                                {paymentEntries.map((entry, idx) => (
                                    <div key={idx} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                                        {confirmedEntries.has(idx) ? (
                                            /* ── View mode ── */
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <span className="text-xs font-bold text-slate-700">
                                                        {entry.paymentCategory === 'hand' ? 'تسليم باليد' : entry.paymentCategory === 'transfer' ? `حوالة — ${methodLabel(entry.method)}` : 'مقايضة'}
                                                    </span>
                                                    {entry.paymentCategory !== 'barter' && entry.amountValue && (
                                                        <span className="text-xs text-slate-500 font-mono mr-2">
                                                            {String(Number(entry.amountValue))} {entry.currency === 'USD' ? '$' : 'ل.س'}
                                                            {entry.currency === 'USD' && entry.exchangeRate && (
                                                                <span className="text-slate-400"> = {String(Math.round(Number(entry.amountValue) * Number(entry.exchangeRate)))} ل.س</span>
                                                            )}
                                                        </span>
                                                    )}
                                                    {entry.paymentCategory === 'transfer' && entry.referenceNumber && (
                                                        <span className="text-xs text-orange-600 font-mono mr-2">#{entry.referenceNumber}</span>
                                                    )}
                                                    {entry.paymentCategory === 'barter' && (
                                                        <span className="text-xs text-slate-500 mr-2">{entry.barterName} — {String(Number(entry.barterValueSyp))} ل.س</span>
                                                    )}
                                                </div>
                                                {!isOfferLocked && (
                                                    <div className="flex gap-1.5 shrink-0">
                                                        <button type="button" onClick={() => unconfirmEntry(idx)}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors">
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button type="button" onClick={() => deleteEntry(idx)}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            /* ── Edit mode ── */
                                            <>
                                                {/* Row 1: نوع الدفع + amount + delete */}
                                                <div className="flex items-center gap-2">
                                                    <Select<PaymentCategory>
                                                        value={entry.paymentCategory}
                                                        onChange={(cat) => {
                                                            let method: PaymentMethod = 'cash';
                                                            if (cat === 'transfer') method = 'sham_cash';
                                                            if (cat === 'barter') method = 'barter';
                                                            updateEntry(idx, { paymentCategory: cat, method, referenceNumber: '', barterName: '', barterValueSyp: '' });
                                                        }}
                                                        ariaLabel="فئة الدفع"
                                                        className="flex-1"
                                                        options={[
                                                            { value: 'hand', label: 'تسليم باليد' },
                                                            { value: 'transfer', label: 'حوالة' },
                                                            { value: 'barter', label: 'مقايضة' },
                                                        ]}
                                                    />
                                                    {entry.paymentCategory !== 'barter' && (
                                                        <input type="number" min={0} value={entry.amountValue}
                                                            onChange={e => updateEntry(idx, { amountValue: e.target.value })}
                                                            placeholder={entry.currency === 'USD' ? 'المبلغ USD' : 'المبلغ ل.س'}
                                                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-sky-400 font-mono" dir="ltr" />
                                                    )}
                                                    {!isBarter(entry.method) && (
                                                        <Select<'SYP' | 'USD'>
                                                            value={entry.currency}
                                                            onChange={(v) => updateEntry(idx, { currency: v, exchangeRate: v === 'SYP' ? '' : entry.exchangeRate })}
                                                            ariaLabel="العملة"
                                                            className="w-20"
                                                            options={[{ value: 'SYP', label: 'ل.س' }, { value: 'USD', label: 'USD' }]}
                                                        />
                                                    )}
                                                    <button type="button" onClick={() => deleteEntry(idx)}
                                                        className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>

                                                {/* Exchange rate row (USD only) */}
                                                {entry.currency === 'USD' && entry.paymentCategory !== 'barter' && (
                                                    <div className="flex gap-2 items-center">
                                                        <input
                                                            type="number" min={0} step="0.01"
                                                            value={entry.exchangeRate}
                                                            onChange={e => updateEntry(idx, { exchangeRate: e.target.value })}
                                                            placeholder="سعر الصرف (ل.س لكل $)"
                                                            className="flex-1 text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:border-orange-400 bg-orange-50/30 font-mono"
                                                            dir="ltr"
                                                        />
                                                        <span className="text-xs text-slate-500 shrink-0">
                                                            = {String(Math.round(Number(entry.amountValue) * Number(entry.exchangeRate || 0)))} ل.س
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Row 2: conditional sub-fields */}
                                                {entry.paymentCategory === 'transfer' && (
                                                    <div className="flex gap-2">
                                                        <Select<PaymentMethod>
                                                            value={entry.method}
                                                            onChange={(v) => updateEntry(idx, { method: v })}
                                                            ariaLabel="طريقة الدفع"
                                                            className="flex-1"
                                                            options={[
                                                                { value: 'sham_cash', label: 'شام كاش' },
                                                                { value: 'syriatel_cash', label: 'سيرياتيل كاش' },
                                                                { value: 'mtn_cash', label: 'MTN كاش' },
                                                                { value: 'alharam', label: 'الهرم' },
                                                                { value: 'bank_transfer', label: 'حوالة بنكية' },
                                                            ]}
                                                        />
                                                        <input type="text" value={entry.referenceNumber}
                                                            onChange={e => updateEntry(idx, { referenceNumber: e.target.value })}
                                                            placeholder="رقم الحوالة *"
                                                            className="flex-1 text-sm border border-orange-200 rounded-lg px-3 py-2 focus:outline-none focus:border-orange-400 bg-orange-50/30 font-mono" dir="ltr" />
                                                    </div>
                                                )}

                                                {entry.paymentCategory === 'barter' && (
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input type="text" value={entry.barterName}
                                                            onChange={e => updateEntry(idx, { barterName: e.target.value })}
                                                            placeholder="اسم المقايضة *"
                                                            className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400 bg-purple-50/30" />
                                                        <input type="number" min={0} value={entry.barterValueSyp}
                                                            onChange={e => updateEntry(idx, { barterValueSyp: e.target.value })}
                                                            placeholder="القيمة ل.س *"
                                                            className="w-full text-sm border border-purple-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400 bg-purple-50/30 font-mono" dir="ltr" />
                                                    </div>
                                                )}

                                                {/* Validation errors */}
                                                {entryErrors[idx] && entryErrors[idx].length > 0 && (
                                                    <div className="flex flex-col gap-1">
                                                        {entryErrors[idx].map((err, i) => (
                                                            <span key={i} className="text-xs text-red-600 flex items-center gap-1">
                                                                <AlertTriangle className="w-3 h-3" /> {err}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Confirm button */}
                                                <button type="button" onClick={() => confirmEntry(idx)}
                                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> تأكيد
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ))}

                                {/* Paid / Remaining summary */}
                                {grandTotal > 0 && (
                                    <div className={`rounded-xl border px-4 py-3 space-y-1.5 ${paymentsValid ? 'bg-emerald-50 border-emerald-200' : paymentEntries.length > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3 text-xs">
                                                <span className="text-slate-500">المدفوع: <strong className="font-mono text-slate-800">{formatPrice(totalPaidSyp)}</strong></span>
                                                <span className="text-slate-300">|</span>
                                                <span className={remainingAfterPayments > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                                                    الباقي: <strong className="font-mono">{formatPrice(Math.max(0, remainingAfterPayments))}</strong>
                                                </span>
                                            </div>
                                            {paymentsValid && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                                        </div>
                                        {!paymentsValid && paymentEntries.length > 0 && (
                                            <span className="text-xs text-red-600">
                                                {confirmedEntries.size < paymentEntries.length
                                                    ? `يوجد ${paymentEntries.length - confirmedEntries.size} دفعة غير مؤكدة`
                                                    : 'مجموع الدفعات لا يساوي الإجمالي'}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Validation error */}
                                {paymentType === 'cash' && grandTotal > 0 && paymentEntries.length > 0 && Math.abs(totalPaidSyp - grandTotal) > 1 && (
                                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                                        <AlertTriangle className="w-4 h-4 shrink-0" />
                                        مجموع الدفعات ({String(totalPaidSyp)}) لا يساوي الإجمالي ({String(grandTotal)})
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Installment schedule */}
                        {paymentType === 'installment' && (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="عدد الأقساط">
                                        <Select
                                            value={String(installmentCount)}
                                            onChange={setInstallmentCount}
                                            disabled={installmentsConfirmed || isOfferLocked}
                                            ariaLabel="عدد الأقساط"
                                            className="w-full"
                                            options={[3, 6, 9, 12, 18, 24].map(n => ({ value: String(n), label: `${n} أقساط` }))}
                                        />
                                    </Field>
                                    <div className="flex items-end">
                                        <button type="button" onClick={generateInstallments} disabled={grandTotal <= 0 || installmentsConfirmed || (hasDownPayment && totalPaidSyp <= 0)}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 transition-all text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                                            <Calculator className="w-4 h-4" /> توليد الجدول
                                        </button>
                                    </div>
                                </div>

                                {/* The schedule is computed on (الإجمالي − المقدم); the down
                                    payment value must be entered first so installments don't
                                    spread over the full total by mistake. */}
                                {hasDownPayment && totalPaidSyp <= 0 && (
                                    <p className="text-xs text-amber-600">
                                        أدخل قيمة الدفعة الأولى (المقدم) أولاً، ثم ولّد جدول الأقساط.
                                    </p>
                                )}

                                {installmentDrafts.length > 0 && (
                                    <div className="rounded-xl border border-slate-200 overflow-hidden">
                                        <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-100">
                                            <span className="text-xs font-bold text-slate-700">جدول الأقساط</span>
                                            {installmentsConfirmed
                                                ? <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">موثق</span>
                                                : <span className="text-xs text-slate-400">{installmentDrafts.length} قسط</span>
                                            }
                                        </div>
                                        <table className="w-full text-sm">
                                            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                                                <tr>
                                                    <th className="px-3 py-2 text-right">#</th>
                                                    <th className="px-3 py-2 text-right">تاريخ الاستحقاق</th>
                                                    <th className="px-3 py-2 text-right">المبلغ ل.س</th>
                                                    {!installmentsConfirmed && <th className="px-3 py-2" />}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {installmentDrafts.map((inst, idx) => (
                                                    <tr key={idx} className="hover:bg-slate-50/40">
                                                        <td className="px-3 py-2 text-slate-400 text-xs">{inst.installmentNumber}</td>
                                                        <td className="px-3 py-2">
                                                            {installmentsConfirmed
                                                                ? <span className="text-sm text-slate-700">{inst.dueDate}</span>
                                                                : <input type="date" value={inst.dueDate}
                                                                    onChange={e => setInstallmentDrafts(prev => prev.map((d, i) => i === idx ? { ...d, dueDate: e.target.value } : d))}
                                                                    className="text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-sky-400" />
                                                            }
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            {installmentsConfirmed
                                                                ? <span className="text-sm font-mono font-bold text-slate-800">{formatPrice(Number(inst.amountSyp))}</span>
                                                                : <input type="number" min={0} value={inst.amountSyp}
                                                                    onChange={e => setInstallmentDrafts(prev => prev.map((d, i) => i === idx ? { ...d, amountSyp: e.target.value } : d))}
                                                                    className="w-28 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-sky-400 font-mono" dir="ltr" />
                                                            }
                                                        </td>
                                                        {!installmentsConfirmed && (
                                                            <td className="px-3 py-2">
                                                                <button type="button" onClick={() => setInstallmentDrafts(prev => prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, installmentNumber: i + 1 })))}
                                                                    className="text-red-400 hover:text-red-600">
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="bg-slate-50 border-t border-slate-200 text-xs font-bold">
                                                <tr>
                                                    <td colSpan={2} className="px-3 py-2 text-slate-500">المجموع</td>
                                                    <td className="px-3 py-2 font-mono text-slate-800">{formatPrice(totalInstallmentSyp)}</td>
                                                    {!installmentsConfirmed && <td />}
                                                </tr>
                                            </tfoot>
                                        </table>
                                        {!installmentsConfirmed && (
                                            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
                                                <button type="button"
                                                    onClick={() => setInstallmentsConfirmed(true)}
                                                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> تأكيد الأقساط
                                                </button>
                                            </div>
                                        )}
                                        {installmentsConfirmed && (
                                            <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-200 flex items-center justify-center gap-1.5">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                                <span className="text-xs font-bold text-emerald-700">موثق ✓</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Installment validation */}
                                {grandTotal > 0 && installmentDrafts.length > 0 && Math.abs(totalInstallmentSyp + (hasDownPayment ? totalPaidSyp : 0) - grandTotal) > 1 && (
                                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                                        <AlertTriangle className="w-4 h-4 shrink-0" />
                                        مجموع الأقساط ({String(totalInstallmentSyp + (hasDownPayment ? totalPaidSyp : 0))}) لا يساوي الإجمالي ({String(grandTotal)})
                                    </div>
                                )}
                            </div>
                        )}
                    </Section>
                )}

                {/* Plan 2026-06-10 — Closing Section removed from the form.
                    The form now always saves as a draft; the closing employee
                    is chosen exclusively from the approval flow in
                    ContractDetail.tsx (which calls POST /contracts/:id/approve
                    with closingEmployeeId). Invoice notes moved to a small
                    optional input near the submit button. */}
                <Section title="ملاحظات الفاتورة" icon={CheckCircle2} defaultOpen={false}>
                    <Field label="ملاحظات الفاتورة (اختياري)">
                        <textarea
                            value={invoiceNotes}
                            onChange={e => setInvoiceNotes(e.target.value)}
                            rows={2}
                            className={`${inputClass} resize-none`}
                            placeholder="ملاحظات اختيارية..."
                        />
                    </Field>
                </Section>

                {/* Bottom spacer */}
                <div className="h-8" />
            </div>
        </div>
    );
}
