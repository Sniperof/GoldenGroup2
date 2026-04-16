import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from 'react';
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
    width?: string;                              // tailwind width, e.g. "w-40"
    getValue?: (item: T) => string | number;     // raw value for sorting / export
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

/** Pass this prop to enable server-side pagination mode.
 *  When set, SmartTable renders `data` as-is (no client filtering/pagination).
 *  Search input calls `onSearch` (debounced 400ms). Pagination controls call `onPageChange`.
 */
export interface ServerPaginationProps {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onSearch?: (value: string) => void;
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
    /** Enable server-side pagination. When provided, client-side filtering and pagination are disabled. */
    serverPagination?: ServerPaginationProps;
}

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
    serverPagination,
}: SmartTableProps<T> & { rowClassName?: (item: T) => string }) {

    const isServerMode = !!serverPagination;

    /* ---------- state ---------- */
    const [search, setSearch] = useState('');
    const [filterValues, setFilterValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(filters.map(f => [f.key, 'all']))
    );
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<SortDir>(null);
    const [selected, setSelected] = useState<Set<string | number>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    /* ---------- server-mode: debounced search ---------- */
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearchChange = useCallback((value: string) => {
        setSearch(value);
        if (isServerMode && serverPagination?.onSearch) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = setTimeout(() => {
                serverPagination.onSearch!(value);
            }, 400);
        }
    }, [isServerMode, serverPagination]);

    /* ---------- filtering (client mode only) ---------- */
    const filtered = useMemo(() => {
        if (isServerMode) return data; // server already filtered

        let result = [...data];

        // dropdown filters
        for (const f of filters) {
            const val = filterValues[f.key];
            if (val && val !== 'all') {
                result = result.filter(item => String((item as any)[f.key]) === val);
            }
        }

        // search
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            result = result.filter(item =>
                searchKeys.some(k => String((item as any)[k]).toLowerCase().includes(q))
            );
        }

        return result;
    }, [data, filters, filterValues, search, searchKeys, isServerMode]);

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
            if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
            return sortDir === 'asc'
                ? String(av).localeCompare(String(bv), 'ar')
                : String(bv).localeCompare(String(av), 'ar');
        });
        return arr;
    }, [filtered, sortKey, sortDir, columns]);

    /* ---------- pagination ---------- */
    // Server mode: use server values. Client mode: slice locally.
    const totalPages = isServerMode
        ? serverPagination!.totalPages
        : Math.ceil(sorted.length / ITEMS_PER_PAGE);
    const activePage = isServerMode ? serverPagination!.page : currentPage;
    const totalRecords = isServerMode ? serverPagination!.total : sorted.length;

    const paginatedData = useMemo(() => {
        if (isServerMode) return sorted; // data already represents the current page
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return sorted.slice(start, start + ITEMS_PER_PAGE);
    }, [sorted, currentPage, ITEMS_PER_PAGE, isServerMode]);

    const handlePageChange = useCallback((page: number) => {
        if (isServerMode) {
            serverPagination!.onPageChange(page);
        } else {
            setCurrentPage(page);
        }
    }, [isServerMode, serverPagination]);

    // Client mode: reset page if data changes
    useEffect(() => {
        if (!isServerMode && currentPage > 1 && totalPages > 0 && currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [totalPages, currentPage, isServerMode]);

    /* ---------- selection ---------- */
    const allSelected = sorted.length > 0 && sorted.every(item => selected.has(getId(item)));

    const toggleAll = useCallback(() => {
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(sorted.map(item => getId(item))));
        }
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
        if (!isServerMode) setCurrentPage(1);
        if (isServerMode && serverPagination?.onSearch) serverPagination.onSearch('');
    }, [filters, isServerMode, serverPagination]);

    const selectedItems = sorted.filter(item => selected.has(getId(item)));
    const hasActiveFilters = search.trim() !== '' || (!isServerMode && Object.values(filterValues).some(v => v !== 'all'));

    /* ---------------------------------------------------------------- */
    /*  Render                                                           */
    /* ---------------------------------------------------------------- */
    return (
        <div className="p-4 md:p-8 custom-scroll">
            {/* ==================== HEADER ==================== */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-sky-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 leading-tight">{title}</h1>
                        <p className="text-slate-500 text-xs mt-0.5">{totalRecords} سجل</p>
                    </div>
                    <span className="px-3 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 text-sm font-bold mr-2">
                        {totalRecords}
                    </span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                    {hasActiveFilters && (
                        <button
                            onClick={resetFilters}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-slate-600 hover:bg-gray-50 text-sm transition-colors whitespace-nowrap"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إعادة ضبط</span>
                        </button>
                    )}
                    <button
                        onClick={() => exportCSV(columns, sorted, title)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-slate-600 hover:bg-gray-50 text-sm transition-colors whitespace-nowrap"
                    >
                        <Download className="w-3.5 h-3.5" />
                        <span>تصدير Excel</span>
                    </button>
                    {headerActions}
                </div>
            </div>

            {/* ==================== FILTER BAR ==================== */}
            {!hideFilterBar && (
                <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 mb-5 flex items-center gap-3 flex-wrap">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={search}
                            onChange={e => handleSearchChange(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg pr-10 pl-4 py-2 text-sm text-slate-900 placeholder:text-gray-400 focus:border-sky-500 focus:outline-none transition-colors"
                        />
                    </div>

                    {/* Dropdowns — hidden in server mode (filtering happens server-side) */}
                    {!isServerMode && filters.map(f => (
                        <select
                            key={f.key}
                            value={filterValues[f.key]}
                            onChange={e => setFilterValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none transition-colors min-w-[140px]"
                        >
                            <option value="all">{f.label}</option>
                            {f.options.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    ))}
                </div>
            )}

            {/* ==================== BULK ACTIONS BAR ==================== */}
            {bulkActions && selected.size > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-sky-50 border border-sky-200 rounded-xl p-3 mb-4 flex items-center gap-3"
                >
                    <span className="text-sm text-sky-700 font-medium">تم تحديد {selected.size} عنصر</span>
                    <div className="mr-auto flex items-center gap-2">
                        {bulkActions.map((ba, i) => (
                            <button
                                key={i}
                                onClick={() => ba.onClick(selectedItems)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${ba.variant === 'danger'
                                    ? 'bg-red-600 hover:bg-red-500 text-white'
                                    : 'bg-sky-600 hover:bg-sky-500 text-white'
                                    }`}
                            >
                                <ba.icon className="w-3.5 h-3.5" />
                                <span>{ba.label}</span>
                            </button>
                        ))}
                    </div>
                </motion.div>
            )}

            {/* ==================== TABLE ==================== */}
            <div className="flex flex-col border rounded-2xl border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex-1 overflow-y-auto custom-scroll" style={{ maxHeight: '480px' }}>
                    <table className="w-full border-collapse">
                        <thead className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 shadow-sm">
                            <tr>
                                {/* Checkbox header */}
                                {bulkActions && (
                                    <th className="w-12 p-4 text-right">
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
                                        className={`text-right px-4 h-12 text-xs font-bold text-slate-500 uppercase tracking-wider ${col.width || ''} ${col.sortable ? 'cursor-pointer select-none hover:text-slate-700 transition-colors' : ''}`}
                                        onClick={() => col.sortable && handleSort(col.key)}
                                    >
                                        <div className="flex items-center gap-1">
                                            {col.label}
                                            {col.sortable && (
                                                <span className="text-gray-400">
                                                    {sortKey === col.key && sortDir === 'asc' ? (
                                                        <ChevronUp className="w-3.5 h-3.5 text-sky-600" />
                                                    ) : sortKey === col.key && sortDir === 'desc' ? (
                                                        <ChevronDown className="w-3.5 h-3.5 text-sky-600" />
                                                    ) : (
                                                        <ChevronsUpDown className="w-3 h-3" />
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                ))}

                                {/* Actions header */}
                                {actions && (
                                    <th className="text-right px-4 h-12 text-xs font-bold text-slate-500 uppercase tracking-wider">إجراءات</th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {paginatedData.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + (bulkActions ? 1 : 0) + (actions ? 1 : 0)} className="py-16 text-center">
                                        {EmptyIcon && <EmptyIcon className="w-12 h-12 mx-auto mb-4 text-slate-300" />}
                                        <p className="text-slate-500 text-sm font-medium">{emptyMessage}</p>
                                    </td>
                                </tr>
                            ) : paginatedData.map((item, rowIdx) => {
                                const id = getId(item);
                                const isSelected = selected.has(id);
                                const customRowClass = rowClassName ? rowClassName(item) : '';
                                return (
                                    <motion.tr
                                        key={String(id)}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className={`group transition-colors h-12 ${onRowClick ? 'cursor-pointer' : ''} ${isSelected ? 'bg-sky-50/60' : ''} ${!isSelected && rowIdx % 2 === 1 ? 'bg-slate-50/40' : ''} hover:bg-sky-50 ${customRowClass}`}
                                        onClick={() => onRowClick?.(item)}
                                    >
                                        {bulkActions && (
                                            <td className="w-12 px-4" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleOne(id)}
                                                    className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer accent-sky-600"
                                                />
                                            </td>
                                        )}
                                        {columns.map(col => (
                                            <td key={col.key} className={`px-4 py-2 ${col.width || ''} group-hover:text-sky-700 transition-colors`}>
                                                {col.render ? col.render(item) : (
                                                    <span className="text-sm text-slate-700">{String((item as any)[col.key] ?? '')}</span>
                                                )}
                                            </td>
                                        ))}
                                        {actions && (
                                            <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-end">{actions(item)}</div>
                                            </td>
                                        )}
                                    </motion.tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* ==================== PAGINATION FOOTER ==================== */}
                {totalRecords > 0 && (
                    <div className="sticky bottom-0 bg-white z-20 border-t border-gray-100 p-3 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-xs font-bold text-slate-500">
                            {isServerMode ? (
                                <>
                                    عرض <span className="text-slate-800">{(activePage - 1) * serverPagination!.limit + 1}</span>
                                    <span> - </span>
                                    <span className="text-slate-800">{Math.min(totalRecords, activePage * serverPagination!.limit)}</span>
                                    <span> من أصل </span>
                                    <span className="text-slate-800">{totalRecords}</span> سجل
                                </>
                            ) : (
                                <>
                                    عرض <span className="text-slate-800">{Math.min(sorted.length, (currentPage - 1) * ITEMS_PER_PAGE + 1)}</span>
                                    <span> - </span>
                                    <span className="text-slate-800">{Math.min(sorted.length, currentPage * ITEMS_PER_PAGE)}</span>
                                    <span> من أصل </span>
                                    <span className="text-slate-800">{sorted.length}</span> سجل
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-gray-200">
                            <button
                                disabled={activePage === 1}
                                onClick={() => handlePageChange(activePage - 1)}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white text-slate-600"
                            >
                                السابق
                            </button>

                            <div className="flex items-center gap-1 px-2">
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                    .filter(p => p === 1 || p === totalPages || Math.abs(p - activePage) <= 1)
                                    .map((p, i, arr) => (
                                        <div key={p} className="flex items-center gap-1">
                                            {i > 0 && arr[i - 1] !== p - 1 && <span className="text-slate-400 text-xs">...</span>}
                                            <button
                                                onClick={() => handlePageChange(p)}
                                                className={`w-7 h-7 flex items-center justify-center text-xs font-black rounded-lg transition-all ${activePage === p ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}
                                            >
                                                {p}
                                            </button>
                                        </div>
                                    ))}
                            </div>

                            <button
                                disabled={activePage === totalPages || totalPages === 0}
                                onClick={() => handlePageChange(activePage + 1)}
                                className="px-3 py-1.5 text-xs font-bold rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white text-slate-600"
                            >
                                التالي
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
