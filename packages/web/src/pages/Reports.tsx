import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, type ReportCatalogGroup, type ReportFilterOptions, type TabularReportResponse } from '../lib/api';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { GeoCascadeFields, useGeoCascade } from '../components/filters/GeoCascadeFilter';
import Select from '../components/ui/Select';
import DateField from '../components/ui/DateField';
import Modal from '../components/ui/Modal';
import { BarChart3, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FolderOpen, Info, Loader2, RotateCcw, ShieldCheck } from '../components/ui/icons';

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="px-1 text-[11px] font-bold text-slate-500">{label}</label>{children}</div>;
}

function SelectFilter(props: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <FilterField label={props.label}><Select className="w-full" value={props.value} ariaLabel={props.label} onChange={props.onChange} options={props.options} /></FilterField>;
}

function displayValue(value: unknown, type: 'text' | 'integer' | 'decimal' | 'date' | 'datetime' | 'link') {
  if (value == null || value === '') return '—';
  if (type === 'integer') return Number(value).toLocaleString('ar-SY');
  if (type === 'decimal') return Number(value).toLocaleString('ar-SY', { maximumFractionDigits: 2 });
  if (type === 'date') return new Date(`${String(value)}T00:00:00`).toLocaleDateString('ar-SY');
  if (type === 'datetime') return new Date(String(value)).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' });
  if (type === 'link') return <a href={String(value)} target="_blank" rel="noreferrer" className="font-bold text-teal-700 underline decoration-teal-300 underline-offset-4 hover:text-teal-900">فتح الموقع</a>;
  return String(value);
}

function todayYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const EMPTY_FILTER_OPTIONS: ReportFilterOptions = {
  supervisors: [], technicians: [], telemarketers: [], visitStatuses: [],
  taskTypes: [],
  deviceModels: [], deviceStatuses: [], warrantyStatuses: [], customerRatings: [], contactEmployees: [],
};

