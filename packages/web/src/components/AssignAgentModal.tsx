import { useState, useEffect } from 'react';
import { X, UserCheck, Loader2 } from 'lucide-react';
import { useCollectionStore } from '../hooks/useCollectionStore';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import Select from './ui/Select';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

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
                        <IconButton icon={X} label="إغلاق" shape="circle" onClick={onClose} />
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex items-start gap-2">
                            <UserCheck className="w-4 h-4 mt-0.5 shrink-0" />
                            <p>سيتم تعيين <strong>{selectedDueIds.length}</strong> سجلات للموظف المختار.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">اختر الموظف</label>
                            <Select
                                value={selectedAgentId}
                                onChange={setSelectedAgentId}
                                placeholder="-- اختر --"
                                ariaLabel="اختر الموظف"
                                className="w-full"
                                options={telemarketers.map(t => ({ value: String(t.id), label: t.name }))}
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <Button
                                variant="secondary"
                                size="lg"
                                fullWidth
                                onClick={onClose}
                            >
                                إلغاء
                            </Button>
                            <Button
                                type="submit"
                                size="lg"
                                fullWidth
                                disabled={!selectedAgentId}
                            >
                                تعيين
                            </Button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
