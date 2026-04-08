import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, AlertTriangle, UserPlus, UserCheck } from 'lucide-react';

interface FloatingActionButtonProps {
    onEmergencyClick: () => void;
    onAddSuggested: () => void;
    onAddCandidate: () => void;
}

export default function FloatingActionButton({ onEmergencyClick, onAddSuggested, onAddCandidate }: FloatingActionButtonProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            {/* Backdrop */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[2px]"
                        onClick={() => setIsOpen(false)}
                    />
                )}
            </AnimatePresence>

            <div className="fixed bottom-6 left-6 z-[70] flex flex-col-reverse items-center gap-3">
                {/* Main FAB */}
                <motion.button
                    onClick={() => setIsOpen(o => !o)}
                    className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-lg shadow-sky-500/40 hover:shadow-xl hover:shadow-sky-500/50 flex items-center justify-center transition-all active:scale-95"
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    aria-label="القائمة السريعة"
                >
                    <Plus className="w-7 h-7" strokeWidth={2.5} />
                </motion.button>

                {/* Speed Dial Options (They go up because of flex-col-reverse) */}
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.8 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 20, scale: 0.8 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            className="flex flex-col-reverse gap-2"
                        >
                            <button
                                onClick={() => { onEmergencyClick(); setIsOpen(false); }}
                                className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-xl border border-red-100 hover:border-red-300 hover:shadow-2xl transition-all group whitespace-nowrap"
                            >
                                <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                                    <AlertTriangle className="w-5 h-5 text-red-600" />
                                </div>
                                <span className="text-sm font-bold text-red-600">🚨 طلب طوارئ</span>
                            </button>

                            <button
                                onClick={() => { onAddSuggested(); setIsOpen(false); }}
                                className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-xl border border-amber-100 hover:border-amber-300 hover:shadow-2xl transition-all group whitespace-nowrap"
                            >
                                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                                    <UserPlus className="w-5 h-5 text-amber-600" />
                                </div>
                                <span className="text-sm font-bold text-amber-600"> إضافة اسم مقترح جديد</span>
                            </button>

                            <button
                                onClick={() => { onAddCandidate(); setIsOpen(false); }}
                                className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-xl border border-indigo-100 hover:border-indigo-300 hover:shadow-2xl transition-all group whitespace-nowrap"
                            >
                                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                                    <UserCheck className="w-5 h-5 text-indigo-600" />
                                </div>
                                <span className="text-sm font-bold text-indigo-600"> إضافة اسم مرشح جديد</span>
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </>
    );
}