export default function Reports() {
  const contextBranchId = useBranchContextStore(state => state.branchId);
  const [groups, setGroups] = useState<ReportCatalogGroup[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [data, setData] = useState<TabularReportResponse | null>(null);
  const [page, setPage] = useState(1);
  const [branchFilter, setBranchFilter] = useState('all');
  const [fromDate, setFromDate] = useState(todayYmd);
  const [toDate, setToDate] = useState(todayYmd);
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
  const [filterOptions, setFilterOptions] = useState<ReportFilterOptions>(EMPTY_FILTER_OPTIONS);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  const [showReportGuide, setShowReportGuide] = useState(false);
  const reports = useMemo(() => groups.flatMap(group => group.reports), [groups]);
  const selectedReport = reports.find(report => report.key === selectedKey) ?? null;
  const isGlobal = selectedReport?.viewScope === 'GLOBAL';
  const effectiveBranchId = isGlobal ? (branchFilter === 'all' ? null : Number(branchFilter)) : contextBranchId;
  const geo = useGeoCascade({ branchId: effectiveBranchId });

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
    setData(null); setExportedAt(null); setPage(1);
    setSupervisorFilter('all'); setTechnicianFilter('all'); setTelemarketerFilter('all'); setVisitStatusFilter('all'); setTaskTypeFilter('all');
    setSearchFilter(''); setDeviceModelFilter('all'); setDeviceStatusFilter('all'); setWarrantyStatusFilter('all');
    setCustomerRatingFilter('all'); setContactEmployeeFilter('all'); setLastContactChannelFilter('all');
    setReplacedPartsFilter('all'); setMinPaidAmount(''); setMaxPaidAmount(''); setDateRangeFilters({});
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedReport || !selectedKey || !Object.values(selectedReport.filters).some(Boolean)) {
      setFilterOptions(EMPTY_FILTER_OPTIONS);
      return;
    }
    if (!selectedReport.filters.supervisor && !selectedReport.filters.technician && !selectedReport.filters.telemarketer
      && !selectedReport.filters.visitStatus && !selectedReport.filters.taskType && !selectedReport.filters.deviceModel && !selectedReport.filters.deviceStatus
      && !selectedReport.filters.warrantyStatus && !selectedReport.filters.customerRating && !selectedReport.filters.contactEmployee) {
      setFilterOptions(EMPTY_FILTER_OPTIONS);
      return;
    }
    let active = true;
    api.reports.filterOptions(selectedKey, { branchId: effectiveBranchId ?? undefined })
      .then(response => active && setFilterOptions(response))
      .catch(error => {
        if (active) toast.error(error instanceof Error ? error.message : 'فشل تحميل خيارات فلاتر التقرير');
      });
    return () => { active = false; };
  }, [selectedKey, selectedReport, effectiveBranchId]);

  useEffect(() => {
    if (!data?.runId || page === data.pagination.page) return;
    let active = true;
    setReportLoading(true);
    api.reports.tabularRun(data.runId, { page, limit: 50 })
      .then(response => active && setData(response))
      .catch(error => active && toast.error(error instanceof Error ? error.message : 'فشل تحميل صفحة التقرير'))
      .finally(() => active && setReportLoading(false));
    return () => { active = false; };
  }, [page, data?.runId, data?.pagination.page]);

  function resetFilters() {
    const today = todayYmd();
    setBranchFilter('all');
    geo.reset();
    setFromDate(today); setToDate(today);
    setSupervisorFilter('all'); setTechnicianFilter('all'); setTelemarketerFilter('all');
    setVisitStatusFilter('all'); setTaskTypeFilter('all'); setSearchFilter('');
    setDeviceModelFilter('all'); setDeviceStatusFilter('all'); setWarrantyStatusFilter('all');
    setCustomerRatingFilter('all'); setContactEmployeeFilter('all'); setLastContactChannelFilter('all');
    setReplacedPartsFilter('all'); setMinPaidAmount(''); setMaxPaidAmount(''); setDateRangeFilters({});
    setData(null); setExportedAt(null); setPage(1);
  }

  async function generateReport() {
    if (!selectedReport) return;
    if (selectedReport.filters.dateRange === 'required' && (!fromDate || !toDate || fromDate > toDate)) {
      toast.error(!fromDate || !toDate ? 'حدد تاريخ البداية والنهاية' : 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية');
      return;
    }
    const invalidNamedRange = (selectedReport.filters.dateRanges ?? []).find(range => {
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
        ...Object.fromEntries((selectedReport.filters.dateRanges ?? []).flatMap(range => [
          [range.fromKey, dateRangeFilters[range.fromKey] || undefined],
          [range.toKey, dateRangeFilters[range.toKey] || undefined],
        ])),
      });
      setData(response); setPage(1); toast.success('تم توليد لقطة التقرير الحالية');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'فشل توليد التقرير'); }
    finally { setReportLoading(false); }
  }

  async function exportReport() {
    if (!selectedReport?.canExport || !data?.runId) return;
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
              {isGlobal && <SelectFilter label="الفرع" value={branchFilter} onChange={setBranchFilter} options={[{ value: 'all', label: 'كل الفروع' }, ...branches.map(branch => ({ value: String(branch.id), label: branch.name }))]} />}
              {selectedReport.filters.geography && <GeoCascadeFields cascade={geo} />}
              {selectedReport.filters.search && <FilterField label="بحث">
                <input value={searchFilter} onChange={event => setSearchFilter(event.target.value)} placeholder="اسم الزبون، الرقم، أو الجهاز" className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500" />
              </FilterField>}
              {selectedReport.filters.deviceModel && <SelectFilter label="نوع الجهاز" value={deviceModelFilter} onChange={setDeviceModelFilter} options={[{ value: 'all', label: 'كل أنواع الأجهزة' }, ...filterOptions.deviceModels]} />}
              {selectedReport.filters.deviceStatus && <SelectFilter label="الحالة التشغيلية" value={deviceStatusFilter} onChange={setDeviceStatusFilter} options={[{ value: 'all', label: 'كل الحالات التشغيلية' }, ...filterOptions.deviceStatuses]} />}
              {selectedReport.filters.supervisor && <SelectFilter label="المشرفة" value={supervisorFilter} onChange={setSupervisorFilter} options={[{ value: 'all', label: 'كل المشرفات' }, ...filterOptions.supervisors]} />}
              {selectedReport.filters.technician && <SelectFilter label="الفني" value={technicianFilter} onChange={setTechnicianFilter} options={[{ value: 'all', label: 'كل الفنيين' }, ...filterOptions.technicians]} />}
              {selectedReport.filters.telemarketer && <SelectFilter label="التلماركتر" value={telemarketerFilter} onChange={setTelemarketerFilter} options={[{ value: 'all', label: 'كل موظفي التلماركتر' }, ...filterOptions.telemarketers]} />}
              {selectedReport.filters.visitStatus && <SelectFilter label="حالة الزيارة" value={visitStatusFilter} onChange={setVisitStatusFilter} options={[{ value: 'all', label: 'كل حالات الزيارة' }, ...filterOptions.visitStatuses]} />}
              {selectedReport.filters.taskType && <SelectFilter label="نوع المهمة" value={taskTypeFilter} onChange={setTaskTypeFilter} options={[{ value: 'all', label: 'كل أنواع المهام' }, ...filterOptions.taskTypes]} />}
            </div>
            {(selectedReport.filters.warrantyStatus || selectedReport.filters.customerRating || selectedReport.filters.contactEmployee
              || selectedReport.filters.lastContactChannel || selectedReport.filters.replacedParts || selectedReport.filters.paidAmount
              || (selectedReport.filters.dateRanges?.length ?? 0) > 0) && <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-bold text-slate-700">فلاتر إضافية</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {selectedReport.filters.warrantyStatus && <SelectFilter label="حالة الكفالة الذهبية" value={warrantyStatusFilter} onChange={setWarrantyStatusFilter} options={[{ value: 'all', label: 'كل حالات الكفالة' }, ...filterOptions.warrantyStatuses]} />}
                {selectedReport.filters.customerRating && <SelectFilter label="تقييم الزبون" value={customerRatingFilter} onChange={setCustomerRatingFilter} options={[{ value: 'all', label: 'كل التقييمات' }, ...filterOptions.customerRatings]} />}
                {selectedReport.filters.contactEmployee && <SelectFilter label="موظف آخر تواصل" value={contactEmployeeFilter} onChange={setContactEmployeeFilter} options={[{ value: 'all', label: 'كل الموظفين' }, ...filterOptions.contactEmployees]} />}
                {selectedReport.filters.lastContactChannel && <SelectFilter label="وسيلة آخر تواصل" value={lastContactChannelFilter} onChange={setLastContactChannelFilter} options={[{ value: 'all', label: 'كل وسائل التواصل' }, { value: 'whatsapp', label: 'رسالة واتساب' }, { value: 'other', label: 'وسيلة أخرى' }]} />}
                {selectedReport.filters.replacedParts && <SelectFilter label="قطع مبدلة في آخر زيارة" value={replacedPartsFilter} onChange={setReplacedPartsFilter} options={[{ value: 'all', label: 'الكل' }, { value: 'yes', label: 'توجد قطع' }, { value: 'no', label: 'لا توجد قطع' }]} />}
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
              <button type="button" onClick={generateReport} disabled={reportLoading} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{reportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}توليد التقرير</button>
              {selectedReport.canExport && <button type="button" onClick={exportReport} disabled={!data || exporting} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">{exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}تصدير Excel</button>}
              <button type="button" onClick={resetFilters} disabled={reportLoading || exporting} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"><RotateCcw className="w-4 h-4" />إعادة ضبط الفلاتر</button>
            </div>
          </div>{data && <div className="text-xs text-slate-600">وقت التوليد: <b>{new Date(data.generatedAt).toLocaleString('ar-SY')}</b>{exportedAt && <> · وقت التصدير: <b>{new Date(exportedAt).toLocaleString('ar-SY')}</b></>}</div>}</section>}
        <section className="rounded-2xl border bg-white shadow-sm overflow-hidden">{!data ? <div className="h-64 flex flex-col items-center justify-center text-slate-500"><FileSpreadsheet className="w-10 h-10 mb-3 text-slate-300" /><p>حدد الفلاتر ثم اضغط «توليد التقرير».</p></div> : <><div className="overflow-x-auto"><table className={`w-full text-sm ${reportLoading ? 'opacity-60' : ''}`}><thead className="bg-slate-800 text-white"><tr>{columns.map(c => <th key={c.key} className="px-4 py-3 text-center whitespace-nowrap">{c.titleAr}</th>)}</tr></thead><tbody className="divide-y">{data.rows.map((row, i) => <tr key={i} className="hover:bg-teal-50/30">{columns.map(c => <td key={c.key} className={`px-4 py-3 align-top whitespace-pre-line ${(c.type === 'integer' || c.type === 'decimal') ? 'text-center font-bold' : 'text-right'}`}>{displayValue(row[c.key], c.type)}</td>)}</tr>)}{data.rows.length === 0 && <tr><td colSpan={columns.length} className="py-14 text-center text-slate-500">لا توجد بيانات ضمن الفلاتر.</td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t bg-slate-50 px-4 py-3"><span className="text-xs text-slate-500">إجمالي الصفوف: {data.pagination.total.toLocaleString('ar-SY')}</span><div className="flex items-center gap-2"><button onClick={() => setPage(v => Math.max(1, v - 1))} disabled={page <= 1 || reportLoading} className="p-2 border rounded-lg disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button><span className="text-sm">صفحة {data.pagination.page} من {Math.max(1, data.pagination.pages)}</span><button onClick={() => setPage(v => v + 1)} disabled={page >= data.pagination.pages || reportLoading} className="p-2 border rounded-lg disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button></div></div></>}</section>
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
