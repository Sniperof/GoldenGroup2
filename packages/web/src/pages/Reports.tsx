import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, type ReportCatalogGroup, type ReportFilterOptions, type TabularReportResponse, type TabularReportRunResponse } from '../lib/api';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { GeoCascadeFields, useGeoCascade } from '../components/filters/GeoCascadeFilter';
import Select from '../components/ui/Select';
import Checkbox from '../components/ui/Checkbox';
import DateField from '../components/ui/DateField';
import Modal from '../components/ui/Modal';
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FolderOpen, Info, Loader2, RotateCcw, ShieldCheck } from '../components/ui/icons';
import { normalizeReportFilterOptions } from '../lib/reportFilterOptions';
import { formatReportTemporalValue } from '../lib/reportValues';

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="px-1 text-[11px] font-bold text-slate-500">{label}</label>{children}</div>;
}

function SelectFilter(props: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <FilterField label={props.label}><Select className="w-full" value={props.value} ariaLabel={props.label} onChange={props.onChange} options={props.options} /></FilterField>;
}

/**
 * Multi-value filter: the selected ids drive both the query and the columns the run
 * emits, so the control shows exactly what was picked and keeps the order stable.
 */
/**
 * Folds the Arabic letter shapes that users type interchangeably, so «اكوانوفا»
 * matches «أكوانوفا» and a stray tashkeel mark never hides a real option.
 */
function foldForSearch(value: string) {
  return value.toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function MultiSelectFilter(props: {
  label: string; values: string[]; onChange: (values: string[]) => void;
  options: Array<{ value: string; label: string }>;
}) {
  // The query narrows the list on screen only. It is component state on purpose, so
  // typing in it never marks the generated snapshot stale — it filters no data.
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // The menu stays open while several devices are ticked; only a click outside or
  // Escape closes it, so picking five models is five clicks and not five reopenings.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  const selected = new Set(props.values);
  const folded = foldForSearch(query);
  const visible = folded ? props.options.filter(option => foldForSearch(option.label).includes(folded)) : props.options;
  const visibleValues = visible.map(option => option.value);
  const allVisibleSelected = visibleValues.length > 0 && visibleValues.every(value => selected.has(value));
  return <FilterField label={props.label}>
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        className="group inline-flex h-[39px] w-full items-center justify-between gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      >
        <span className={`truncate ${props.values.length === 0 ? 'font-medium text-slate-400' : ''}`}>
          {props.values.length === 0 ? 'اختر أجهزة' : `${props.values.length} من ${props.options.length} جهازًا`}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div role="listbox" className="absolute top-full z-30 mt-1.5 w-full min-w-[16rem] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="تصفية القائمة بالاسم"
          aria-label={`تصفية قائمة ${props.label} بالاسم`}
          className="mb-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[11px] outline-none focus:border-teal-500"
        />
        <div className="flex items-center gap-1 pb-1 text-[10px] font-bold">
          <button
            type="button"
            disabled={visibleValues.length === 0 || allVisibleSelected}
            onClick={() => props.onChange(Array.from(new Set([...props.values, ...visibleValues])))}
            className="rounded-md px-1.5 py-0.5 text-teal-700 hover:bg-teal-50 disabled:text-slate-300 disabled:hover:bg-transparent"
          >{folded ? `تأشير الظاهر (${visibleValues.length})` : `تأشير الكل (${visibleValues.length})`}</button>
          <button
            type="button"
            disabled={props.values.length === 0}
            onClick={() => props.onChange([])}
            className="rounded-md px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
          >إلغاء التأشير ({props.values.length})</button>
        </div>
        <div className="max-h-56 overflow-y-auto">
          {props.options.length === 0
            ? <p className="px-1 py-1 text-[11px] text-slate-400">لا أجهزة في الكتالوج</p>
            : visible.length === 0
              ? <p className="px-1 py-1 text-[11px] text-slate-400">لا اسم يطابق «{query}»</p>
              : visible.map(option => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <Checkbox
                    checked={selected.has(option.value)}
                    onCheckedChange={checked => props.onChange(checked
                      ? [...props.values, option.value]
                      : props.values.filter(value => value !== option.value))}
                  />
                  <span className="truncate">{option.label}</span>
                </label>)}
        </div>
      </div>}
    </div>
  </FilterField>;
}

function displayValue(value: unknown, type: 'text' | 'integer' | 'decimal' | 'date' | 'datetime' | 'link') {
  if (value == null || value === '') return '—';
  if (type === 'integer') return Number(value).toLocaleString('ar-SY');
  if (type === 'decimal') return Number(value).toLocaleString('ar-SY', { maximumFractionDigits: 2 });
  if (type === 'date' || type === 'datetime') return formatReportTemporalValue(value, type) ?? String(value);
  if (type === 'link') return <a href={String(value)} target="_blank" rel="noreferrer" className="font-bold text-teal-700 underline decoration-teal-300 underline-offset-4 hover:text-teal-900">فتح الموقع</a>;
  return String(value);
}

function todayYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Declared, not silent: the server refuses more than this and the label says so. */
const MAX_REPORT_DEVICE_MODELS = 10;

const EMPTY_FILTER_OPTIONS: ReportFilterOptions = {
  supervisors: [], technicians: [], telemarketers: [], visitStatuses: [],
  taskTypes: [],
  deviceModels: [], deviceStatuses: [], warrantyStatuses: [], customerRatings: [], contactEmployees: [],
  candidateStatuses: [], accompanyingTechnicians: [], giftPromiseStatuses: [],
  contractStatuses: [], contractSellers: [], contractSellerDepartments: [], contractSales: [],
  departmentTypes: [], callEmployees: [], callOutcomes: [],
  collectionOwners: [], saleClosers: [],
  faultTypes: [], repairTechnicians: [], retrievalTechnicians: [], retrievedDeviceStatuses: [],
  giftDefinitions: [],
};

const EXECUTION_STAGE_OPTIONS = [
  { value: 'all', label: 'كل مراحل التنفيذ' },
  { value: 'pending_delivery', label: 'بانتظار التسليم' },
  { value: 'delivered', label: 'مسلَّم بانتظار التركيب' },
  { value: 'installed', label: 'مركَّب بانتظار التشغيل' },
  { value: 'activated', label: 'مشغَّل' },
];

const SALE_TYPE_OPTIONS = [
  { value: 'all', label: 'كل أنواع البيعات' },
  { value: 'direct', label: 'بيع مباشر' },
  { value: 'tradein', label: 'استبدال' },
  { value: 'retention', label: 'احتفاظ' },
];

const SALE_SUBTYPE_OPTIONS = [
  { value: 'all', label: 'كل صفات البيعات' },
  { value: 'definitive', label: 'نهائية' },
  { value: 'temporary', label: 'مؤقتة' },
  { value: 'free', label: 'مجانية' },
];

const REMAINING_BALANCE_OPTIONS = [
  { value: 'all', label: 'كل البيعات' },
  { value: 'with_remaining', label: 'عليها متبقٍّ' },
  { value: 'settled', label: 'مسدَّدة بالكامل' },
];

const PAYMENT_TYPE_OPTIONS = [
  { value: 'all', label: 'كل طرائق الدفع' },
  { value: 'cash', label: 'نقدي' },
  { value: 'installment', label: 'تقسيط' },
];

const COLLECTION_RESULT_OPTIONS = [
  { value: 'all', label: 'كل النتائج' },
  { value: 'paid_full', label: 'تم التسديد بالكامل' },
  { value: 'paid_partial', label: 'تم التسديد جزئياً' },
  { value: 'rescheduled', label: 'أعيد تحديد الموعد' },
  { value: 'refused_to_pay', label: 'رفض التسديد' },
  { value: 'none', label: 'بدون نتيجة مسجلة' },
];

