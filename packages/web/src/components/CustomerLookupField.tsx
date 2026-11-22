// Server-side customer lookup with the contract form's behaviour: nothing is
// loaded until 2 characters are typed, a 300 ms debounce, the previous request
// aborted, at most 20 rows with a «more results» hint. The caller supplies the
// endpoint (its own permission and scope).
import { useEffect, useState } from 'react';
import { Loader2, Search, User, X } from './ui/icons';

export interface LookupCustomer {
    id: number;
    name: string;
    mobile: string;
    branchName: string | null;
}

interface Props {
    value: LookupCustomer | null;
    onChange: (customer: LookupCustomer | null) => void;
    search: (query: string, signal: AbortSignal) => Promise<{ items: LookupCustomer[]; hasMore: boolean }>;
    /** Customers never offered (e.g. the current holder). */
    excludeIds?: number[];
    placeholder?: string;
}

export default function CustomerLookupField({ value, onChange, search, excludeIds = [], placeholder = 'بحث بالاسم أو رقم الموبايل...' }: Props) {
    const [text, setText] = useState('');
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<LookupCustomer[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (value || !open) return;
        const query = text.trim();
        if (query.length < 2) {
            setItems([]);
            setLoading(false);
            setError(null);
            setHasMore(false);
            return;
        }
        const controller = new AbortController();
        setItems([]);
        setLoading(true);
        setError(null);
        setHasMore(false);
        const timer = window.setTimeout(() => {
            search(query, controller.signal)
                .then(result => {
                    setItems(result.items.filter(c => !excludeIds.includes(c.id)));
                    setHasMore(result.hasMore);
                })
                .catch(err => {
                    if (err?.name === 'AbortError') return;
                    setItems([]);
                    setError(err?.message ?? 'تعذّر البحث عن الزبائن');
                })
                .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        }, 300);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
        // excludeIds is a fresh array each render; its content is stable here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text, value, open, search]);

    return (
        <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
            <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input
                    type="text"
                    value={value ? value.name : text}
                    onChange={e => { setText(e.target.value); onChange(null); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-10 text-sm"
                />
                {value && (
                    <button
                        type="button"
                        onClick={() => { onChange(null); setText(''); setOpen(true); }}
                        aria-label="إلغاء اختيار الزبون"
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>
            {open && !value && (
                <div className="absolute top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {text.trim().length < 2 ? (
                        <div className="p-3 text-center text-sm text-slate-400">اكتب حرفين على الأقل للبحث</div>
                    ) : loading ? (
                        <div className="flex items-center justify-center gap-2 p-3 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> جارٍ البحث...
                        </div>
                    ) : error ? (
                        <div className="p-3 text-center text-sm text-red-500">{error}</div>
                    ) : items.length === 0 ? (
                        <div className="p-3 text-center text-sm text-slate-400">لا يوجد نتائج مطابقة</div>
                    ) : (
                        <>
                            {items.map(c => (
                                <button
                                    key={c.id}
                                    type="button"
                                    className="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-right transition-colors last:border-b-0 hover:bg-sky-50"
                                    onClick={() => { onChange(c); setText(''); setOpen(false); }}
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100">
                                        <User className="h-4 w-4 text-sky-600" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                                        <p className="text-xs text-slate-400">
                                            <span dir="ltr">{c.mobile}</span>
                                            {c.branchName ? <span> · {c.branchName}</span> : null}
                                        </p>
                                    </div>
                                </button>
                            ))}
                            {hasMore && (
                                <div className="bg-slate-50 p-2 text-center text-xs text-slate-400">
                                    توجد نتائج إضافية؛ اكتب اسماً أو رقماً أدق
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
