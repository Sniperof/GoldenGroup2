import { useEffect, useState } from 'react';

/**
 * "انتقل إلى [ n ] من N" — type a page number, Enter/blur to go. Shared by
 * SmartTable's pager and the hand-rolled pagers (e.g. CandidatesEntry).
 */
export default function PageJump({ current, total, onJump }: { current: number; total: number; onJump: (p: number) => void }) {
    const [value, setValue] = useState(String(current));
    // Follow external page changes (buttons, filter resets).
    useEffect(() => { setValue(String(current)); }, [current]);

    const commit = () => {
        const n = Number.parseInt(value.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))), 10);
        // Invalid input reverts; out-of-range input clamps to the nearest valid page.
        if (!Number.isFinite(n)) { setValue(String(current)); return; }
        const target = Math.min(total, Math.max(1, n));
        setValue(String(target));
        if (target !== current) onJump(target);
    };

    return (
        <label className="flex items-center gap-1 pr-2 mr-1 border-r border-slate-200 text-xs text-slate-500">
            <span>انتقل إلى</span>
            <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); }}
                onBlur={commit}
                onFocus={e => e.target.select()}
                aria-label="رقم الصفحة"
                className="w-12 h-7 text-center bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:border-sky-500 focus:bg-white focus:outline-none"
            />
            <span>من {total}</span>
        </label>
    );
}
