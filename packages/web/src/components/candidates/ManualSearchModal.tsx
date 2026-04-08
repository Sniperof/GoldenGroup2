import { useState, useEffect } from 'react';
import { X, Search, CheckCircle2, AlertCircle, Clock, Link2, ArrowRight, User } from 'lucide-react';
import { Candidate, Client } from '../../lib/types';
import { performSmartSearch, SearchResult, ConfidenceScore } from '../../lib/searchUtils';

interface ManualSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    candidate: Partial<Candidate>;
    clients: Client[];
    candidates: any[];
    onLink: (entity: Client | Candidate, type: 'Client' | 'Candidate') => void;
    onNoMatch: () => void;
}

export default function ManualSearchModal({
    isOpen,
    onClose,
    candidate,
    clients,
    candidates,
    onLink,
    onNoMatch
}: ManualSearchModalProps) {
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const [inputs, setInputs] = useState({
        name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
        mobile: candidate.mobile || ''
    });

    useEffect(() => {
        if (isOpen) {
            setIsSearching(true);
            const searchCandidate = {
                firstName: inputs.name,
                mobile: inputs.mobile
            };
            const searchResults = performSmartSearch(searchCandidate, clients, candidates);
            setResults(searchResults);
            setIsSearching(false);
        }
    }, [isOpen, inputs, clients, candidates]);

    const getConfidenceUI = (confidence: ConfidenceScore) => {
        switch (confidence) {
            case 'High':
                return {
                    icon: CheckCircle2,
                    color: 'text-emerald-600',
                    bgColor: 'bg-emerald-50',
                    borderColor: 'border-emerald-100',
                    label: 'مطابقة عالية'
                };
            case 'Medium':
                return {
                    icon: Clock,
                    color: 'text-amber-600',
                    bgColor: 'bg-amber-50',
                    borderColor: 'border-amber-100',
                    label: 'مطابقة متوسطة'
                };
            case 'Low':
                return {
                    icon: AlertCircle,
                    color: 'text-rose-600',
                    bgColor: 'bg-rose-50',
                    borderColor: 'border-rose-100',
                    label: 'مطابقة ضعيفة'
                };
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <Search className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">التحقق الذكي (Smart Match)</h2>
                            <p className="text-sm text-slate-500">البحث عن زبائن مطابقين في قاعدة البيانات</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-4 custom-scrollbar bg-slate-50/30">
                    <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 space-y-4">
                        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                            <Search className="w-3.5 h-3.5" />
                            بيانات البحث والتحقق
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">الاسم / الكنية</label>
                                <input
                                    type="text"
                                    value={inputs.name}
                                    onChange={e => setInputs(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="ابحث بالاسم..."
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">رقم الموبايل</label>
                                <input
                                    type="text"
                                    value={inputs.mobile}
                                    onChange={e => setInputs(prev => ({ ...prev, mobile: e.target.value }))}
                                    placeholder="ابحث بالرقم..."
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all text-right"
                                    dir="ltr"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-700">نتائج البحث في قاعدة البيانات ({results.length})</h3>
                        </div>

                        {isSearching ? (
                            <div className="py-12 text-center">
                                <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                                <p className="text-slate-500 font-medium">جاري البحث والمطابقة...</p>
                            </div>
                        ) : results.length > 0 ? (
                            results.map(({ entity, recordType, confidence }) => {
                                const ui = getConfidenceUI(confidence);
                                const Icon = ui.icon;
                                const name = recordType === 'Client' ? (entity as Client).name : `${(entity as Candidate).firstName || ''} ${(entity as Candidate).lastName || ''}`.trim() || (entity as Candidate).nickname;
                                const mobile = (entity as any).mobile;
                                const neighborhood = (entity as any).neighborhood || (entity as any).neighborhoodText || 'حي غير محدد';

                                return (
                                    <div key={`${recordType}-${entity.id}`} className="group bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-100 shrink-0 bg-slate-50 flex items-center justify-center">
                                                <User className={`w-6 h-6 ${recordType === 'Client' ? 'text-sky-400' : 'text-amber-400'}`} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-bold text-slate-800">{name}</span>
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${recordType === 'Client' ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                                                        {recordType === 'Client' ? 'زبون حالي' : 'اسم مقترح'}
                                                    </span>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${ui.bgColor} ${ui.color} border ${ui.borderColor} flex items-center gap-1`}>
                                                        <Icon className="w-2.5 h-2.5" />
                                                        {ui.label}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-slate-500 font-medium">
                                                    <span className="font-mono">{mobile}</span>
                                                    <span>•</span>
                                                    <span>ID: #{entity.id}</span>
                                                    <span>•</span>
                                                    <span>{neighborhood}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => onLink(entity, recordType)}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border ${recordType === 'Client'
                                                ? 'bg-sky-50 text-sky-600 hover:bg-sky-600 hover:text-white border-sky-100'
                                                : 'bg-amber-50 text-amber-600 hover:bg-amber-600 hover:text-white border-amber-100'
                                                }`}
                                        >
                                            <Link2 className="w-4 h-4" />
                                            {recordType === 'Client' ? 'عرض الزبون' : 'عرض المقترح'}
                                        </button>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="py-12 text-center bg-white rounded-2xl border border-slate-100">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Search className="w-8 h-8 text-slate-300" />
                                </div>
                                <h4 className="text-slate-800 font-bold mb-1">لا توجد نتائج مطابقة</h4>
                                <p className="text-slate-500 text-sm">لم نتمكن من العثور على أي زبون يطابق هذه البيانات</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                        إغلاق
                    </button>
                    <button
                        onClick={onNoMatch}
                        className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-slate-600 hover:bg-slate-700 shadow-md rounded-xl transition-colors"
                    >
                        لا يوجد تطابق - متابعة
                        <ArrowRight className="w-4 h-4 ml-1" />
                    </button>
                </div>
            </div>
        </div>
    );
}
