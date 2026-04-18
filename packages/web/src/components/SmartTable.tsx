import { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Search, Download, RotateCcw, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ColumnDef<T> {
    key: string;
    label: string;
    sortable?: boolean;
    render?: (item: T) => ReactNode;
    width?: string;
    minWidth?: string;
    getValue?: (item: T) => string | number;
}

export interface FilterDef {
    key: string;
    label: string;
    options: { value: string; label: string }[];
}

export interface BulkActionDef<T> {
    label: string;
    icon: LucideIcon;
    onClick: (items: T[]) => void;
    variant?: 'danger' | 'primary';
}

export interface SmartTableProps<T> {
    title: string;
    icon: LucideIcon;
    data: T[];
    columns: ColumnDef<T>[];
    filters?: FilterDef[];
    searchKeys?: (keyof T)[];
    searchPlaceholder?: string;
    onRowClick?: (item: T) => void;
    bulkActions?: BulkActionDef<T>[];
    actions?: (item: T) => ReactNode;
    headerActions?: ReactNode;
    emptyIcon?: LucideIcon;
    emptyMessage?: string;
    getId: (item: T) => string | number;
    hideFilterBar?: boolean;
    tableMinWidth?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const ROW_HEIGHT = 56; // px — fixed row height for visual consistency

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type SortDir = 'asc' | 'desc' | null;

function exportCSV<T>(columns: ColumnDef<T>[], data: T[], title: string) {
    const header = columns.map(c => c.label).join(',');
    const rows = data.map(item =>
        columns.map(c => {
            const val = c.getValue ? c.getValue(item) : (item as any)[c.key];
            const str = String(val ?? '').replace(/"/g, '""');
            return `"${str}"`;
        }).join(',')
    );
    const bom = '\uFEFF';
    const csv = bom + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SmartTable<T>({
    title,
    icon: Icon,
    data,
    columns,
    filters = [],
    searchKeys = [],
    searchPlaceholder = 'بحث...',
    onRowClick,
    bulkActions,
    actions,
    headerActions,
    emptyIcon: EmptyIcon,
    emptyMessage = 'لا توجد بيانات',
    getId,
    rowClassName,
    hideFilterBar = false,
    tableMinWidth = 860,
}: SmartTableProps<T> & { rowClassName?: (item: T) => string }) {

    /* ---------- state ---------- */
    const [search, setSearch] = useState('');
    const [filterValues, setFilterValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(filters.map(f => [f.key, 'all']))
    );
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<SortDir>(null);
    const [selected, setSelected] = useState<Set<string | number>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    /* ---------- filtering ---------- */
    const filtered = useMemo(() => {
        let result = [...data];
        for (const f of filters) {
            const val = filterValues[f.key];
            if (val && val !== 'all') {
                result = result.filter(item => String((item as any)[f.key]) === val);
            }
        }
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            result = result.filter(item =>
                searchKeys.some(k => String((item as any)[k]).toLowerCase().includes(q))
            );
        }
        return result;
    }, [data, filters, filterValues, search, searchKeys]);

    /* ---------- sorting ---------- */
    const sorted = useMemo(() => {
        if (!sortKey || !sortDir) return filtered;
        const col = columns.find(c => c.key === sortKey);
        if (!col) return filtered;
        const arr = [...filtered];
        arr.sort((a, b) => {
            const av = col.getValue ? col.getValue(a) : (a as any)[col.key];
            const bv = col.getValue ? col.getValue(b) : (b as any)[col.key];
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number')
                return sortDir === 'asc' ? av - bv : bv - av;
            return sortDir === 'asc'
                ? String(av).localeCompare(String(bv), 'ar')
                : String(bv).localeCompare(String(av), 'ar');
        });
        return arr;
    }, [filtered, sortKey, sortDir, columns]);

    /* ---------- pagination ---------- */
    const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage));

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sorted.slice(start, start + itemsPerPage);
    }, [sorted, currentPage, itemsPerPage]);

    // number of empty filler rows to keep the table height fixed
    const fillerRows = paginatedData.length > 0
        ? Math.max(0, itemsPerPage - paginatedData.length)
        : 0;

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [totalPages, currentPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [search, filterValues, itemsPerPage]);

    /* ---------- selection ---------- */
    const allSelected = sorted.length > 0 && sorted.every(item => selected.has(getId(item)));

    const toggleAll = useCallback(() => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(sorted.map(item => getId(item))));
    }, [allSelected, sorted, getId]);

    const toggleOne = useCallback((id: string | number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    /* ---------- sort handler ---------- */
    const handleSort = useCallback((key: string) => {
        if (sortKey === key) {
            if (sortDir === 'asc') setSortDir('desc');
            else if (sortDir === 'desc') { setSortKey(null); setSortDir(null); }
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    }, [sortKey, sortDir]);

    /* ---------- reset ---------- */
    const resetFilters = useCallback(() => {
        setSearch('');
        setFilterValues(Object.fromEntries(filters.map(f => [f.key, 'all'])));
        setSortKey(null);
        setSortDir(null);
        setSelected(new Set());
        setCurrentPage(1);
    }, [filters]);

    const selectedItems = sorted.filter(item => selected.has(getId(item)));
    const hasActiveFilters = search.trim() !== '' || Object.values(filterValues).some(v => v !== 'all');

    const colSpanTotal = columns.length + (bulkActions ? 1 : 0) + (actions ? 1 : 0);
    const startRecord = sorted.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endRecord   = Math.min(sorted.length, currentPage * itemsPerPage);

    /* ---------------------------------------------------------------- */
    /*  Render                                                           */
    /* ---------------------------------------------------------------- */
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

            {/* ── HEADER ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-sky-600" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-800 leading-tight">{title}</h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {hasActiveFilters
                                ? <><span className="text-sky-600 font-semibold">{sorted.length}</span> نتيجة من أصل {data.length}</>
                                : <><span className="font-semibold text-slate-600">{data.length}</span> سجل إجمالاً</>}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {hasActiveFilters && (
                        <button
                            onClick={resetFilters}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-slate-500 hover:bg-gray-50 hover:text-slate-700 text-xs font-medium transition-colors whitespace-nowrap"
                        >
                            <RotateCcw className="w-3 h-3" />
                            مسح الفلاتر
                        </button>
                    )}
                    <button
                        onClick={() => exportCSV(columns, sorted, title)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-slate-500 hover:bg-gray-50 hover:text-slate-700 text-xs font-medium transition-colors whitespace-nowrap"
                    >
                        <Download className="w-3 h-3" />
                        تصدير CSV
                    </button>
                    {headerActions}
                </div>
            </div>

            {/* ── FILTER BAR ── */}
            {!hideFilterBar && (
                <div className="bg-slate-50/70 border-b border-slate-100 px-5 py-3 flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg pr-9 pl-3 py-1.5 text-sm text-slate-900 placeholder:text-gray-400 focus:border-sky-500 focus:outline-none transition-colors"
                        />
                    </div>
                    {filters.map(f => (
                        <select
                            key={f.key}
                            value={filterValues[f.key]}
                            onChange={e => setFilterValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:border-sky-500 focus:outline-none transition-colors min-w-[130px]"
                        >
                            <option value="all">{f.label}</option>
                            {f.options.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    ))}
                </div>
            )}

            {/* ── BULK ACTIONS ── */}
            {bulkActions && selected.size > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-sky-50 border-b border-sky-100 px-5 py-2.5 flex items-center gap-3"
                >
                    <span className="text-xs text-sky-700 font-semibold">تم تحديد {selected.size} عنصر</span>
                    <div className="mr-auto flex items-center gap-2">
                        {bulkActions.map((ba, i) => (
                            <button
                                key={i}
                                onClick={() => ba.onClick(selectedItems)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${ba.variant === 'danger'
                                    ? 'bg-red-600 hover:bg-red-500 text-white'
                                    : 'bg-sky-600 hover:bg-sky-500 text-white'}`}
                            >
                                <ba.icon className="w-3.5 h-3.5" />
                                {ba.label}
                            </button>
                        ))}
                        <button
                            onClick={() => setSelected(new Set())}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-100 transition-colors"
                        >
                            إلغاء
                        </button>
                    </div>
                </motion.div>
            )}

            {/* ── TABLE — horizontal scroll only, vertical scroll is the page ── */}
            <div className="overflow-x-auto custom-scroll">
                <table
                    className="w-full border-collapse"
                    style={{ minWidth: `${tableMinWidth}px` }}
                >
                    {/* sticky thead — sticks to the top of the viewport as the page scrolls */}
                    <thead className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 shadow-[0_1px_0_0_#e2e8f0]">
                        <tr>
                            {bulkActions && (
                                <th className="w-11 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                        className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer accent-sky-600"
                                    />
                                </th>
                            )}
                            {columns.map(col => (
                                <th
                                    key={col.key}
                                    className={`text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap select-none
                                        ${col.width ?? ''}
                                        ${col.sortable ? 'cursor-pointer hover:text-sky-600 hover:bg-gray-100 transition-colors' : ''}`}
                                    style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                                    onClick={() => col.sortable && handleSort(col.key)}
                                >
                                    <div className="flex items-center gap-1">
                                        {col.label}
                                        {col.sortable && (
                                            <span className="flex-shrink-0 text-gray-400">
                                                {sortKey === col.key && sortDir === 'asc'  ? <ChevronUp   className="w-3.5 h-3.5 text-sky-500" /> :
                                                 sortKey === col.key && sortDir === 'desc' ? <ChevronDown className="w-3.5 h-3.5 text-sky-500" /> :
                                                                                             <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                                            </span>
                                        )}
                                    </div>
                                </th>
                            ))}
                            {actions && (
                                <th className="w-20 px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                                    إجراءات
                                </th>
                            )}
                        </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-100">

                        {/* ── EMPTY STATE ── */}
                        {paginatedData.length === 0 && (
                            <tr>
                                <td
                                    colSpan={colSpanTotal}
                                    style={{ height: `${itemsPerPage * ROW_HEIGHT}px` }}
                                    className="text-center align-middle"
                                >
                                    {EmptyIcon && <EmptyIcon className="w-10 h-10 mx-auto mb-3 text-slate-200" />}
                                    <p className="text-slate-400 text-sm font-medium">{emptyMessage}</p>
                                    {hasActiveFilters && (
                                        <button onClick={resetFilters} className="mt-2 text-xs text-sky-500 hover:underline">
                                            مسح الفلاتر لعرض كل السجلات
                                        </button>
                                    )}
                                </td>
                            </tr>
                        )}

                        {/* ── DATA ROWS ── */}
                        {paginatedData.map((item, rowIdx) => {
                            const id = getId(item);
                            const isSelected = selected.has(id);
                            const customRowClass = rowClassName ? rowClassName(item) : '';
                            return (
                                <motion.tr
                                    key={String(id)}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ duration: 0.12 }}
                                    style={{ height: `${ROW_HEIGHT}px` }}
                                    className={[
                                        'group transition-colors',
                                        onRowClick ? 'cursor-pointer' : '',
                                        // custom class takes full control of background & hover
                                        customRowClass
                                            ? customRowClass
                                            : [
                                                isSelected ? 'bg-sky-50/80' : rowIdx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white',
                                                'hover:bg-sky-50',
                                              ].join(' '),
                                    ].join(' ')}
                                    onClick={() => onRowClick?.(item)}
                                >
                                    {bulkActions && (
                                        <td className="w-11 px-4" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleOne(id)}
                                                className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer accent-sky-600"
                                            />
                                        </td>
                                    )}
                                    {columns.map(col => (
                                        <td
                                            key={col.key}
                                            className={`px-4 ${col.width ?? ''}`}
                                            style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                                        >
                                            {col.render
                                                ? col.render(item)
                                                : <span className="text-sm text-slate-700">{String((item as any)[col.key] ?? '')}</span>}
                                        </td>
                                    ))}
                                    {actions && (
                                        <td className="px-4 w-20" onClick={e => e.stopPropagation()}>
                                            <div className="flex justify-end">{actions(item)}</div>
                                        </td>
                                    )}
                                </motion.tr>
                            );
                        })}

                        {/* ── FILLER ROWS — keep height uniform when fewer than itemsPerPage ── */}
                        {Array.from({ length: fillerRows }).map((_, i) => (
                            <tr
                                key={`filler-${i}`}
                                style={{ height: `${ROW_HEIGHT}px` }}
                                className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}
                            >
                                <td colSpan={colSpanTotal} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── PAGINATION FOOTER ── */}
            <div className="border-t border-slate-100 bg-gray-50/60 px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">

                {/* Record info + page size selector */}
                <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>
                        {sorted.length === 0
                            ? 'لا توجد سجلات'
                            : <>عرض <span className="font-bold text-slate-700">{startRecord}–{endRecord}</span> من <span className="font-bold text-slate-700">{sorted.length}</span> سجل</>}
                    </span>
                    <span className="h-4 w-px bg-slate-200" />
                    <label className="flex items-center gap-1.5">
                        <span>صفوف الصفحة</span>
                        <select
                            value={itemsPerPage}
                            onChange={e => setItemsPerPage(Number(e.target.value))}
                            className="bg-white border border-gray-200 rounded-md px-2 py-0.5 text-xs font-semibold text-slate-700 focus:border-sky-500 focus:outline-none cursor-pointer"
                        >
                            {PAGE_SIZE_OPTIONS.map(n => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                    </label>
                </div>

                {/* Page navigation */}
                {totalPages > 1 && (
                    <div className="flex items-center gap-1 bg-white border border-gray-200 p-1 rounded-xl">
                        <button
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(1)}
                            className="px-2 py-1 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 text-slate-600"
                            title="الأولى"
                        >«</button>
                        <button
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 text-slate-600"
                        >السابق</button>

                        <div className="flex items-center gap-0.5 px-1">
                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                .map((p, i, arr) => (
                                    <div key={p} className="flex items-center gap-0.5">
                                        {i > 0 && arr[i - 1] !== p - 1 && (
                                            <span className="text-slate-300 text-xs px-0.5">…</span>
                                        )}
                                        <button
                                            onClick={() => setCurrentPage(p)}
                                            className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${
                                                currentPage === p
                                                    ? 'bg-sky-600 text-white shadow-sm'
                                                    : 'text-slate-500 hover:bg-slate-100'
                                            }`}
                                        >{p}</button>
                                    </div>
                                ))}
                        </div>

                        <button
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 text-slate-600"
                        >التالي</button>
                        <button
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(totalPages)}
                            className="px-2 py-1 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 text-slate-600"
                            title="الأخيرة"
                        >»</button>
                    </div>
                )}
            </div>
        </div>
    );
}
