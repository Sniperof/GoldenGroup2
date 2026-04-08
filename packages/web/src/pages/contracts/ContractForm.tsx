import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FileText, ChevronDown, Search, Calendar, Monitor, Hash, Wrench,
    DollarSign, CreditCard, Banknote, Truck, Settings, Save,
    RotateCcw, CheckCircle2, User, Calculator, MapPin,
    AlertTriangle, ShieldCheck, ArrowRightLeft, Globe, Landmark,
    TableProperties, Sparkles, BadgeDollarSign,
    ExternalLink, Smartphone, Clipboard, Loader2
} from 'lucide-react';
import type { MaintenancePlan } from '../../lib/types';
import { api } from '../../lib/api';
import MapPicker from '../../components/MapPicker';
import GeoSmartSearch from '../../components/GeoSmartSearch';
import type { GeoSelection } from '../../components/GeoSmartSearch';

/* ------------------------------------------------------------------ */
/*  Customer type                                                       */
/* ------------------------------------------------------------------ */

interface MockCustomer {
    id: number;
    name: string;
    mobile: string;
    fatherName?: string;
    nationalId?: string;
}

/* ------------------------------------------------------------------ */
/*  Sale type config                                                    */
/* ------------------------------------------------------------------ */

type SaleType = 'marketing' | 'tradein' | 'app' | 'referral';
type OldDeviceCondition = 'good' | 'damaged';

const saleTypes: { value: SaleType; label: string; icon: any; desc: string; color: string; activeBg: string; activeBorder: string }[] = [
    { value: 'marketing', label: 'تسويق', icon: Globe, desc: 'من زيارة ميدانية', color: 'text-emerald-600', activeBg: 'bg-emerald-50', activeBorder: 'border-emerald-300' },
    { value: 'tradein', label: 'استبدال', icon: ArrowRightLeft, desc: 'تبديل جهاز قديم', color: 'text-purple-600', activeBg: 'bg-purple-50', activeBorder: 'border-purple-300' },
    { value: 'app', label: 'تطبيق', icon: Smartphone, desc: 'طلب من التطبيق', color: 'text-blue-600', activeBg: 'bg-blue-50', activeBorder: 'border-blue-300' },
    { value: 'referral', label: 'تزكية', icon: User, desc: 'إحالة من زبون', color: 'text-amber-600', activeBg: 'bg-amber-50', activeBorder: 'border-amber-300' },
];

/* Mock source visits for "Marketing" type */
interface SourceVisit {
    id: string;
    date: string;
    employee: string;
    area: string;
}
const mockSourceVisits: SourceVisit[] = [
    { id: 'VST-2026-0042', date: '2026-02-15', employee: 'أحمد علي', area: 'حي المنصور' },
    { id: 'VST-2026-0039', date: '2026-02-12', employee: 'محمد جاسم', area: 'الكرادة' },
    { id: 'VST-2026-0035', date: '2026-02-10', employee: 'فاطمة نور', area: 'الكاظمية' },
    { id: 'VST-2026-0031', date: '2026-02-08', employee: 'ليلى أحمد', area: 'الداوودي' },
];

type Currency = 'SYP' | 'USD';

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
        <div className={`bg-white rounded-xl border shadow-sm ${status ? statusColors[status] : 'border-gray-200'}`}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 px-5 py-4 text-right hover:bg-gray-50/50 transition-colors"
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
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
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
            {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
        </div>
    );
}

