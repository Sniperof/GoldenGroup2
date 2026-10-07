import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, type BroadcastRecipient } from '../../lib/api';

interface Props {
    value: BroadcastRecipient | null;
    onChange: (recipient: BroadcastRecipient | null) => void;
    /** The branch the audience is narrowed to (null = the operator's whole scope). */
    branchId: number | null;
}

/**
 * Picks ONE notification recipient. Only active app-account holders are
 * offered — a client without an account can never receive a notification —
 * searched by name, app login phone (any format) or client id, within the
 * operator's branch scope (enforced by the server).
 */
export default function NotificationRecipientPicker({ value, onChange, branchId }: Props) {
    const [text, setText] = useState('');
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<BroadcastRecipient[]>([]);
    const [error, setError] = useState<string | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        const t = setTimeout(() => {
            api.admin.appNotifications.recipients(text.trim(), branchId)
                .then(res => { if (active) { setRows(res.items); setError(null); } })
                .catch(err => { if (active) { setRows([]); setError(err?.message || 'تعذر البحث'); } })
                .finally(() => { if (active) setLoading(false); });
        }, 300);
        return () => { active = false; clearTimeout(t); };
    }, [open, text, branchId]);

    if (value) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-800">{value.clientName}</div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                        <span dir="ltr" className="font-mono">{value.primaryMobile || '—'}</span>
                        <span>#{value.clientId}</span>
                        {value.branchName && <span>{value.branchName}</span>}
                    </div>
                </div>
                <button type="button" onClick={() => onChange(null)} aria-label="إزالة المستلم"
                    className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white hover:text-rose-600">
                    <X className="h-4 w-4" />
                </button>
            </div>
        );
    }

    return (
        <div ref={boxRef} className="relative">
            <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                value={text}
                onChange={e => { setText(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="ابحث بالاسم أو رقم الهاتف"
            />
            <p className="mt-1 text-xs text-slate-400">يظهر فقط الزبائن الذين لديهم حساب في التطبيق.</p>
            {open && (
                <div className="absolute top-full z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {error ? (
                        <div className="px-4 py-3 text-xs text-rose-600">{error}</div>
                    ) : rows.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-400">
                            {loading ? 'جارٍ البحث…' : 'لا يوجد صاحب حساب تطبيق مطابق ضمن نطاقك'}
                        </div>
                    ) : rows.map(r => (
                        <button key={r.clientId} type="button"
                            onClick={() => { onChange(r); setOpen(false); setText(''); }}
                            className="flex w-full items-center justify-between gap-3 border-b border-slate-50 px-4 py-2.5 text-right last:border-0 hover:bg-slate-50">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-bold text-slate-700">{r.clientName}</div>
                                <div className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                                    <span>#{r.clientId}</span>
                                    {r.branchName && <span>{r.branchName}</span>}
                                </div>
                            </div>
                            <span dir="ltr" className="shrink-0 font-mono text-xs text-slate-500">{r.primaryMobile || '—'}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
