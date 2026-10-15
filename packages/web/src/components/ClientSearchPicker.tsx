import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Client } from '../lib/types';

export interface PickedClient {
    id: number;
    name: string;
}

interface Props {
    value: PickedClient | null;
    onChange: (client: PickedClient | null) => void;
    /** Clients that must never be offered (e.g. the device's current owner). */
    excludeIds?: number[];
    placeholder?: string;
}

const STAGE_BADGE: Record<string, { label: string; cls: string }> = {
    OP: { label: 'زبون OP', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    FOP: { label: 'زبون محتمل FOP', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    Lead: { label: 'اسم مرشح', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

/**
 * Searchable client picker — same behaviour as the Client-type mediator field
 * in ClientModal: opens on focus, debounced scoped server search over
 * /clients/paged (name / id / phone), never loads the whole client table.
 */
export default function ClientSearchPicker({ value, onChange, excludeIds = [], placeholder = 'ابحث عن الزبون بالاسم أو رقم الهاتف...' }: Props) {
    const [text, setText] = useState(value?.name ?? '');
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<Client[]>([]);
    const boxRef = useRef<HTMLDivElement>(null);
    const excludeKey = excludeIds.join(',');

    useEffect(() => { setText(value?.name ?? ''); }, [value?.id, value?.name]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // While a client is picked the box shows its name; search only once the text diverges.
    const query = value && text === value.name ? '' : text.trim();
    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        const timer = setTimeout(() => {
            api.clients.listPaged({ search: query || undefined, limit: query ? 10 : 20 })
                .then(res => {
                    if (!active) return;
                    const excluded = new Set(excludeKey ? excludeKey.split(',').map(Number) : []);
                    setRows((res.items as Client[]).filter(c => !c.isCandidate && !excluded.has(Number(c.id))));
                })
                .catch(() => { if (active) setRows([]); })
                .finally(() => { if (active) setLoading(false); });
        }, 300);
        return () => { active = false; clearTimeout(timer); };
    }, [open, query, excludeKey]);

    const handleType = (next: string) => {
        setText(next);
        setOpen(true);
        if (value && next !== value.name) onChange(null);
    };

    const pick = (client: Client) => {
        onChange({ id: Number(client.id), name: client.name });
        setText(client.name);
        setOpen(false);
    };

    return (
        <div ref={boxRef} className="relative">
            <input
                type="text"
                value={text}
                onChange={e => handleType(e.target.value)}
                onFocus={() => setOpen(true)}
                placeholder={placeholder}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none ${value ? 'border-emerald-300' : 'border-slate-200'}`}
            />
            {open && (rows.length > 0 || loading || query) && (
                <div className="absolute top-full mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-20">
                    {rows.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-400">{loading ? 'جارٍ البحث…' : 'لا توجد نتائج ضمن صلاحياتك'}</div>
                    ) : rows.map(client => {
                        const stage = STAGE_BADGE[(client as Client & { lifecycleStage?: string }).lifecycleStage ?? 'Lead'] ?? STAGE_BADGE.Lead;
                        const phone = client.contacts?.find(c => c.isPrimary)?.number || client.contacts?.[0]?.number || client.mobile || '--';
                        return (
                            <button
                                key={client.id}
                                type="button"
                                onClick={() => pick(client)}
                                className="w-full text-right px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex items-center justify-between"
                            >
                                <div className="flex flex-col items-start gap-1">
                                    <span className="font-bold text-slate-700 text-sm">{client.name}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${stage.cls}`}>{stage.label}</span>
                                </div>
                                <span className="text-xs text-slate-400 font-mono" dir="ltr">{phone}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
