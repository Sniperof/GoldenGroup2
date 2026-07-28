import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, UserPlus, UserCheck, ClipboardList } from './ui/icons';

interface EdgeQuickAddProps {
    onAddSuggested: () => void;
    onAddCandidate: () => void;
    onServiceRequestClick: () => void;
}

// A handle docked to the LEFT edge of the screen, vertically centred. Living on
// the vertical edge — not a bottom corner — it can never overlap a page's sticky
// bottom bar. On DESKTOP (lg+, hover-capable) it only peeks at rest and slides
// fully into view on hover; on MOBILE/tablet (touch, no hover) it stays fully
// visible on the edge so it's always tappable. Tapping opens the menu to its right.
export default function EdgeQuickAdd({ onAddSuggested, onAddCandidate, onServiceRequestClick }: EdgeQuickAddProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    return (
        <div
            ref={ref}
            dir="ltr"
            // Bottom-left corner on every size, menu opens upward (flex-col-reverse
            // puts the button at the bottom, menu above it). The only difference by
            // size is the button itself: mobile/tablet keep it fully visible (left-5),
            // desktop (lg+) tucks it flush to the edge (left-0) so it can peek/hover.
            className="group fixed bottom-5 left-5 z-[70] flex flex-col-reverse items-start gap-3 lg:left-0"
        >
            {/* Circular handle docked to the edge. On lg+ its left half is tucked
                off-screen so only a half-circle peeks, and hover slides it fully into
                view. Below lg (touch) it stays fully visible on the edge. Clicking
                opens the options. */}
            <motion.button
                onClick={() => setOpen(o => !o)}
                aria-label="إضافة سريعة"
                aria-expanded={open}
                className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg shadow-sky-500/40 transition-all duration-300 ease-out hover:shadow-xl hover:shadow-sky-500/50 active:scale-95 ${open ? 'translate-x-0' : 'translate-x-0 lg:-translate-x-1/2 lg:group-hover:translate-x-0'}`}
            >
                <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                    <Plus className="h-7 w-7" strokeWidth={2.5} />
                </motion.span>
            </motion.button>

            {/* Action menu — opens upward, above the handle. RTL content. */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        dir="rtl"
                        initial={{ opacity: 0, y: 12, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                        className="flex flex-col gap-2"
                    >
                        <button
                            onClick={() => { onServiceRequestClick(); setOpen(false); }}
                            className="flex items-center gap-3 whitespace-nowrap rounded-xl border border-red-100 bg-white px-4 py-3 shadow-xl transition-all hover:border-red-300 hover:shadow-2xl group/item"
                        >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 transition-colors group-hover/item:bg-red-100">
                                <ClipboardList className="h-5 w-5 text-red-600" />
                            </div>
                            <span className="text-sm font-bold text-red-600">طلب صيانة</span>
                        </button>

                        <button
                            onClick={() => { onAddSuggested(); setOpen(false); }}
                            className="flex items-center gap-3 whitespace-nowrap rounded-xl border border-amber-100 bg-white px-4 py-3 shadow-xl transition-all hover:border-amber-300 hover:shadow-2xl group/item"
                        >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 transition-colors group-hover/item:bg-amber-100">
                                <UserPlus className="h-5 w-5 text-amber-600" />
                            </div>
                            <span className="text-sm font-bold text-amber-600">إضافة اسم مقترح جديد</span>
                        </button>

                        <button
                            onClick={() => { onAddCandidate(); setOpen(false); }}
                            className="flex items-center gap-3 whitespace-nowrap rounded-xl border border-indigo-100 bg-white px-4 py-3 shadow-xl transition-all hover:border-indigo-300 hover:shadow-2xl group/item"
                        >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 transition-colors group-hover/item:bg-indigo-100">
                                <UserCheck className="h-5 w-5 text-indigo-600" />
                            </div>
                            <span className="text-sm font-bold text-indigo-600">إضافة اسم مرشح جديد</span>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
