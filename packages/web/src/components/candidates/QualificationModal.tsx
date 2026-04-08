import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, UserCheck, AlertCircle, ArrowRight, Trash2, Clock, CheckCircle2 } from 'lucide-react';
import { Candidate, Client } from '../../lib/types';
import { api } from '../../lib/api';

interface QualificationModalProps {
    isOpen: boolean;
    onClose: () => void;
    candidate: Candidate | null;
    onQualified: (candidate: Candidate) => void;
    onJunk: (id: number) => void;
    onLink: (candidateId: number, client: Client) => void;
    onFollowUp?: (id: number) => void;
}

export default function QualificationModal({ isOpen, onClose, candidate, onQualified, onJunk, onLink, onFollowUp }: QualificationModalProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearch, setActiveSearch] = useState('');
    const [clientsList, setClientsList] = useState<Client[]>([]);

    // Initialize search with candidate's mobile number
    React.useEffect(() => {
        if (isOpen && candidate) {
            setSearchQuery(candidate.mobile);
            setActiveSearch(candidate.mobile);
            setStep(1);
        }
    }, [isOpen, candidate]);

    React.useEffect(() => {
        if (!isOpen) return;

        let active = true;

        api.clients.list()
            .then((clients) => {
                if (active) setClientsList(clients);
            })
            .catch((error) => {
                console.error('Failed to load clients for qualification modal:', error);
                if (active) setClientsList([]);
            });

        return () => {
            active = false;
        };
    }, [isOpen]);

    // Step 1: Search for duplicates or manual search results
    const searchResults = useMemo(() => {
        if (!activeSearch || !isOpen) return [];

        const normalizeArabic = (text: string) => {
            return text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
        };

        const terms = normalizeArabic(activeSearch).trim().split(/\s+/).filter(t => t.length > 0);

        return clientsList.filter(c => {
            const clientDataString = normalizeArabic(`${c.id} ${c.name} ${c.mobile} ${c.governorate} ${c.neighborhood} ${c.sourceChannel || ''}`);
            return terms.every(term => clientDataString.includes(term));
        }).slice(0, 10); // Limit to 10 results for performance
    }, [activeSearch, isOpen]);

    if (!isOpen || !candidate) return null;

    const handleSearchTrigger = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setActiveSearch(searchQuery);
    };

    const handleClose = () => {
        setStep(1);
        onClose();
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center">
                                <Search className="w-5 h-5 text-sky-600" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-800">تأهيل وتحقق </h2>
                                <p className="text-xs text-slate-500">الاسم المقترح: {candidate.firstName} {candidate.nickname}</p>
                            </div>
                        </div>
                        <button onClick={handleClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6">
                        {step === 1 ? (
                            <div className="space-y-6">
                                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                    <div>
                                        <h4 className="text-sm font-bold text-amber-900 mb-1">نتائج التحقق من التكرار</h4>
                                        <p className="text-xs text-amber-700 leading-relaxed">
                                            النظام يقوم بالبحث عن أي زبائن حاليين يمتلكون نفس رقم الهاتف ({candidate.mobile}).
                                        </p>
                                    </div>
                                </div>

                                <form onSubmit={handleSearchTrigger} className="flex flex-col sm:flex-row gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input
                                            type="text"
                                            placeholder="البحث الذكي: الاسم، الرقم، الكنية، أو ID..."
                                            value={searchQuery}
                                            onChange={(e) => {
                                                setSearchQuery(e.target.value);
                                                setActiveSearch(e.target.value);
                                            }}
                                            className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 text-sm"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        className="px-6 py-2.5 bg-sky-600 text-white rounded-xl font-bold text-sm hover:bg-sky-500 transition-all flex items-center justify-center gap-2 shadow-sm shrink-0"
                                    >
                                        <Search className="w-4 h-4" />
                                        <span>بحث عميق</span>
                                    </button>
                                </form>

                                <div className="space-y-3">
                                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">النتائج المطابقة:</h3>
                                    {searchResults.length === 0 ? (
                                        <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                                            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                                            <p className="text-sm text-slate-400 font-medium">لا يوجد تطابق. الرقم جديد كلياً!</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {searchResults.map(d => {
                                                const clientType = d.isCandidate ? (d.candidateStatus || 'محتمل') : 'زبون متعاقد';
                                                return (
                                                    <button
                                                        key={d.id}
                                                        onClick={() => {
                                                            if (window.confirm(`تأكيد وتطابق الاسم المقترح مع هذا السجل؟\n\nالزبون المطابق: ${d.name}\nنوع الزبون: ${clientType}`)) {
                                                                if (candidate) onLink(candidate.id, d);
                                                            }
                                                        }}
                                                        className="w-full text-right py-2 px-3 rounded-xl border border-red-100 bg-red-50/30 hover:bg-red-50 hover:border-red-200 transition-all flex items-center justify-between group cursor-pointer"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-xs group-hover:bg-red-200 transition-colors">{d.id}</div>
                                                            <div>
                                                                <div className="text-sm font-bold text-slate-800">{d.name}</div>
                                                                <div className="text-[10px] text-slate-500">{d.governorate} - {d.neighborhood}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-left flex flex-col items-end">
                                                            <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold mb-0.5 group-hover:bg-red-200 transition-colors">اختيار وتأكيد</span>
                                                            <span className="text-[10px] text-slate-500 font-bold">{clientType}</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => setStep(2)}
                                    className="w-full mt-4 flex items-center justify-center gap-2 bg-slate-900 text-white py-3.5 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20"
                                >
                                    <span>متابعة الإجراء</span>
                                    <ArrowRight className="w-4 h-4 mr-1 rotate-180" />
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <div className="text-center space-y-2 mb-2">
                                    <h3 className="text-lg font-bold text-slate-800">اتخاذ إجراء نهائي</h3>
                                    <p className="text-sm text-slate-500">تم التأكد من صحة البيانات. ماذا تريد أن تفعل؟</p>
                                </div>

                                {/* Summary Card */}
                                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-4">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-slate-500 font-bold">بيانات الاسم المقترح</span>
                                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md font-mono font-bold tracking-widest">{candidate.mobile}</span>
                                    </div>
                                    <div className="text-base font-black text-slate-800 mb-3">{candidate.firstName} {candidate.lastName} {candidate.nickname ? `(${candidate.nickname})` : ''}</div>

                                    <div className="flex justify-between items-center pt-3 border-t border-slate-200/60 mb-1">
                                        <span className="text-xs text-slate-500 font-bold">اسم الوسيط</span>
                                        <span className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">{candidate.referralType}</span>
                                    </div>
                                    <div className="text-sm font-bold text-slate-800">{candidate.referralNameSnapshot}</div>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    <button
                                        onClick={() => onQualified(candidate)}
                                        className="flex items-center gap-4 p-4 rounded-2xl border-2 border-emerald-100 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-200 transition-all text-right group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-md shadow-emerald-600/20">
                                            <CheckCircle2 className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-emerald-900">تحويل لاسم مرشح جديد</div>
                                            <div className="text-xs text-emerald-700 mt-0.5">فتح استمارة الزبون مع نقل كافة البيانات</div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => onJunk(candidate.id)}
                                        className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-100 transition-all text-right group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0 group-hover:bg-red-100 group-hover:text-red-600 transition-all">
                                            <Trash2 className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-slate-800 group-hover:text-red-700">استبعاد</div>
                                            <div className="text-xs text-slate-500 mt-0.5">تصنيف الاسم كغير صالح للأرشفة</div>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (onFollowUp) onFollowUp(candidate.id);
                                            handleClose();
                                        }}
                                        className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-all text-right group"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
                                            <Clock className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-slate-800">مراجعة لاحقاً</div>
                                            <div className="text-xs text-slate-500 mt-0.5">تغيير الحالة إلى "متابعة" لجمع معلومات إضافية</div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