const FAULT_STATUS_OPTIONS = [
  { value: 'all', label: 'كل حالات الأعطال' },
  { value: 'reported', label: 'مُبلّغ' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'resolved_at_intake', label: 'محلول عند الاستلام' },
  { value: 'resolved', label: 'محلول' },
  { value: 'deferred', label: 'مؤجل' },
  { value: 'unresolvable_field', label: 'متعذر الحل ميدانيًا' },
  { value: 'cancelled', label: 'ملغى' },
];

const FAULT_DISCOVERY_PHASE_OPTIONS = [
  { value: 'all', label: 'كل مراحل الاكتشاف' },
  { value: 'intake', label: 'الاستقبال' },
  { value: 'in_review', label: 'المراجعة' },
  { value: 'technical_consultation', label: 'الاستشارة الفنية' },
  { value: 'field_discovery', label: 'اكتشاف ميداني' },
];

const FAULT_DURATION_OPTIONS = [
  { value: 'all', label: 'كل مدد المعالجة' },
  { value: 'same_day', label: 'في اليوم نفسه' },
  { value: 'one_to_three', label: 'من يوم إلى 3 أيام' },
  { value: 'four_to_seven', label: 'من 4 إلى 7 أيام' },
  { value: 'over_seven', label: 'أكثر من 7 أيام' },
];

const FAULT_PARTS_USAGE_OPTIONS = [
  { value: 'all', label: 'الكل' },
  { value: 'yes', label: 'توجد قطع مرتبطة' },
  { value: 'no', label: 'لا توجد قطع مرتبطة' },
];

const RETRIEVAL_PURPOSE_OPTIONS = [
  { value: 'all', label: 'كل أغراض السحب' },
  { value: 'maintenance', label: 'صيانة وإرجاع' },
  { value: 'replacement', label: 'استبدال الجهاز' },
];

const GIFT_CONDITION_STATUS_OPTIONS = [
  { value: 'all', label: 'كل حالات الاستحقاق' },
  { value: 'none', label: 'لم يُنشأ سجل هدية' },
  { value: 'pending', label: 'قيد التحقق' },
  { value: 'met', label: 'متحقق' },
  { value: 'not_met', label: 'غير متحقق' },
];

const GIFT_DELIVERY_RESULT_OPTIONS = [
  { value: 'all', label: 'كل نتائج التسليم' },
  { value: 'none', label: 'بدون نتيجة مسجلة' },
  { value: 'delivered_successfully', label: 'تم التسليم بنجاح' },
  { value: 'refused_gift', label: 'رُفضت الهدية' },
  { value: 'rescheduled', label: 'أعيد تحديد الموعد' },
];

const REPORT_PAGE_SIZE = 10;

