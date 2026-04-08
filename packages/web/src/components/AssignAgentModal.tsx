import { useState, useEffect } from 'react';
import { X, UserCheck, Loader2 } from 'lucide-react';
import { useCollectionStore } from '../hooks/useCollectionStore';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface AssignAgentModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedDueIds: number[];
}

export default function AssignAgentModal({ isOpen, onClose, selectedDueIds }: AssignAgentModalProps) {
    const { assignAgent } = useCollectionStore();
    const [selectedAgentId, setSelectedAgentId] = useState<string>('');
    const [telemarketers, setTelemarketers] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            api.employees.list()
                .then(data => setTelemarketers(data.filter((e: any) => e.role === 'telemarketer')))
                .catch(console.error)
                .finally(() => setLoading(false));
        }
    }, [isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAgentId) return;

        assignAgent(selectedDueIds, Number(selectedAgentId));
        onClose();
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
                >
                    <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h3 className="text-lg font-bold text-slate-900">تعيين موظف</h3>
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex items-start gap-2">
                            <UserCheck className="w-4 h-4 mt-0.5 shrink-0" />
                            <p>سيتم تعيين <strong>{selectedDueIds.length}</strong> سجلات للموظف المختار.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">اختر الموظف</label>
                            <select
                                required
                                value={selectedAgentId}
                                onChange={(e) => setSelectedAgentId(e.target.value)}
                                className="w-full p-3 rounded-xl border border-gray-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none bg-white"
                            >
                                <option value="">-- اختر --</option>
                                {telemarketers.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-slate-600 font-medium hover:bg-gray-50 transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                type="submit"
                                disabled={!selectedAgentId}
                                className="flex-1 py-3 px-4 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-sky-200"
                            >
                                تعيين
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
