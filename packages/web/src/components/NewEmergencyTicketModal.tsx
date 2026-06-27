import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, ShieldCheck, FileText, Paperclip, Send, Image, Trash2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../hooks/useAuthStore';
import { useClientStore } from '../hooks/useClientStore';
import { useEmergencyStore } from '../hooks/useEmergencyStore';
import { api } from '../lib/api';
import type { Client, Contract, ClientRating } from '../lib/types';
import Select from './ui/Select';
import Button from './ui/Button';
import Modal from './ui/Modal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const RATING_LABELS: Record<ClientRating, { label: string; color: string }> = {
    Committed: { label: 'ملتزم', color: 'bg-green-50 text-green-700 border-green-200' },
    NotCommitted: { label: 'غير ملتزم', color: 'bg-red-50 text-red-700 border-red-200' },
    Undefined: { label: 'غير محدد', color: 'bg-slate-50 text-slate-500 border-slate-200' },
};

export default function NewEmergencyTicketModal({ isOpen, onClose }: Props) {
    const { clients, loadClients } = useClientStore();
    const { addTicket } = useEmergencyStore();
    const user = useAuthStore((state) => state.user);

    // --- State ---
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<Client[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [clientContracts, setClientContracts] = useState<Contract[]>([]);
    const [allContracts, setAllContracts] = useState<Contract[]>([]);
    const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
    const [problemDescription, setProblemDescription] = useState('');
    const [callNotes, setCallNotes] = useState('');
    const [attachments, setAttachments] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Reset on open/close ---
    useEffect(() => {
        if (isOpen) {
            loadClients();
            setSearchQuery('');
            setSearchResults([]);
            setShowDropdown(false);
            setSelectedClient(null);
            setClientContracts([]);
            setSelectedContractId(null);
            setProblemDescription('');
            setCallNotes('');
            setAttachments([]);
            setShowSuccess(false);
        }
    }, [isOpen, loadClients]);

    useEffect(() => {
        if (!isOpen) return;

        let active = true;

        api.contracts.list()
            .then((contracts) => {
                if (active) setAllContracts(contracts);
            })
            .catch((error) => {
                console.error('Failed to load contracts for emergency ticket modal:', error);
                if (active) setAllContracts([]);
            });

        return () => {
            active = false;
        };
    }, [isOpen]);

    // --- Debounced Search ---
    const performSearch = useCallback((query: string) => {
        if (!query.trim() || query.length < 2) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }
        const q = query.trim().toLowerCase();
        const results = clients.filter(c => {
            const name = (c.name || `${c.firstName || ''} ${c.lastName || ''}`).toLowerCase();
            const nickname = (c.nickname || '').toLowerCase();
            const phone = (c.mobile || '');
            const contacts = c.contacts || [];
            const primaryNumber = contacts.find(co => co.isPrimary)?.number || contacts[0]?.number || '';
            return name.includes(q) || nickname.includes(q) || phone.includes(q) || primaryNumber.includes(q);
        }).slice(0, 10);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
    }, [clients]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => performSearch(searchQuery), 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [searchQuery, performSearch]);

    // --- Client Selection ---
    const handleClientSelect = useCallback((client: Client) => {
        setSelectedClient(client);
        setSearchQuery(client.name || `${client.firstName || ''} ${client.lastName || ''}`);
        setShowDropdown(false);
        // Load contracts for this client
        const filtered = allContracts.filter(c => c.customerId === client.id);
        setClientContracts(filtered);
        setSelectedContractId(filtered.length === 1 ? filtered[0].id : null);
    }, [allContracts]);

    // --- Click outside to close dropdown ---
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // --- Attachments ---
    const handleFileAdd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        Array.from(files).forEach(file => {
            if (file.size > 2 * 1024 * 1024) return; // 2MB limit
            if (attachments.length >= 3) return;
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setAttachments(prev => prev.length < 3 ? [...prev, reader.result as string] : prev);
                }
            };
            reader.readAsDataURL(file);
        });
        e.target.value = '';
    }, [attachments.length]);

    // --- Submit ---
    const selectedContract = useMemo(() =>
        clientContracts.find(c => c.id === selectedContractId) || null,
        [clientContracts, selectedContractId]
    );

    const canSubmit = selectedClient && problemDescription.trim().length > 0 && !isSubmitting;

    const handleSubmit = useCallback(async () => {
        if (!selectedClient || !problemDescription.trim()) return;
        setIsSubmitting(true);

        const clientAddress = [selectedClient.governorate, selectedClient.district, selectedClient.neighborhood]
            .filter((v) => v && v.trim() !== '').join(' / ') || 'غير محدد';

        const ticketPayload = {
            clientId: selectedClient.id,
            clientName: selectedClient.name || `${selectedClient.firstName || ''} ${selectedClient.lastName || ''}`,
            clientAddress,
            clientRating: selectedClient.rating || 'Undefined',
            contractId: selectedContract?.id ?? null,
            deviceModelName: selectedContract?.deviceModelName ?? null,
            problemDescription: problemDescription.trim(),
            callNotes: callNotes.trim() || undefined,
            attachments,
            priority: 'Normal',
            status: 'New',
            assignedTechnicianId: null,
            openTaskId: null,
        };

        const created = await addTicket(ticketPayload as Parameters<typeof addTicket>[0]);

        if (!created) {
            setIsSubmitting(false);
            return;
        }

        setShowSuccess(true);
        setTimeout(() => {
            onClose();
            setIsSubmitting(false);
        }, 1200);
    }, [selectedClient, problemDescription, callNotes, attachments, selectedContract, addTicket, onClose]);

    // --- Render ---
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            className="relative"
            title={
                <span className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    طلب طوارئ جديد
                </span>
            }
            subtitle="إنشاء بلاغ صيانة طارئ"
            footer={
                <div className="w-full flex justify-between items-center gap-3">
                    <Button variant="ghost" onClick={onClose}>إلغاء</Button>
                    <Button
                        variant="danger"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        icon={Send}
                    >
                        إرسال الطلب
                    </Button>
                </div>
            }
        >
                    {/* Success Overlay */}
                    {showSuccess && (
                        <div className="absolute inset-0 bg-white/95 z-10 flex flex-col items-center justify-center gap-4">
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center"
                            >
                                <Send className="w-10 h-10 text-emerald-600" />
                            </motion.div>
                            <p className="text-lg font-bold text-slate-800">تم إرسال الطلب بنجاح! ✓</p>
                        </div>
                    )}

                    {/* Content */}
                    <div className="p-6 space-y-5">
                        {/* Step 1: Client Search */}
                        <div ref={searchRef} className="relative">
                            <label className="text-xs font-bold text-slate-500 block mb-1.5">البحث عن الزبون</label>
                            <div className="relative">
                                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    value={searchQuery}
                                    onChange={e => {
                                        setSearchQuery(e.target.value);
                                        if (selectedClient) {
                                            setSelectedClient(null);
                                            setClientContracts([]);
                                            setSelectedContractId(null);
                                        }
                                    }}
                                    placeholder="اكتب اسم الزبون أو رقم الهاتف..."
                                    className="w-full border border-slate-200 rounded-xl px-10 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all"
                                    autoFocus
                                />
                            </div>

                            {/* Dropdown */}
                            <AnimatePresence>
                                {showDropdown && searchResults.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto"
                                    >
                                        {searchResults.map(client => {
                                            const displayName = client.name || `${client.firstName || ''} ${client.lastName || ''}`;
                                            const phone = client.contacts?.find(c => c.isPrimary)?.number || client.mobile || '';
                                            return (
                                                <button
                                                    key={client.id}
                                                    onClick={() => handleClientSelect(client)}
                                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-sky-50 transition-colors text-right border-b border-slate-50 last:border-0"
                                                >
                                                    <div className="w-9 h-9 rounded-full bg-sky-50 flex items-center justify-center text-sky-600 text-xs font-bold border border-sky-100">
                                                        {displayName[0] || '?'}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-slate-800 truncate">{displayName}</p>
                                                        <p className="text-xs text-slate-400 truncate">{phone}</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </motion.div>
                                )}
                                {showDropdown && searchResults.length === 0 && searchQuery.length >= 2 && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 p-4 text-center"
                                    >
                                        <p className="text-sm text-slate-400">لم يتم العثور على نتائج</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Step 2: Auto-Populated Client Info */}
                        {selectedClient && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="space-y-3"
                            >
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                        <p className="text-xs text-slate-400 font-bold mb-1">الزبون</p>
                                        <p className="text-sm font-bold text-slate-800 truncate">{selectedClient.name || `${selectedClient.firstName} ${selectedClient.lastName}`}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                        <div className="flex items-center gap-1 mb-1">
                                            <MapPin className="w-3 h-3 text-slate-400" />
                                            <p className="text-xs text-slate-400 font-bold">العنوان</p>
                                        </div>
                                        <p className="text-xs font-medium text-slate-600 truncate">{selectedClient.neighborhood || selectedClient.district || 'غير محدد'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                                        <div className="flex items-center gap-1 mb-1">
                                            <ShieldCheck className="w-3 h-3 text-slate-400" />
                                            <p className="text-xs text-slate-400 font-bold">التقييم</p>
                                        </div>
                                        {(() => {
                                            const r = RATING_LABELS[selectedClient.rating || 'Undefined'];
                                            return <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${r.color}`}>{r.label}</span>;
                                        })()}
                                    </div>
                                </div>

                                {/* Contract/Device Selection */}
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1.5">الجهاز / العقد</label>
                                    {clientContracts.length > 0 ? (
                                        <Select
                                            value={selectedContractId === null ? '' : String(selectedContractId)}
                                            onChange={v => setSelectedContractId(v === '' ? null : Number(v))}
                                            placeholder="— اختر الجهاز —"
                                            ariaLabel="الجهاز / العقد"
                                            className="w-full"
                                            options={clientContracts.map(c => ({ value: String(c.id), label: `${c.deviceModelName} — ${c.serialNumber || c.contractNumber}` }))}
                                        />
                                    ) : (
                                        <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-center">
                                            <p className="text-xs text-amber-600 font-medium">لا توجد أجهزة مسجلة لهذا الزبون</p>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* Step 3: Manual Entry */}
                        {selectedClient && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="space-y-4 pt-2 border-t border-slate-100"
                            >
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1.5">
                                        <FileText className="w-3 h-3 inline-block ml-1" />
                                        وصف المشكلة <span className="text-red-400">*</span>
                                    </label>
                                    <textarea
                                        value={problemDescription}
                                        onChange={e => setProblemDescription(e.target.value)}
                                        placeholder="صف المشكلة بالتفصيل..."
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none resize-none h-24"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1.5">ملاحظات المكالمة (اختياري)</label>
                                    <textarea
                                        value={callNotes}
                                        onChange={e => setCallNotes(e.target.value)}
                                        placeholder="أي ملاحظات إضافية..."
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none resize-none h-16"
                                    />
                                </div>

                                {/* Attachments */}
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1.5">
                                        <Paperclip className="w-3 h-3 inline-block ml-1" />
                                        مرفقات (اختياري — حد أقصى 3 صور)
                                    </label>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {attachments.map((att, i) => (
                                            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 group">
                                                <img src={att} alt="" className="w-full h-full object-cover" />
                                                <button
                                                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                                >
                                                    <Trash2 className="w-4 h-4 text-white" />
                                                </button>
                                            </div>
                                        ))}
                                        {attachments.length < 3 && (
                                            <label className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:border-sky-300 hover:bg-sky-50/50 transition-all">
                                                <Image className="w-5 h-5 text-slate-300" />
                                                <input type="file" accept="image/*" onChange={handleFileAdd} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                </div>

                                {/* Call Receiver */}
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-200">
                                        <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || '')}&background=0ea5e9&color=fff`} alt="" className="w-full h-full" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400 font-bold">مستقبل المكالمة</p>
                                        <p className="text-sm font-bold text-slate-700">{user?.name || 'غير محدد'}</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </div>
        </Modal>
    );
}