const inputClass = "w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder:text-gray-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 focus:outline-none transition-all";
const selectClass = "w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 focus:outline-none transition-all appearance-none cursor-pointer";

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function ContractForm() {
    // ─── API Data ───
    const [customers, setCustomers] = useState<MockCustomer[]>([]);
    const [deviceModels, setDeviceModels] = useState<any[]>([]);
    const [geoUnits, setGeoUnits] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([
            api.clients.list(),
            api.deviceModels.list(),
            api.geoUnits.list(),
        ])
            .then(([clientsData, modelsData, geoData]) => {
                setCustomers(clientsData.map((c: any) => ({
                    id: c.id,
                    name: c.name,
                    mobile: c.mobile || c.phone || '',
                    fatherName: c.fatherName,
                    nationalId: c.nationalId,
                })));
                setDeviceModels(modelsData);
                setGeoUnits(geoData);
            })
            .catch(err => console.error('Failed to load form data:', err))
            .finally(() => setLoading(false));
    }, []);

    // ─── 1. Customer & Legal ───
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<MockCustomer | null>(null);
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [fatherNameOverride, setFatherNameOverride] = useState('');
    const [nationalIdOverride, setNationalIdOverride] = useState('');

    // ─── 2. Sale Details ───
    const [saleType, setSaleType] = useState<SaleType>('marketing');
    const [contractDate, setContractDate] = useState(new Date().toISOString().slice(0, 10));
    // Marketing context
    const [sourceVisitId, setSourceVisitId] = useState('');
    // Trade-in context
    const [oldContractNumber, setOldContractNumber] = useState('');
    const [oldDeviceCondition, setOldDeviceCondition] = useState<OldDeviceCondition>('good');
    // App context
    const [appRequestId, setAppRequestId] = useState('');
    // Referral context
    const [referrerName, setReferrerName] = useState('');

    // ─── 3. Device & Location ───
    const [deviceModelId, setDeviceModelId] = useState<number | ''>('');
    const [serialNumber, setSerialNumber] = useState('');
    const [maintenancePlan, setMaintenancePlan] = useState<MaintenancePlan>('6');
    // Geo — single smart search
    const [geoSelection, setGeoSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
    const [detailedAddress, setDetailedAddress] = useState('');
    const [mapPosition, setMapPosition] = useState<[number, number] | null>(null);

    // ─── 4. Financials ───
    const [currency, setCurrency] = useState<Currency>('SYP');
    const [priceOverride, setPriceOverride] = useState('');
    const [paymentType, setPaymentType] = useState<'cash' | 'installment'>('cash');
    const [downPayment, setDownPayment] = useState('');
    const [installmentsCount, setInstallmentsCount] = useState('6');
    const [schedule, setSchedule] = useState<{ date: string; amount: number }[]>([]);
    const [showSchedule, setShowSchedule] = useState(false);

    // ─── Computed ───
    const selectedDevice = useMemo(() => deviceModels.find(d => d.id === deviceModelId) || null, [deviceModelId, deviceModels]);
    const basePrice = selectedDevice?.basePrice || 0;
    const finalPrice = priceOverride ? parseInt(priceOverride, 10) || basePrice : basePrice;

    const remainingAmount = useMemo(() => {
        if (paymentType !== 'installment') return 0;
        return Math.max(0, finalPrice - (parseInt(downPayment, 10) || 0));
    }, [paymentType, downPayment, finalPrice]);

    const monthlyInstallment = useMemo(() => {
        const count = parseInt(installmentsCount, 10) || 1;
        return count > 0 ? Math.ceil(remainingAmount / count) : 0;
    }, [remainingAmount, installmentsCount]);

    // Geo — handled by GeoSmartSearch component

    // Customer search
    const filteredCustomers = useMemo(
        () => customers.filter(c => c.name.includes(customerSearch) || c.mobile.includes(customerSearch)),
        [customerSearch, customers]
    );

    // Legal info missing?
    const needsFatherName = selectedCustomer && !selectedCustomer.fatherName;
    const needsNationalId = selectedCustomer && !selectedCustomer.nationalId;
    const legalMissing = needsFatherName || needsNationalId;
    const legalResolved = (!needsFatherName || fatherNameOverride.trim().length > 0) && (!needsNationalId || nationalIdOverride.trim().length > 0);

    const currencySymbol = currency === 'SYP' ? 'ل.س' : '$';
    const formatPrice = (n: number) => `${n.toLocaleString('ar-SY')} ${currencySymbol}`;

    // ─── Generate schedule ───
    const generateSchedule = useCallback(() => {
        const count = parseInt(installmentsCount, 10) || 1;
        if (count <= 0 || remainingAmount <= 0) return;
        const monthly = Math.floor(remainingAmount / count);
        const lastMonth = remainingAmount - monthly * (count - 1);
        const baseDate = new Date(contractDate);
        const items: { date: string; amount: number }[] = [];
        for (let i = 0; i < count; i++) {
            const d = new Date(baseDate);
            d.setMonth(d.getMonth() + i + 1);
            items.push({ date: d.toISOString().slice(0, 10), amount: i === count - 1 ? lastMonth : monthly });
        }
        setSchedule(items);
        setShowSchedule(true);
    }, [installmentsCount, remainingAmount, contractDate]);

    // ─── Validity ───
    const isValid = useMemo(() => {
        if (!selectedCustomer) return false;
        if (legalMissing && !legalResolved) return false;
        if (!deviceModelId) return false;
        if (!serialNumber.trim()) return false;
        if (!geoSelection.govId || !geoSelection.neighborhoodId) return false;
        return true;
    }, [selectedCustomer, legalMissing, legalResolved, deviceModelId, serialNumber, geoSelection]);

    const handleSubmit = useCallback(async () => {
        if (!isValid || saving) return;
        setSaving(true);
        try {
            await api.contracts.create({
                customerId: selectedCustomer?.id,
                customerName: selectedCustomer?.name,
                deviceModelId,
                deviceModelName: selectedDevice?.name,
                serialNumber,
                maintenancePlan,
                contractDate,
                saleType,
                paymentType,
                finalPrice,
                downPayment: parseInt(downPayment, 10) || 0,
                installmentsCount: parseInt(installmentsCount, 10) || 0,
                currency,
                geoSelection,
                detailedAddress,
                mapPosition,
                fatherName: fatherNameOverride || selectedCustomer?.fatherName,
                nationalId: nationalIdOverride || selectedCustomer?.nationalId,
            });
            alert('تم حفظ العقد بنجاح ✅');
        } catch (err) {
            console.error('Failed to save contract:', err);
            alert('فشل في حفظ العقد ❌');
        } finally {
            setSaving(false);
        }
    }, [isValid, saving, selectedCustomer, deviceModelId, selectedDevice, serialNumber, maintenancePlan, contractDate, saleType, paymentType, finalPrice, downPayment, installmentsCount, currency, geoSelection, detailedAddress, mapPosition, fatherNameOverride, nationalIdOverride]);

    const handleReset = () => {
        setSelectedCustomer(null); setCustomerSearch(''); setFatherNameOverride(''); setNationalIdOverride('');
        setSaleType('marketing'); setContractDate(new Date().toISOString().slice(0, 10));
        setSourceVisitId(''); setOldContractNumber(''); setOldDeviceCondition('good'); setAppRequestId(''); setReferrerName('');
        setDeviceModelId(''); setSerialNumber(''); setMaintenancePlan('6');
        setGeoSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
        setDetailedAddress(''); setMapPosition(null);
        setCurrency('SYP'); setPriceOverride(''); setPaymentType('cash'); setDownPayment('');
        setInstallmentsCount('6'); setSchedule([]); setShowSchedule(false);
    };

    const handleLocationSelect = useCallback((lat: number, lng: number) => {
        if (lat === 0 && lng === 0) { setMapPosition(null); } else { setMapPosition([lat, lng]); }
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
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
                            <h1 className="text-lg font-bold text-slate-800">عقد جديد</h1>
                            <p className="text-xs text-slate-400">تسجيل عقد بيع وصيانة جديد</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleReset} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-200 text-slate-600 hover:bg-gray-50 text-sm font-medium transition-colors">
                            <RotateCcw className="w-4 h-4" /><span>إعادة تعيين</span>
                        </button>
                        <button onClick={handleSubmit} disabled={!isValid || saving}
                            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-bold transition-colors shadow-sm disabled:shadow-none">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}<span>{saving ? 'جاري الحفظ...' : 'حفظ العقد'}</span>
                        </button>
                    </div>
                </div>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 1. CUSTOMER & LEGAL INFO                               */}
                {/* ═══════════════════════════════════════════════════════ */}
                <Section
                    title="بيانات الزبون والهوية"
                    icon={ShieldCheck}
                    status={selectedCustomer ? (legalMissing && !legalResolved ? 'warning' : 'valid') : undefined}
                    badge={selectedCustomer && legalMissing && !legalResolved ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> بيانات ناقصة
                        </span>
                    ) : undefined}
                >
                    {/* Customer Search */}
                    <Field label="اختر الزبون" required>
                        <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowCustomerDropdown(false); }}>
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                                <input
                                    type="text"
                                    value={selectedCustomer ? selectedCustomer.name : customerSearch}
                                    onChange={e => { setCustomerSearch(e.target.value); setSelectedCustomer(null); setShowCustomerDropdown(true); setFatherNameOverride(''); setNationalIdOverride(''); }}
                                    onFocus={() => setShowCustomerDropdown(true)}
                                    placeholder="بحث بالاسم أو رقم الموبايل..."
                                    className={`${inputClass} pr-10`}
                                />
                            </div>
                            {showCustomerDropdown && !selectedCustomer && (
                                <div className="absolute z-50 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                                    {filteredCustomers.length === 0 ? (
                                        <div className="p-3 text-center text-sm text-slate-400">لا يوجد نتائج</div>
                                    ) : (
                                        filteredCustomers.map(c => (
                                            <button key={c.id} type="button"
                                                className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-b-0"
                                                onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setShowCustomerDropdown(false); setFatherNameOverride(''); setNationalIdOverride(''); }}>
                                                <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center">
                                                    <User className="w-4 h-4 text-sky-600" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                                                    <p className="text-[11px] text-slate-400" dir="ltr">{c.mobile}</p>
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

                    {/* Conditional Legal Fields */}
                    <AnimatePresence>
                        {selectedCustomer && legalMissing && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                                        <span className="text-xs font-bold text-amber-700">بيانات قانونية مطلوبة للعقد</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {needsFatherName && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-semibold text-amber-700">اسم الأب <span className="text-red-400">*</span></label>
                                                <input type="text" value={fatherNameOverride} onChange={e => setFatherNameOverride(e.target.value)}
                                                    placeholder="مطلوب لإتمام العقد"
                                                    className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm placeholder:text-amber-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/10 focus:outline-none" />
                                            </div>
                                        )}
                                        {needsNationalId && (
                                            <div className="space-y-1">
                                                <label className="text-[11px] font-semibold text-amber-700">رقم الهوية الوطنية <span className="text-red-400">*</span></label>
                                                <input type="text" value={nationalIdOverride} onChange={e => setNationalIdOverride(e.target.value)}
                                                    placeholder="مطلوب لإتمام العقد" dir="ltr"
                                                    className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-amber-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/10 focus:outline-none" />
                                            </div>
                                        )}
                                    </div>
                                    {legalResolved && (
                                        <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
                                            <CheckCircle2 className="w-3.5 h-3.5" /><span>تم استكمال البيانات ✓</span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </Section>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 2. SALE DETAILS                                         */}
                {/* ═══════════════════════════════════════════════════════ */}
                <Section title="تفاصيل البيع" icon={Landmark}>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="نوع البيع" required>
                            <div className="grid grid-cols-4 gap-2">
                                {saleTypes.map(st => {
                                    const isActive = saleType === st.value;
                                    return (
                                        <button key={st.value} type="button"
                                            onClick={() => setSaleType(st.value)}
                                            className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl border-2 transition-all ${isActive
                                                ? `${st.activeBg} ${st.activeBorder} ${st.color} shadow-sm`
                                                : 'bg-white border-gray-200 text-slate-500 hover:border-gray-300'}`}>
                                            <st.icon className="w-4 h-4" />
                                            <span className="text-[11px] font-bold">{st.label}</span>
                                            <span className={`text-[9px] ${isActive ? 'opacity-70' : 'text-slate-400'}`}>{st.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </Field>

                        <Field label="تاريخ العقد" required>
                            <div className="relative">
                                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                                <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} className={`${inputClass} pr-10`} />
                            </div>
                        </Field>
                    </div>

                    {/* ──── Dynamic context fields per sale type ──── */}
                    <AnimatePresence mode="wait">
                        {/* MARKETING → Source Visit Dropdown */}
                        {saleType === 'marketing' && (
                            <motion.div key="marketing" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Globe className="w-4 h-4 text-emerald-600" />
                                        <span className="text-xs font-bold text-emerald-700">سياق الزيارة التسويقية</span>
                                    </div>
                                    <Field label="الزيارة المصدر" required>
                                        <select value={sourceVisitId} onChange={e => setSourceVisitId(e.target.value)}
                                            className="w-full bg-white border border-emerald-200 rounded-lg px-3 py-2.5 text-sm focus:border-emerald-400 focus:outline-none cursor-pointer">
                                            <option value="">اختر زيارة...</option>
                                            {mockSourceVisits.map(v => (
                                                <option key={v.id} value={v.id}>
                                                    {v.id} — {v.employee} — {v.area} ({v.date})
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    {sourceVisitId && (
                                        <div className="flex items-center gap-2 text-[11px] text-emerald-600 bg-emerald-100/50 rounded-lg px-3 py-2 border border-emerald-200/50">
                                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                            <span>الزيارة مرتبطة: <strong className="font-mono">{sourceVisitId}</strong></span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* TRADE-IN → Old Contract + Device Condition */}
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
                                                        : 'bg-white border-gray-200 text-slate-500 hover:border-gray-300'}`}>
                                                    <CheckCircle2 className="w-3.5 h-3.5" /><span>بحالة جيدة</span>
                                                </button>
                                                <button type="button" onClick={() => setOldDeviceCondition('damaged')}
                                                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 text-xs font-bold transition-all ${oldDeviceCondition === 'damaged'
                                                        ? 'bg-red-50 border-red-300 text-red-700 shadow-sm'
                                                        : 'bg-white border-gray-200 text-slate-500 hover:border-gray-300'}`}>
                                                    <AlertTriangle className="w-3.5 h-3.5" /><span>تالف</span>
                                                </button>
                                            </div>
                                        </Field>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* APP → App Request ID */}
                        {saleType === 'app' && (
                            <motion.div key="app" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Smartphone className="w-4 h-4 text-blue-600" />
                                        <span className="text-xs font-bold text-blue-700">ربط بطلب التطبيق</span>
                                    </div>
                                    <Field label="رقم الطلب من التطبيق" required>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <Hash className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300 pointer-events-none" />
                                                <input type="text" value={appRequestId} onChange={e => setAppRequestId(e.target.value)}
                                                    placeholder="APP-REQ-XXXX" dir="ltr"
                                                    className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2.5 pr-10 text-sm font-mono placeholder:text-blue-300 focus:border-blue-400 focus:outline-none" />
                                            </div>
                                            <button type="button" disabled={!appRequestId}
                                                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-100 text-blue-700 hover:bg-blue-200 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                                onClick={() => window.open(`#/app-requests/${appRequestId}`, '_blank')}>
                                                <ExternalLink className="w-3.5 h-3.5" />
                                                <span>فتح الطلب</span>
                                            </button>
                                        </div>
                                    </Field>
                                    {appRequestId && (
                                        <div className="flex items-center gap-2 text-[11px] text-blue-600 bg-blue-100/50 rounded-lg px-3 py-2 border border-blue-200/50">
                                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                            <span>الطلب مرتبط: <strong className="font-mono">{appRequestId}</strong></span>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* REFERRAL → Referrer Name */}
                        {saleType === 'referral' && (
                            <motion.div key="referral" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                                <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <User className="w-4 h-4 text-amber-600" />
                                        <span className="text-xs font-bold text-amber-700">بيانات الإحالة</span>
                                    </div>
                                    <Field label="اسم المُحيل (الزبون / الوسيط)" required>
                                        <div className="relative">
                                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-300 pointer-events-none" />
                                            <input type="text" value={referrerName} onChange={e => setReferrerName(e.target.value)}
                                                placeholder="ابحث أو أدخل الاسم..."
                                                className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2.5 pr-10 text-sm placeholder:text-amber-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/10 focus:outline-none" />
                                        </div>
                                    </Field>
                                    {referrerName && (
                                        <div className="flex items-center gap-2 text-[11px] text-amber-600 bg-amber-100/50 rounded-lg px-3 py-2 border border-amber-200/50">
                                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                            <span>المُحيل: <strong>{referrerName}</strong></span>
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
                <Section title="الجهاز وعنوان التركيب" icon={Monitor} badge={
                    selectedDevice && (
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
                            {selectedDevice.brand}
                        </span>
                    )
                }>
                    {/* Device Row */}
                    <div className="grid grid-cols-3 gap-4">
                        <Field label="موديل الجهاز" required>
                            <select value={deviceModelId} onChange={e => { setDeviceModelId(Number(e.target.value) || ''); setPriceOverride(''); }} className={selectClass}>
                                <option value="">اختر الموديل...</option>
                                {deviceModels.map(d => (
                                    <option key={d.id} value={d.id}>{d.name} — {d.brand}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="الرقم التسلسلي" required>
                            <div className="relative">
                                <Hash className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                                <input type="text" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} placeholder="SN-XXXXX" className={`${inputClass} pr-10 font-mono`} dir="ltr" />
                            </div>
                        </Field>
                        <Field label="خطة الصيانة">
                            <div className="flex gap-1.5">
                                {([['3', '3 أشهر'], ['6', '6 أشهر'], ['12', '12 شهر']] as const).map(([val, label]) => (
                                    <button key={val} type="button" onClick={() => setMaintenancePlan(val as MaintenancePlan)}
                                        className={`flex-1 px-2 py-2.5 rounded-lg border text-xs font-medium transition-all ${maintenancePlan === val
                                            ? 'bg-sky-50 border-sky-300 text-sky-700 shadow-sm'
                                            : 'bg-white border-gray-200 text-slate-600 hover:border-gray-300'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </Field>
                    </div>

                    {/* Smart Geo Search */}
                    <GeoSmartSearch
                        geoUnits={geoUnits}
                        value={geoSelection}
                        onChange={setGeoSelection}
                        label="عنوان التركيب"
                        required
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
                            {mapPosition && (
                                <span className="text-[10px] font-mono text-slate-400" dir="ltr">
                                    {mapPosition[0].toFixed(5)}, {mapPosition[1].toFixed(5)}
                                </span>
                            )}
                        </div>
                        <MapPicker position={mapPosition} onLocationSelect={handleLocationSelect} />
                    </div>
                </Section>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* 4. FINANCIALS                                           */}
                {/* ═══════════════════════════════════════════════════════ */}
                <Section title="الخطة المالية" icon={BadgeDollarSign} badge={
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${paymentType === 'cash'
                        ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                        : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                        {paymentType === 'cash' ? 'نقدي' : 'أقساط'}
                    </span>
                }>
                    {/* Currency Toggle */}
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">العملة</span>
                        <div className="flex bg-gray-100 p-0.5 rounded-lg">
                            {(['SYP', 'USD'] as const).map(cur => (
                                <button key={cur} type="button" onClick={() => setCurrency(cur)}
                                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${currency === cur
                                        ? 'bg-white shadow-sm text-sky-600'
                                        : 'text-slate-500 hover:text-slate-700'}`}>
                                    {cur === 'SYP' ? '🇸🇾 ل.س' : '🇺🇸 USD'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Price */}
                    <Field label="السعر النهائي" hint={selectedDevice ? `السعر الأساسي: ${formatPrice(basePrice)}` : undefined}>
                        <div className="relative">
                            <DollarSign className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                            <input type="text"
                                value={priceOverride || (selectedDevice ? basePrice.toLocaleString('ar-SY') : '')}
                                onChange={e => setPriceOverride(e.target.value.replace(/[^\d]/g, ''))}
                                placeholder="السعر النهائي" className={`${inputClass} pr-10 font-mono`} dir="ltr" />
                        </div>
                    </Field>

                    {/* Payment Type Toggle */}
                    <div className="flex gap-3">
                        <button type="button" onClick={() => setPaymentType('cash')}
                            className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-4 rounded-xl border-2 transition-all ${paymentType === 'cash'
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm'
                                : 'bg-white border-gray-200 text-slate-500 hover:border-gray-300'}`}>
                            <Banknote className="w-5 h-5" /><span className="text-sm font-bold">نقدي</span>
                        </button>
                        <button type="button" onClick={() => { setPaymentType('installment'); setShowSchedule(false); setSchedule([]); }}
                            className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-4 rounded-xl border-2 transition-all ${paymentType === 'installment'
                                ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm'
                                : 'bg-white border-gray-200 text-slate-500 hover:border-gray-300'}`}>
                            <CreditCard className="w-5 h-5" /><span className="text-sm font-bold">أقساط</span>
                        </button>
                    </div>

                    {/* Installment Details */}
                    <AnimatePresence>
                        {paymentType === 'installment' && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="space-y-4 pt-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <Field label="الدفعة المقدمة" required>
                                            <div className="relative">
                                                <DollarSign className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                                                <input type="text" value={downPayment} onChange={e => { setDownPayment(e.target.value.replace(/[^\d]/g, '')); setShowSchedule(false); }}
                                                    placeholder="0" className={`${inputClass} pr-10 font-mono`} dir="ltr" />
                                            </div>
                                        </Field>
                                        <Field label="عدد الأقساط">
                                            <select value={installmentsCount} onChange={e => { setInstallmentsCount(e.target.value); setShowSchedule(false); }} className={selectClass}>
                                                {[3, 6, 9, 12, 18, 24].map(n => <option key={n} value={n}>{n} أقساط</option>)}
                                            </select>
                                        </Field>
                                    </div>

                                    {/* Auto-calculated summary */}
                                    <div className="bg-gradient-to-l from-sky-50 to-sky-100/50 rounded-xl border border-sky-200 p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <Calculator className="w-4 h-4 text-sky-600" />
                                                <span className="text-xs font-bold text-sky-700">الحساب التلقائي</span>
                                            </div>
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-sky-100 text-sky-600 font-mono">{currency}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="bg-white rounded-lg border border-sky-200/50 p-3 text-center">
                                                <p className="text-[10px] text-slate-400 mb-1">المبلغ الإجمالي</p>
                                                <p className="text-sm font-black text-slate-800" dir="ltr">{formatPrice(finalPrice)}</p>
                                            </div>
                                            <div className="bg-white rounded-lg border border-sky-200/50 p-3 text-center">
                                                <p className="text-[10px] text-slate-400 mb-1">المتبقي</p>
                                                <p className="text-sm font-black text-amber-600" dir="ltr">{formatPrice(remainingAmount)}</p>
                                            </div>
                                            <div className="bg-white rounded-lg border border-sky-200/50 p-3 text-center">
                                                <p className="text-[10px] text-slate-400 mb-1">القسط الشهري</p>
                                                <p className="text-sm font-black text-sky-600" dir="ltr">{formatPrice(monthlyInstallment)}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Generate Schedule Button */}
                                    <button type="button" onClick={generateSchedule} disabled={remainingAmount <= 0}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-sky-300 text-sky-600 hover:bg-sky-50 hover:border-sky-400 transition-all font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                                        <TableProperties className="w-4 h-4" />
                                        <span>توليد جدول الأقساط</span>
                                        <Sparkles className="w-3.5 h-3.5" />
                                    </button>

                                    {/* Schedule Table */}
                                    <AnimatePresence>
                                        {showSchedule && schedule.length > 0 && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                                    <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
                                                        <span className="text-xs font-bold text-slate-700">جدول الأقساط</span>
                                                        <span className="text-[10px] text-slate-400">{schedule.length} قسط</span>
                                                    </div>
                                                    <div className="max-h-60 overflow-y-auto">
                                                        <table className="w-full text-sm">
                                                            <thead className="bg-gray-50 sticky top-0">
                                                                <tr>
                                                                    <th className="text-right px-4 py-2 text-[11px] font-bold text-slate-500">#</th>
                                                                    <th className="text-right px-4 py-2 text-[11px] font-bold text-slate-500">تاريخ الاستحقاق</th>
                                                                    <th className="text-left px-4 py-2 text-[11px] font-bold text-slate-500">المبلغ</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {schedule.map((item, idx) => (
                                                                    <tr key={idx} className="border-t border-gray-50 hover:bg-sky-50/30 transition-colors">
                                                                        <td className="px-4 py-2.5">
                                                                            <span className="w-5 h-5 rounded-full bg-sky-100 text-sky-600 text-[10px] font-bold inline-flex items-center justify-center">{idx + 1}</span>
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-slate-700 text-sm">
                                                                            {new Date(item.date + 'T00:00:00').toLocaleDateString('ar-SY', { year: 'numeric', month: 'long', day: 'numeric' })}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 text-left font-mono font-bold text-slate-800 text-sm" dir="ltr">
                                                                            {formatPrice(item.amount)}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                            <tfoot className="bg-sky-50 border-t border-sky-200">
                                                                <tr>
                                                                    <td colSpan={2} className="px-4 py-2.5 text-xs font-bold text-sky-700">المجموع</td>
                                                                    <td className="px-4 py-2.5 text-left font-mono font-black text-sky-700 text-sm" dir="ltr">
                                                                        {formatPrice(schedule.reduce((s, i) => s + i.amount, 0))}
                                                                    </td>
                                                                </tr>
                                                            </tfoot>
                                                        </table>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Cash summary */}
                    {paymentType === 'cash' && finalPrice > 0 && (
                        <div className="flex items-center justify-between bg-emerald-50 rounded-xl border border-emerald-200 p-4">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                <span className="text-sm font-bold text-emerald-700">دفع نقدي كامل</span>
                            </div>
                            <span className="text-sm font-black text-emerald-700" dir="ltr">{formatPrice(finalPrice)}</span>
                        </div>
                    )}
                </Section>

                {/* Bottom spacer */}
                <div className="h-8" />
            </div>
        </div>
    );
}