export default function Reports() {
  const contextBranchId = useBranchContextStore(state => state.branchId);
  const [groups, setGroups] = useState<ReportCatalogGroup[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [data, setData] = useState<TabularReportResponse | null>(null);
  const [runState, setRunState] = useState<TabularReportRunResponse | null>(null);
  const [page, setPage] = useState(1);
  const [branchFilter, setBranchFilter] = useState('all');
  const [fromDate, setFromDate] = useState(todayYmd);
  const [toDate, setToDate] = useState(todayYmd);
  const [financialAsOfDate, setFinancialAsOfDate] = useState(todayYmd);
  const [supervisorFilter, setSupervisorFilter] = useState('all');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [telemarketerFilter, setTelemarketerFilter] = useState('all');
  const [visitStatusFilter, setVisitStatusFilter] = useState('all');
  const [taskTypeFilter, setTaskTypeFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');
  const [deviceModelFilter, setDeviceModelFilter] = useState('all');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState('all');
  const [warrantyStatusFilter, setWarrantyStatusFilter] = useState('all');
  const [customerRatingFilter, setCustomerRatingFilter] = useState('all');
  const [contactEmployeeFilter, setContactEmployeeFilter] = useState('all');
  const [lastContactChannelFilter, setLastContactChannelFilter] = useState('all');
  const [replacedPartsFilter, setReplacedPartsFilter] = useState('all');
  const [minPaidAmount, setMinPaidAmount] = useState('');
  const [maxPaidAmount, setMaxPaidAmount] = useState('');
  const [dateRangeFilters, setDateRangeFilters] = useState<Record<string, string>>({});
  const [specificFilters, setSpecificFilters] = useState<Record<string, string>>({});
  const [deviceModelIds, setDeviceModelIds] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<ReportFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  const [showReportGuide, setShowReportGuide] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [generatedFilterFingerprint, setGeneratedFilterFingerprint] = useState<string | null>(null);
  const reports = useMemo(() => groups.flatMap(group => group.reports), [groups]);
  const selectedReport = reports.find(report => report.key === selectedKey) ?? null;
  const isGlobal = selectedReport?.viewScope === 'GLOBAL';
  const generatedSortKey = typeof data?.filters.sortKey === 'string' ? data.filters.sortKey : null;
  const generatedSortDir = data?.filters.sortDir === 'desc' ? 'desc' : 'asc';
  const sortDirty = data != null && (generatedSortKey !== sortKey || (sortKey != null && generatedSortDir !== sortDir));
  const effectiveBranchId = isGlobal ? (branchFilter === 'all' ? null : Number(branchFilter)) : contextBranchId;
  const geo = useGeoCascade({ branchId: effectiveBranchId });
  const filterFingerprint = JSON.stringify({
    selectedKey, branchFilter, geoIds: geo.geoIdsCsv, fromDate, toDate, financialAsOfDate,
    supervisorFilter, technicianFilter, telemarketerFilter, visitStatusFilter, taskTypeFilter,
    searchFilter, deviceModelFilter, deviceStatusFilter, warrantyStatusFilter, customerRatingFilter,
    contactEmployeeFilter, lastContactChannelFilter, replacedPartsFilter, minPaidAmount, maxPaidAmount,
    dateRangeFilters, specificFilters, deviceModelIds,
  });
  const filtersDirty = data != null && generatedFilterFingerprint !== filterFingerprint;
  const snapshotDirty = sortDirty || filtersDirty;

  useEffect(() => {
    let active = true;
    api.reports.catalog().then(response => {
      if (!active) return;
      setGroups(response.groups);
      setSelectedKey(response.groups[0]?.reports[0]?.key ?? null);
    }).catch(error => toast.error(error instanceof Error ? error.message : 'فشل تحميل كتالوج التقارير'))
      .finally(() => active && setCatalogLoading(false));
    api.branches.list().then(rows => active && setBranches(rows)).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setData(null); setExportedAt(null); setPage(1); setSortKey(null); setSortDir('asc'); setGeneratedFilterFingerprint(null);
    setFinancialAsOfDate(todayYmd());
    setSupervisorFilter('all'); setTechnicianFilter('all'); setTelemarketerFilter('all'); setVisitStatusFilter('all'); setTaskTypeFilter('all');
    setSearchFilter(''); setDeviceModelFilter('all'); setDeviceStatusFilter('all'); setWarrantyStatusFilter('all');
    setCustomerRatingFilter('all'); setContactEmployeeFilter('all'); setLastContactChannelFilter('all');
    setReplacedPartsFilter('all'); setMinPaidAmount(''); setMaxPaidAmount(''); setDateRangeFilters({}); setSpecificFilters({});
    setDeviceModelIds([]);
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedReport || !selectedKey || !Object.values(selectedReport.filters).some(Boolean)) {
      setFilterOptions(EMPTY_FILTER_OPTIONS);
      return;
    }
    if (!selectedReport.filters.supervisor && !selectedReport.filters.technician && !selectedReport.filters.telemarketer
      && !selectedReport.filters.visitStatus && !selectedReport.filters.taskType && !selectedReport.filters.deviceModel && !selectedReport.filters.deviceStatus
      && !selectedReport.filters.warrantyStatus && !selectedReport.filters.customerRating && !selectedReport.filters.contactEmployee
      && !selectedReport.filters.candidateStatus && !selectedReport.filters.accompanyingTechnician
      && !selectedReport.filters.giftPromiseStatus && !selectedReport.filters.contractStatus
      && !selectedReport.filters.contractSeller && !selectedReport.filters.contractSellerDepartment
      && !selectedReport.filters.contractSale && !selectedReport.filters.departmentType && !selectedReport.filters.collectionOwner && !selectedReport.filters.reportDeviceModels
      && !selectedReport.filters.saleCloser && !selectedReport.filters.faultType && !selectedReport.filters.repairTechnician
      && !selectedReport.filters.retrievalTechnician && !selectedReport.filters.retrievedDeviceStatus
      && !selectedReport.filters.giftDefinition && !selectedReport.filters.giftConditionStatus && !selectedReport.filters.giftDeliveryResult
      && !selectedReport.filters.callEmployee && !selectedReport.filters.callOutcome) {
      setFilterOptions(EMPTY_FILTER_OPTIONS);
      return;
    }
    let active = true;
    api.reports.filterOptions(selectedKey, {
      branchId: effectiveBranchId ?? undefined,
      fromDate: selectedReport.filters.contractSale || selectedReport.filters.reportDeviceModelsRequired || selectedReport.filters.callEmployee ? fromDate : undefined,
      toDate: selectedReport.filters.contractSale || selectedReport.filters.reportDeviceModelsRequired || selectedReport.filters.callEmployee ? toDate : undefined,
    })
      .then(response => active && setFilterOptions(normalizeReportFilterOptions(response)))
      .catch(error => {
        if (active) toast.error(error instanceof Error ? error.message : 'فشل تحميل خيارات فلاتر التقرير');
      });
    return () => { active = false; };
  }, [selectedKey, selectedReport, effectiveBranchId, fromDate, toDate]);

  // A sale picked inside one range does not belong to the next one, so the choice is dropped
  // with the range instead of silently returning an empty report.
  useEffect(() => {
    setSpecificFilters(current => (current.contractId ? { ...current, contractId: '' } : current));
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!data?.runId || snapshotDirty || page === data.pagination.page) return;
    let active = true;
    setReportLoading(true);
    api.reports.tabularRun(data.runId, { page, limit: REPORT_PAGE_SIZE })
      .then(response => { if (active && response.status === 'completed') setData(response); })
      .catch(error => active && toast.error(error instanceof Error ? error.message : 'فشل تحميل صفحة التقرير'))
      .finally(() => active && setReportLoading(false));
    return () => { active = false; };
  }, [page, data?.runId, data?.pagination.page, snapshotDirty]);

  useEffect(() => {
    if (!runState || runState.status === 'completed' || runState.status === 'failed') return;
    let active = true;
    const timer = window.setTimeout(() => {
      api.reports.tabularRun(runState.runId, { page: 1, limit: REPORT_PAGE_SIZE })
        .then(response => {
          if (!active) return;
          setRunState(response);
          if (response.status === 'completed') {
            setData(response); setPage(1); setReportLoading(false);
            toast.success('اكتمل توليد لقطة التقرير');
          } else if (response.status === 'failed') {
            setReportLoading(false);
            toast.error(response.error || 'فشل توليد التقرير');
          }
        })
        .catch(error => {
          if (!active) return;
          setReportLoading(false);
          toast.error(error instanceof Error ? error.message : 'تعذر متابعة حالة التقرير');
        });
    }, 1_500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [runState]);

  function resetFilters() {
    const today = todayYmd();
    setBranchFilter('all');
    geo.reset();
    setFromDate(today); setToDate(today); setFinancialAsOfDate(today);
    setSupervisorFilter('all'); setTechnicianFilter('all'); setTelemarketerFilter('all');
    setVisitStatusFilter('all'); setTaskTypeFilter('all'); setSearchFilter('');
    setDeviceModelFilter('all'); setDeviceStatusFilter('all'); setWarrantyStatusFilter('all');
    setCustomerRatingFilter('all'); setContactEmployeeFilter('all'); setLastContactChannelFilter('all');
    setReplacedPartsFilter('all'); setMinPaidAmount(''); setMaxPaidAmount(''); setDateRangeFilters({}); setSpecificFilters({});
    setDeviceModelIds([]);
    setSortKey(null); setSortDir('asc');
    setData(null); setRunState(null); setExportedAt(null); setGeneratedFilterFingerprint(null); setPage(1);
  }

  function selectSort(column: { key: string; sortable?: boolean }) {
    if (!column.sortable || reportLoading || exporting) return;
    if (sortKey === column.key) setSortDir(current => current === 'asc' ? 'desc' : 'asc');
    else { setSortKey(column.key); setSortDir('asc'); }
    setPage(1);
  }

  async function generateReport() {
    if (!selectedReport) return;
    if (selectedReport.filters.dateRange === 'required' && (!fromDate || !toDate || fromDate > toDate)) {
      toast.error(!fromDate || !toDate ? 'حدد تاريخ البداية والنهاية' : 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية');
      return;
    }
    if (selectedReport.filters.reportDeviceModelsRequired && deviceModelIds.length === 0) {
      toast.error('اختر جهازًا واحدًا على الأقل لتوليد التقرير');
      return;
    }
    if (selectedReport.filters.reportDeviceModelsRequired && deviceModelIds.length > MAX_REPORT_DEVICE_MODELS) {
      toast.error(`لا يمكن اختيار أكثر من ${MAX_REPORT_DEVICE_MODELS} أجهزة في التوليد الواحد`);
      return;
    }
    if (selectedReport.filters.financialAsOfDate && !financialAsOfDate) {
      toast.error('حدد تاريخ الحالة المالية');
      return;
    }
    const invalidNamedRange = [...(selectedReport.filters.primaryDateRanges ?? []), ...(selectedReport.filters.dateRanges ?? [])].find(range => {
      const from = dateRangeFilters[range.fromKey];
      const to = dateRangeFilters[range.toKey];
      return from && to && from > to;
    });
    if (invalidNamedRange) {
      toast.error(`بداية نطاق «${invalidNamedRange.label}» يجب ألا تكون بعد نهايته`);
      return;
    }
    if (minPaidAmount !== '' && maxPaidAmount !== '' && Number(minPaidAmount) > Number(maxPaidAmount)) {
      toast.error('الحد الأدنى للمبلغ المدفوع يجب ألا يتجاوز الحد الأعلى');
      return;
    }
    setReportLoading(true); setExportedAt(null);
    try {
      const response = await api.reports.generateTabular(selectedReport.key, {
        page: 1,
        limit: REPORT_PAGE_SIZE,
        branchId: isGlobal ? (branchFilter !== 'all' ? Number(branchFilter) : undefined) : (contextBranchId ?? undefined),
        geoIds: selectedReport.filters.geography ? (geo.geoIdsCsv || undefined) : undefined,
        fromDate: selectedReport.filters.dateRange === 'required' ? fromDate : undefined,
        toDate: selectedReport.filters.dateRange === 'required' ? toDate : undefined,
        supervisorEmployeeId: selectedReport.filters.supervisor && supervisorFilter !== 'all' ? Number(supervisorFilter) : undefined,
        technicianEmployeeId: selectedReport.filters.technician && technicianFilter !== 'all' ? Number(technicianFilter) : undefined,
        telemarketerUserId: selectedReport.filters.telemarketer && telemarketerFilter !== 'all' ? Number(telemarketerFilter) : undefined,
        visitStatus: selectedReport.filters.visitStatus && visitStatusFilter !== 'all' ? visitStatusFilter : undefined,
        taskType: selectedReport.filters.taskType && taskTypeFilter !== 'all' ? taskTypeFilter : undefined,
        search: selectedReport.filters.search && searchFilter.trim() ? searchFilter.trim() : undefined,
        deviceModel: selectedReport.filters.deviceModel && deviceModelFilter !== 'all' ? deviceModelFilter : undefined,
        deviceStatus: selectedReport.filters.deviceStatus && deviceStatusFilter !== 'all' ? deviceStatusFilter : undefined,
        warrantyStatus: selectedReport.filters.warrantyStatus && warrantyStatusFilter !== 'all' ? warrantyStatusFilter : undefined,
        customerRating: selectedReport.filters.customerRating && customerRatingFilter !== 'all' ? customerRatingFilter : undefined,
        contactEmployeeId: selectedReport.filters.contactEmployee && contactEmployeeFilter !== 'all' ? Number(contactEmployeeFilter) : undefined,
        lastContactChannel: selectedReport.filters.lastContactChannel && lastContactChannelFilter !== 'all' ? lastContactChannelFilter : undefined,
        replacedParts: selectedReport.filters.replacedParts && replacedPartsFilter !== 'all' ? replacedPartsFilter : undefined,
        minPaidAmount: selectedReport.filters.paidAmount && minPaidAmount !== '' ? Number(minPaidAmount) : undefined,
        maxPaidAmount: selectedReport.filters.paidAmount && maxPaidAmount !== '' ? Number(maxPaidAmount) : undefined,
        sortKey: sortKey ?? undefined,
        sortDir: sortKey ? sortDir : undefined,
        candidateNameSearch: selectedReport.filters.candidateNameSearch ? (specificFilters.candidateNameSearch?.trim() || undefined) : undefined,
        candidateSourceType: selectedReport.filters.candidateSourceType && specificFilters.candidateSourceType !== 'all' ? specificFilters.candidateSourceType : undefined,
        candidateStatus: selectedReport.filters.candidateStatus && specificFilters.candidateStatus !== 'all' ? specificFilters.candidateStatus : undefined,
        candidateOutcome: selectedReport.filters.candidateOutcome && specificFilters.candidateOutcome !== 'all' ? specificFilters.candidateOutcome : undefined,
        candidateDuplicateStatus: selectedReport.filters.candidateDuplicateStatus && specificFilters.candidateDuplicateStatus !== 'all' ? specificFilters.candidateDuplicateStatus : undefined,
        referralSheetNumber: selectedReport.filters.referralSheetNumber && specificFilters.referralSheetNumber ? Number(specificFilters.referralSheetNumber) : undefined,
        mediatorName: selectedReport.filters.mediatorName ? (specificFilters.mediatorName?.trim() || undefined) : undefined,
        mediatorType: selectedReport.filters.mediatorType && specificFilters.mediatorType !== 'all' ? specificFilters.mediatorType : undefined,
        accompanyingTechnicianId: selectedReport.filters.accompanyingTechnician && specificFilters.accompanyingTechnicianId && specificFilters.accompanyingTechnicianId !== 'all' ? Number(specificFilters.accompanyingTechnicianId) : undefined,
        giftPromiseStatus: selectedReport.filters.giftPromiseStatus && specificFilters.giftPromiseStatus !== 'all' ? specificFilters.giftPromiseStatus : undefined,
        occupation: selectedReport.filters.occupation ? (specificFilters.occupation?.trim() || undefined) : undefined,
        contractStatus: selectedReport.filters.contractStatus && specificFilters.contractStatus !== 'all' ? specificFilters.contractStatus : undefined,
        sellerEmployeeId: selectedReport.filters.contractSeller && specificFilters.sellerEmployeeId && specificFilters.sellerEmployeeId !== 'all' ? Number(specificFilters.sellerEmployeeId) : undefined,
        sellerDepartmentTypeId: selectedReport.filters.contractSellerDepartment && specificFilters.sellerDepartmentTypeId && specificFilters.sellerDepartmentTypeId !== 'all' ? Number(specificFilters.sellerDepartmentTypeId) : undefined,
        paymentType: selectedReport.filters.contractPaymentType && specificFilters.paymentType !== 'all' ? specificFilters.paymentType : undefined,
        executionStage: selectedReport.filters.contractExecutionStage && specificFilters.executionStage !== 'all' ? specificFilters.executionStage : undefined,
        saleType: selectedReport.filters.contractSaleType && specificFilters.saleType !== 'all' ? specificFilters.saleType : undefined,
        saleSubtype: selectedReport.filters.contractSaleSubtype && specificFilters.saleSubtype !== 'all' ? specificFilters.saleSubtype : undefined,
        remainingBalance: selectedReport.filters.contractRemainingBalance && specificFilters.remainingBalance && specificFilters.remainingBalance !== 'all' ? specificFilters.remainingBalance : undefined,
        contractId: selectedReport.filters.contractSale && specificFilters.contractId && specificFilters.contractId !== 'all' ? Number(specificFilters.contractId) : undefined,
        deviceModelIds: selectedReport.filters.reportDeviceModels && deviceModelIds.length > 0 ? deviceModelIds.join(',') : undefined,
        departmentTypeId: selectedReport.filters.departmentType && specificFilters.departmentTypeId && specificFilters.departmentTypeId !== 'all' ? Number(specificFilters.departmentTypeId) : undefined,
        employeeId: selectedReport.filters.callEmployee && specificFilters.employeeId && specificFilters.employeeId !== 'all' ? Number(specificFilters.employeeId) : undefined,
        callOutcome: selectedReport.filters.callOutcome && specificFilters.callOutcome && specificFilters.callOutcome !== 'all' ? specificFilters.callOutcome : undefined,
        financialAsOfDate: selectedReport.filters.financialAsOfDate ? financialAsOfDate : undefined,
        collectionOwnerId: selectedReport.filters.collectionOwner && specificFilters.collectionOwnerId && specificFilters.collectionOwnerId !== 'all' ? Number(specificFilters.collectionOwnerId) : undefined,
        saleCloserUserId: selectedReport.filters.saleCloser && specificFilters.saleCloserUserId && specificFilters.saleCloserUserId !== 'all' ? Number(specificFilters.saleCloserUserId) : undefined,
        latestCollectionResult: selectedReport.filters.latestCollectionResult && specificFilters.latestCollectionResult && specificFilters.latestCollectionResult !== 'all' ? specificFilters.latestCollectionResult : undefined,
        faultTypeId: selectedReport.filters.faultType && specificFilters.faultTypeId && specificFilters.faultTypeId !== 'all' ? Number(specificFilters.faultTypeId) : undefined,
        faultStatus: selectedReport.filters.faultStatus && specificFilters.faultStatus && specificFilters.faultStatus !== 'all' ? specificFilters.faultStatus : undefined,
        faultDiscoveryPhase: selectedReport.filters.faultDiscoveryPhase && specificFilters.faultDiscoveryPhase && specificFilters.faultDiscoveryPhase !== 'all' ? specificFilters.faultDiscoveryPhase : undefined,
        repairTechnicianEmployeeId: selectedReport.filters.repairTechnician && specificFilters.repairTechnicianEmployeeId && specificFilters.repairTechnicianEmployeeId !== 'all' ? Number(specificFilters.repairTechnicianEmployeeId) : undefined,
        faultDurationBucket: selectedReport.filters.faultDuration && specificFilters.faultDurationBucket && specificFilters.faultDurationBucket !== 'all' ? specificFilters.faultDurationBucket : undefined,
        faultPartsUsage: selectedReport.filters.faultPartsUsage && specificFilters.faultPartsUsage && specificFilters.faultPartsUsage !== 'all' ? specificFilters.faultPartsUsage : undefined,
        retrievalPurpose: selectedReport.filters.retrievalPurpose && specificFilters.retrievalPurpose && specificFilters.retrievalPurpose !== 'all' ? specificFilters.retrievalPurpose : undefined,
        retrievalTechnicianEmployeeId: selectedReport.filters.retrievalTechnician && specificFilters.retrievalTechnicianEmployeeId && specificFilters.retrievalTechnicianEmployeeId !== 'all' ? Number(specificFilters.retrievalTechnicianEmployeeId) : undefined,
        retrievedDeviceStatus: selectedReport.filters.retrievedDeviceStatus && specificFilters.retrievedDeviceStatus && specificFilters.retrievedDeviceStatus !== 'all' ? specificFilters.retrievedDeviceStatus : undefined,
        giftDefinitionId: selectedReport.filters.giftDefinition && specificFilters.giftDefinitionId && specificFilters.giftDefinitionId !== 'all' ? Number(specificFilters.giftDefinitionId) : undefined,
        giftConditionStatus: selectedReport.filters.giftConditionStatus && specificFilters.giftConditionStatus !== 'all' ? specificFilters.giftConditionStatus : undefined,
        giftDeliveryResult: selectedReport.filters.giftDeliveryResult && specificFilters.giftDeliveryResult !== 'all' ? specificFilters.giftDeliveryResult : undefined,
        ...Object.fromEntries((selectedReport.filters.primaryDateRanges ?? []).flatMap(range => [
          [range.fromKey, dateRangeFilters[range.fromKey] || undefined],
          [range.toKey, dateRangeFilters[range.toKey] || undefined],
        ])),
        ...Object.fromEntries((selectedReport.filters.dateRanges ?? []).flatMap(range => [
          [range.fromKey, dateRangeFilters[range.fromKey] || undefined],
          [range.toKey, dateRangeFilters[range.toKey] || undefined],
        ])),
      });
      setRunState(response); setData(null); setGeneratedFilterFingerprint(filterFingerprint); setPage(1); toast.success('تمت إضافة التقرير إلى قائمة التوليد');
    } catch (error) { setReportLoading(false); toast.error(error instanceof Error ? error.message : 'فشل بدء توليد التقرير'); }
  }

  async function exportReport() {
    if (!selectedReport?.canExport || !data?.runId || snapshotDirty) return;
    setExporting(true);
    try {
      const result = await api.reports.exportTabularRun(data.runId);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setExportedAt(result.exportedAt); toast.success('تم تصدير نفس لقطة التقرير إلى Excel');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'فشل تصدير التقرير'); }
    finally { setExporting(false); }
  }

  if (catalogLoading) return <div className="min-h-[60vh] flex items-center justify-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin ml-2" /> جاري تحميل التقارير…</div>;
  if (groups.length === 0) return <div className="max-w-3xl mx-auto mt-16 rounded-2xl border bg-white p-10 text-center"><ShieldCheck className="w-12 h-12 mx-auto text-slate-300 mb-4" /><h1 className="text-xl font-bold">لا توجد تقارير متاحة لحسابك</h1></div>;

  const columns = data?.report.columns ?? selectedReport?.columns ?? [];
  return <div className="p-4 md:p-7 space-y-5" dir="rtl">
    <div className="flex items-center gap-3"><div className="p-2.5 rounded-xl bg-teal-50 text-teal-700"><BarChart3 className="w-6 h-6" /></div><div><h1 className="text-2xl font-bold">مركز التقارير</h1><p className="text-sm text-slate-500 mt-1">لا تُولّد البيانات تلقائيًا؛ كل تشغيل ينشئ لقطة ثابتة موثقة.</p></div></div>
    <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-5">
      <aside className="rounded-2xl border bg-white p-3 shadow-sm h-fit">{groups.map(group => <div key={group.key} className="mb-4"><div className="flex items-center gap-2 px-2 py-2 text-xs font-bold text-slate-500"><FolderOpen className="w-4 h-4" />{group.title}</div>{group.reports.map(report => <button key={report.key} type="button" onClick={() => setSelectedKey(report.key)} className={`w-full text-right rounded-xl px-3 py-3 ${selectedKey === report.key ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50'}`}><FileSpreadsheet className="w-4 h-4 inline ml-2" />{report.title}</button>)}</div>)}</aside>
      <main className="min-w-0 space-y-4">
        {selectedReport && <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4"><div className="flex justify-between gap-3"><div><h2 className="text-xl font-bold">{selectedReport.title}</h2><p className="text-sm text-slate-600 mt-1">{selectedReport.description}</p></div><div className="h-fit inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-slate-700"><span className="px-3 py-1 text-xs font-semibold">{isGlobal ? 'كل الفروع' : selectedReport.viewScope === 'BRANCH' ? 'نطاق الفروع' : 'ملفي الشخصي'}</span><button type="button" onClick={() => setShowReportGuide(true)} className="border-r border-slate-200 p-1.5 text-slate-400 transition-colors hover:bg-teal-50 hover:text-teal-700" aria-label="شرح التقرير والأعمدة" title="شرح التقرير والأعمدة"><Info className="h-4 w-4" /></button></div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              {selectedReport.filters.dateRange === 'required' && <>
                <FilterField label="من تاريخ"><DateField value={fromDate} onChange={setFromDate} max={toDate || undefined} /></FilterField>
                <FilterField label="إلى تاريخ"><DateField value={toDate} onChange={setToDate} min={fromDate || undefined} /></FilterField>
              </>}
              {selectedReport.filters.financialAsOfDate && <FilterField label="الحالة المالية حتى تاريخ"><DateField value={financialAsOfDate} onChange={setFinancialAsOfDate} /></FilterField>}
              {isGlobal && <SelectFilter label="الفرع" value={branchFilter} onChange={setBranchFilter} options={[{ value: 'all', label: 'كل الفروع' }, ...branches.map(branch => ({ value: String(branch.id), label: branch.name }))]} />}
              {selectedReport.filters.geography && <GeoCascadeFields cascade={geo} />}
              {selectedReport.filters.search && <FilterField label="بحث">
                <input value={searchFilter} onChange={event => setSearchFilter(event.target.value)} placeholder="اسم الزبون، الرقم، أو الجهاز" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500" />
              </FilterField>}
              {selectedReport.filters.candidateNameSearch && <FilterField label="اسم الشخص المقترح"><input value={specificFilters.candidateNameSearch ?? ''} onChange={event => setSpecificFilters(current => ({ ...current, candidateNameSearch: event.target.value }))} placeholder="البحث بالاسم" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500" /></FilterField>}
              {selectedReport.filters.candidateSourceType && <SelectFilter label="مصدر الاسم" value={specificFilters.candidateSourceType ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, candidateSourceType: value }))} options={[{ value: 'all', label: 'كل المصادر' }, { value: 'direct', label: 'اقتراح مباشر' }, { value: 'name_list', label: 'لائحة أسماء' }]} />}
              {selectedReport.filters.contractExecutionStage && <SelectFilter label="مرحلة التنفيذ" value={specificFilters.executionStage ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, executionStage: value }))} options={EXECUTION_STAGE_OPTIONS} />}
              {selectedReport.filters.contractSeller && <SelectFilter label="البائع" value={specificFilters.sellerEmployeeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, sellerEmployeeId: value }))} options={[{ value: 'all', label: 'كل البائعين' }, ...filterOptions.contractSellers]} />}
              {selectedReport.filters.contractSellerDepartment && <SelectFilter label="قسم البائع" value={specificFilters.sellerDepartmentTypeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, sellerDepartmentTypeId: value }))} options={[{ value: 'all', label: 'كل الأقسام' }, ...filterOptions.contractSellerDepartments]} />}
              {selectedReport.filters.contractPaymentType && <SelectFilter label="نظام السداد المتفق عليه" value={specificFilters.paymentType ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, paymentType: value }))} options={PAYMENT_TYPE_OPTIONS} />}
              {selectedReport.filters.contractSaleType && <SelectFilter label="نوع البيعة" value={specificFilters.saleType ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, saleType: value }))} options={SALE_TYPE_OPTIONS} />}
              {selectedReport.filters.departmentType && <SelectFilter label="نوع القسم" value={specificFilters.departmentTypeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, departmentTypeId: value }))} options={[{ value: 'all', label: 'كل أنواع الأقسام' }, ...filterOptions.departmentTypes]} />}
              {selectedReport.filters.callEmployee && <SelectFilter label="الموظف" value={specificFilters.employeeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, employeeId: value }))} options={[{ value: 'all', label: 'كل الموظفين' }, ...filterOptions.callEmployees]} />}
              {selectedReport.filters.callOutcome && <SelectFilter label="نتيجة المكالمة" value={specificFilters.callOutcome ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, callOutcome: value }))} options={[{ value: 'all', label: 'كل النتائج' }, ...filterOptions.callOutcomes]} />}
              {selectedReport.filters.reportDeviceModels && <MultiSelectFilter label={selectedReport.filters.reportDeviceModelsRequired ? `الأجهزة المشمولة (إلزامي — حتى ${MAX_REPORT_DEVICE_MODELS})` : 'الأجهزة المشمولة'} values={deviceModelIds} onChange={setDeviceModelIds} options={filterOptions.deviceModels} />}
              {selectedReport.filters.contractSaleSubtype && <SelectFilter label="صفة البيعة" value={specificFilters.saleSubtype ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, saleSubtype: value }))} options={SALE_SUBTYPE_OPTIONS} />}
              {selectedReport.filters.contractRemainingBalance && <SelectFilter label="وجود متبقٍّ مالي" value={specificFilters.remainingBalance ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, remainingBalance: value }))} options={REMAINING_BALANCE_OPTIONS} />}
              {selectedReport.filters.contractSale && <SelectFilter label="بيعة محددة" value={specificFilters.contractId || 'all'} onChange={value => setSpecificFilters(current => ({ ...current, contractId: value === 'all' ? '' : value }))} options={[{ value: 'all', label: 'كل بيعات المدى المحدد' }, ...filterOptions.contractSales]} />}
              {selectedReport.filters.contractStatus && <SelectFilter label="حالة العقد" value={specificFilters.contractStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, contractStatus: value }))} options={[{ value: 'all', label: 'كل حالات العقود' }, ...filterOptions.contractStatuses]} />}
              {selectedReport.filters.collectionOwner && <SelectFilter label="موظف التحصيل" value={specificFilters.collectionOwnerId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, collectionOwnerId: value }))} options={[{ value: 'all', label: 'كل موظفي التحصيل' }, ...filterOptions.collectionOwners]} />}
              {selectedReport.filters.saleCloser && <SelectFilter label="موظف إغلاق البيع" value={specificFilters.saleCloserUserId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, saleCloserUserId: value }))} options={[{ value: 'all', label: 'كل موظفي إغلاق البيع' }, ...filterOptions.saleClosers]} />}
              {selectedReport.filters.latestCollectionResult && <SelectFilter label="آخر نتيجة تحصيل" value={specificFilters.latestCollectionResult ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, latestCollectionResult: value }))} options={COLLECTION_RESULT_OPTIONS} />}
              {selectedReport.filters.faultType && <SelectFilter label="نوع العطل" value={specificFilters.faultTypeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, faultTypeId: value }))} options={[{ value: 'all', label: 'كل أنواع الأعطال' }, ...filterOptions.faultTypes]} />}
              {selectedReport.filters.faultStatus && <SelectFilter label="حالة العطل" value={specificFilters.faultStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, faultStatus: value }))} options={FAULT_STATUS_OPTIONS} />}
              {selectedReport.filters.faultDiscoveryPhase && <SelectFilter label="مرحلة اكتشاف العطل" value={specificFilters.faultDiscoveryPhase ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, faultDiscoveryPhase: value }))} options={FAULT_DISCOVERY_PHASE_OPTIONS} />}
              {selectedReport.filters.repairTechnician && <SelectFilter label="فني الإصلاح" value={specificFilters.repairTechnicianEmployeeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, repairTechnicianEmployeeId: value }))} options={[{ value: 'all', label: 'كل فنيي الإصلاح' }, ...filterOptions.repairTechnicians]} />}
              {selectedReport.filters.faultDuration && <SelectFilter label="مدة المعالجة" value={specificFilters.faultDurationBucket ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, faultDurationBucket: value }))} options={FAULT_DURATION_OPTIONS} />}
              {selectedReport.filters.faultPartsUsage && <SelectFilter label="القطع المرتبطة بالعطل" value={specificFilters.faultPartsUsage ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, faultPartsUsage: value }))} options={FAULT_PARTS_USAGE_OPTIONS} />}
              {selectedReport.filters.retrievalPurpose && <SelectFilter label="غرض السحب" value={specificFilters.retrievalPurpose ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, retrievalPurpose: value }))} options={RETRIEVAL_PURPOSE_OPTIONS} />}
              {selectedReport.filters.retrievalTechnician && <SelectFilter label="فني السحب" value={specificFilters.retrievalTechnicianEmployeeId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, retrievalTechnicianEmployeeId: value }))} options={[{ value: 'all', label: 'كل فنيي السحب' }, ...filterOptions.retrievalTechnicians]} />}
              {selectedReport.filters.retrievedDeviceStatus && <SelectFilter label="حالة الجهاز الحالية" value={specificFilters.retrievedDeviceStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, retrievedDeviceStatus: value }))} options={[{ value: 'all', label: 'كل الحالات الحالية' }, ...filterOptions.retrievedDeviceStatuses]} />}
              {selectedReport.filters.giftDefinition && <SelectFilter label="نوع الهدية" value={specificFilters.giftDefinitionId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, giftDefinitionId: value }))} options={[{ value: 'all', label: 'كل أنواع الهدايا' }, ...filterOptions.giftDefinitions]} />}
              {selectedReport.filters.giftConditionStatus && <SelectFilter label="حالة الاستحقاق" value={specificFilters.giftConditionStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, giftConditionStatus: value }))} options={GIFT_CONDITION_STATUS_OPTIONS} />}
              {selectedReport.filters.giftDeliveryResult && <SelectFilter label="نتيجة تسليم الهدية" value={specificFilters.giftDeliveryResult ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, giftDeliveryResult: value }))} options={GIFT_DELIVERY_RESULT_OPTIONS} />}
              {selectedReport.filters.candidateStatus && <SelectFilter label="حالة الاسم" value={specificFilters.candidateStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, candidateStatus: value }))} options={[{ value: 'all', label: 'كل حالات الأسماء' }, ...filterOptions.candidateStatuses]} />}
              {selectedReport.filters.candidateOutcome && <SelectFilter label="مآل الاسم" value={specificFilters.candidateOutcome ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, candidateOutcome: value }))} options={[{ value: 'all', label: 'كل مآلات الأسماء' }, { value: 'active', label: 'ما زال اسماً مقترحاً' }, { value: 'converted', label: 'تحول إلى زبون جديد' }, { value: 'linked', label: 'رُبط بزبون موجود' }, { value: 'junk', label: 'استُبعد' }]} />}
              {selectedReport.filters.candidateDuplicateStatus && <SelectFilter label="حالة التكرار" value={specificFilters.candidateDuplicateStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, candidateDuplicateStatus: value }))} options={[{ value: 'all', label: 'كل حالات التكرار' }, { value: 'not_duplicate', label: 'غير مكرر' }, { value: 'client', label: 'مكرر مع زبون' }, { value: 'candidate', label: 'مكرر مع اسم مقترح' }, { value: 'both', label: 'مكرر مع زبون واسم مقترح' }, { value: 'duplicate', label: 'مكرر' }]} />}
              {(selectedReport.filters.primaryDateRanges ?? []).map(range => <div key={range.fromKey} className="contents">
                <FilterField label={`${range.label} — من`}><DateField value={dateRangeFilters[range.fromKey] ?? ''} onChange={value => setDateRangeFilters(current => ({ ...current, [range.fromKey]: value }))} max={dateRangeFilters[range.toKey] || undefined} /></FilterField>
                <FilterField label={`${range.label} — إلى`}><DateField value={dateRangeFilters[range.toKey] ?? ''} onChange={value => setDateRangeFilters(current => ({ ...current, [range.toKey]: value }))} min={dateRangeFilters[range.fromKey] || undefined} /></FilterField>
              </div>)}
              {selectedReport.filters.deviceModel && <SelectFilter label="نوع الجهاز" value={deviceModelFilter} onChange={setDeviceModelFilter} options={[{ value: 'all', label: 'كل أنواع الأجهزة' }, ...filterOptions.deviceModels]} />}
              {selectedReport.filters.deviceStatus && <SelectFilter label="الحالة التشغيلية" value={deviceStatusFilter} onChange={setDeviceStatusFilter} options={[{ value: 'all', label: 'كل الحالات التشغيلية' }, ...filterOptions.deviceStatuses]} />}
              {selectedReport.filters.supervisor && <SelectFilter label={selectedKey === 'work_files.mediator_gifts' ? 'مشرفة التركيب' : 'المشرفة'} value={supervisorFilter} onChange={setSupervisorFilter} options={[{ value: 'all', label: selectedKey === 'work_files.mediator_gifts' ? 'كل مشرفات التركيب' : 'كل المشرفات' }, ...filterOptions.supervisors]} />}
              {selectedReport.filters.technician && <SelectFilter label={selectedKey === 'work_files.mediator_gifts' ? 'فني التركيب' : 'الفني'} value={technicianFilter} onChange={setTechnicianFilter} options={[{ value: 'all', label: selectedKey === 'work_files.mediator_gifts' ? 'كل فنيي التركيب' : 'كل الفنيين' }, ...filterOptions.technicians]} />}
              {selectedReport.filters.telemarketer && <SelectFilter label="التلماركتر" value={telemarketerFilter} onChange={setTelemarketerFilter} options={[{ value: 'all', label: 'كل موظفي التلماركتر' }, ...filterOptions.telemarketers]} />}
              {selectedReport.filters.visitStatus && <SelectFilter label="حالة الزيارة" value={visitStatusFilter} onChange={setVisitStatusFilter} options={[{ value: 'all', label: 'كل حالات الزيارة' }, ...filterOptions.visitStatuses]} />}
              {selectedReport.filters.taskType && <SelectFilter label="نوع المهمة" value={taskTypeFilter} onChange={setTaskTypeFilter} options={[{ value: 'all', label: 'كل أنواع المهام' }, ...filterOptions.taskTypes]} />}
            </div>
            {(selectedReport.filters.warrantyStatus || selectedReport.filters.customerRating || selectedReport.filters.contactEmployee
              || selectedReport.filters.lastContactChannel || selectedReport.filters.replacedParts || selectedReport.filters.paidAmount
              || selectedReport.filters.referralSheetNumber || selectedReport.filters.mediatorName || selectedReport.filters.mediatorType
              || selectedReport.filters.accompanyingTechnician || selectedReport.filters.giftPromiseStatus || selectedReport.filters.occupation
              || (selectedReport.filters.dateRanges?.length ?? 0) > 0) && <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-bold text-slate-700">فلاتر إضافية</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {selectedReport.filters.warrantyStatus && <SelectFilter label="حالة الكفالة الذهبية" value={warrantyStatusFilter} onChange={setWarrantyStatusFilter} options={[{ value: 'all', label: 'كل حالات الكفالة' }, ...filterOptions.warrantyStatuses]} />}
                {selectedReport.filters.customerRating && <SelectFilter label="تقييم الزبون" value={customerRatingFilter} onChange={setCustomerRatingFilter} options={[{ value: 'all', label: 'كل التقييمات' }, ...filterOptions.customerRatings]} />}
                {selectedReport.filters.contactEmployee && <SelectFilter label="موظف آخر تواصل" value={contactEmployeeFilter} onChange={setContactEmployeeFilter} options={[{ value: 'all', label: 'كل الموظفين' }, ...filterOptions.contactEmployees]} />}
                {selectedReport.filters.lastContactChannel && <SelectFilter label="وسيلة آخر تواصل" value={lastContactChannelFilter} onChange={setLastContactChannelFilter} options={[{ value: 'all', label: 'كل وسائل التواصل' }, { value: 'whatsapp', label: 'رسالة واتساب' }, { value: 'other', label: 'وسيلة أخرى' }]} />}
                {selectedReport.filters.replacedParts && <SelectFilter label="قطع مبدلة في آخر زيارة" value={replacedPartsFilter} onChange={setReplacedPartsFilter} options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'توجد قطع' }, { value: 'no', label: 'لا توجد قطع' }]} />}
                {selectedReport.filters.referralSheetNumber && <FilterField label="رقم لائحة الأسماء"><input type="number" min="1" value={specificFilters.referralSheetNumber ?? ''} onChange={event => setSpecificFilters(current => ({ ...current, referralSheetNumber: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3" /></FilterField>}
                {selectedReport.filters.mediatorName && <FilterField label="اسم الوسيط"><input value={specificFilters.mediatorName ?? ''} onChange={event => setSpecificFilters(current => ({ ...current, mediatorName: event.target.value }))} className="h-11 rounded-xl border border-slate-200 px-3" /></FilterField>}
                {selectedReport.filters.mediatorType && <SelectFilter label="تصنيف الوسيط" value={specificFilters.mediatorType ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, mediatorType: value }))} options={[{ value: 'all', label: 'كل تصنيفات الوسطاء' }, { value: 'Client', label: 'زبون' }, { value: 'Employee', label: 'موظف' }, { value: 'Personal', label: 'شخصي' }, { value: 'unknown', label: 'غير محدد' }]} />}
                {selectedReport.filters.accompanyingTechnician && <SelectFilter label="الفني المرافق لزيارة الوسيط" value={specificFilters.accompanyingTechnicianId ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, accompanyingTechnicianId: value }))} options={[{ value: 'all', label: 'كل الفنيين المرافقين' }, ...filterOptions.accompanyingTechnicians]} />}
                {selectedReport.filters.giftPromiseStatus && <SelectFilter label="حالة وعد الهدية" value={specificFilters.giftPromiseStatus ?? 'all'} onChange={value => setSpecificFilters(current => ({ ...current, giftPromiseStatus: value }))} options={[{ value: 'all', label: 'كل حالات وعود الهدايا' }, ...filterOptions.giftPromiseStatuses]} />}
                {selectedReport.filters.occupation && <FilterField label="العمل"><input value={specificFilters.occupation ?? ''} onChange={event => setSpecificFilters(current => ({ ...current, occupation: event.target.value }))} placeholder="البحث في العمل" className="h-11 rounded-xl border border-slate-200 px-3" /></FilterField>}
                {selectedReport.filters.paidAmount && <>
                  <FilterField label="الحد الأدنى للمبلغ المدفوع"><input type="number" min="0" value={minPaidAmount} onChange={event => setMinPaidAmount(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3" /></FilterField>
                  <FilterField label="الحد الأعلى للمبلغ المدفوع"><input type="number" min="0" value={maxPaidAmount} onChange={event => setMaxPaidAmount(event.target.value)} className="h-11 rounded-xl border border-slate-200 px-3" /></FilterField>
                </>}
                {(selectedReport.filters.dateRanges ?? []).map(range => <div key={range.fromKey} className="contents">
                  <FilterField label={`${range.label} — من`}><DateField value={dateRangeFilters[range.fromKey] ?? ''} onChange={value => setDateRangeFilters(current => ({ ...current, [range.fromKey]: value }))} max={dateRangeFilters[range.toKey] || undefined} /></FilterField>
                  <FilterField label={`${range.label} — إلى`}><DateField value={dateRangeFilters[range.toKey] ?? ''} onChange={value => setDateRangeFilters(current => ({ ...current, [range.toKey]: value }))} min={dateRangeFilters[range.fromKey] || undefined} /></FilterField>
                </div>)}
              </div>
            </details>}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={generateReport} disabled={reportLoading} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{reportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}{runState?.status === 'queued' ? 'بانتظار التوليد' : runState?.status === 'running' ? `جارٍ التوليد (${runState.progress.rows.toLocaleString('ar-SY')})` : 'توليد التقرير'}</button>
              {selectedReport.canExport && <button type="button" onClick={exportReport} disabled={!data || exporting || snapshotDirty} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}تصدير Excel</button>}
              <button type="button" onClick={resetFilters} disabled={reportLoading || exporting} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"><RotateCcw className="w-4 h-4" />إعادة ضبط الفلاتر</button>
            </div>
          </div>{data && <div className="text-xs text-slate-600">وقت التوليد: <b>{new Date(data.generatedAt).toLocaleString('ar-SY')}</b> · متاح حتى: <b>{new Date(data.expiresAt).toLocaleDateString('ar-SY')}</b>{exportedAt && <> · وقت التصدير: <b>{new Date(exportedAt).toLocaleString('ar-SY')}</b></>}</div>}</section>}
        {sortDirty && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">تغيّر ترتيب التقرير — اضغط «توليد التقرير» لتطبيق الفرز على كامل النتائج وملف Excel.</div>}
        {filtersDirty && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">تغيّرت الفلاتر — اضغط «توليد التقرير» لإنشاء لقطة جديدة قبل التنقل أو التصدير.</div>}
        <section className="rounded-2xl border bg-white shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className={`w-full text-sm ${reportLoading ? 'opacity-60' : ''}`}><thead className="bg-slate-800 text-white"><tr>{columns.map(c => <th key={c.key} aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined} className="px-4 py-3 text-center whitespace-nowrap">{c.sortable ? <button type="button" onClick={() => selectSort(c)} disabled={reportLoading || exporting} className="inline-flex items-center gap-2 rounded px-1 py-0.5 font-bold hover:bg-white/10 disabled:opacity-50" title="فرز التقرير حسب هذا العمود"><span>{c.titleAr}</span><span aria-hidden="true" className={sortKey === c.key ? 'text-teal-300' : 'text-slate-400'}>{sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span></button> : c.titleAr}</th>)}</tr></thead><tbody className="divide-y">{data?.rows.map((row, i) => <tr key={i} className="hover:bg-teal-50/30">{columns.map(c => <td key={c.key} className={`px-4 py-3 align-top whitespace-pre-line ${(c.type === 'integer' || c.type === 'decimal') ? 'text-center font-bold' : 'text-right'}`}>{displayValue(row[c.key], c.type)}</td>)}</tr>)}{!data && <tr><td colSpan={Math.max(1, columns.length)} className="h-64 text-center text-slate-500"><FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p>يمكنك اختيار ترتيب من رأس عمود، ثم الضغط على «توليد التقرير».</p></td></tr>}{data && data.rows.length === 0 && <tr><td colSpan={columns.length} className="py-14 text-center text-slate-500">لا توجد بيانات ضمن الفلاتر.</td></tr>}</tbody></table></div>{data && <div className="flex items-center justify-between border-t bg-slate-50 px-4 py-3"><span className="text-xs text-slate-500">إجمالي الصفوف: {data.pagination.total.toLocaleString('ar-SY')}</span><div className="flex items-center gap-2"><button onClick={() => setPage(v => Math.max(1, v - 1))} disabled={page <= 1 || reportLoading || snapshotDirty} className="p-2 border rounded-lg disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button><span className="text-sm">صفحة {data.pagination.page} من {Math.max(1, data.pagination.pages)}</span><button onClick={() => setPage(v => v + 1)} disabled={page >= data.pagination.pages || reportLoading || snapshotDirty} className="p-2 border rounded-lg disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button></div></div>}</section>
      </main>
    </div>
    <Modal isOpen={showReportGuide} onClose={() => setShowReportGuide(false)} title="دليل قراءة التقرير" subtitle={selectedReport?.title} size="2xl" bodyClassName="p-5">
      <div className="space-y-5 text-sm text-slate-700">
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
          <p className="font-bold text-teal-900">{selectedReport?.guide.framingTitle}</p>
          <p className="mt-1 leading-6 text-teal-800">{selectedReport?.guide.framingDescription}</p>
        </div>
        <div>
          <h4 className="mb-3 font-bold text-slate-900">كيف نقرأ الصف؟</h4>
          <p className="leading-6">{selectedReport?.guide.rowDescription} {isGlobal && 'وعند صلاحية «كل الفروع» يظهر عمود الفرع.'}</p>
        </div>
        <div>
          <h4 className="mb-3 font-bold text-slate-900">شرح الأعمدة</h4>
          <dl className="grid gap-3 md:grid-cols-2">
            {(selectedReport?.columns ?? []).map(column => <div key={column.key} className="rounded-xl border border-slate-200 p-3"><dt className="font-bold text-slate-900">{column.titleAr}</dt><dd className="mt-1 leading-5 text-slate-600">{selectedReport?.guide.columnDescriptions[column.key] ?? 'حقل من بيانات التقرير.'}</dd></div>)}
          </dl>
        </div>
        {selectedReport?.guide.note && <div className="rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600"><b className="text-slate-800">ملاحظة احتساب:</b> {selectedReport.guide.note}</div>}
      </div>
    </Modal>
  </div>;
}
