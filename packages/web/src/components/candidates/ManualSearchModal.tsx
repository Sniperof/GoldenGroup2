import { useEffect, useMemo, useState } from 'react';
import { X, Search, AlertCircle, ArrowLeft, User, Lock, Pencil, Link2, Loader2 } from 'lucide-react';
import { Candidate, Client, ClientSmartMatchResponse } from '../../lib/types';
import { api } from '../../lib/api';

interface ManualSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    candidate: Partial<Candidate>;
    onLink: (entity: Client, type: 'Client') => void;
    onNoMatch: (verifiedMobile: string) => void;
}

const RESTRICTED_MESSAGE = 'الرقم موجود مسبقاً في النظام ولا يمكنك عرض تفاصيله. يرجى مراجعة الإدارة أو مدير الفرع.';
const DEFAULT_ERROR_MESSAGE = 'حدث خطأ أثناء الفحص. أعد المحاولة بعد قليل.';

const SYRIAN_MOBILE_PATTERN = /^09\d{8}$/;

function extractSmartMatchErrorMessage(error: unknown): string {
    if (!(error instanceof Error) || !error.message) {
        return DEFAULT_ERROR_MESSAGE;
    }

    const apiErrorPrefix = /^API Error \d+:\s*/;
    const rawMessage = error.message.replace(apiErrorPrefix, '').trim();
    if (!rawMessage) {
        return DEFAULT_ERROR_MESSAGE;
    }

    try {
        const parsed = JSON.parse(rawMessage);
        if (parsed && typeof parsed === 'object') {
            const candidateMessage = (parsed.error ?? parsed.message) as unknown;
            if (typeof candidateMessage === 'string' && candidateMessage.trim()) {
                return candidateMessage.trim();
            }
        }
    } catch {
        // Fall back to the raw message when the API returned plain text.
    }

    return rawMessage;
}

export default function ManualSearchModal({
    isOpen,
    onClose,
    candidate,
    onLink,
    onNoMatch
}: ManualSearchModalProps) {
    const [matchResult, setMatchResult] = useState<ClientSmartMatchResponse | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    const [inputs, setInputs] = useState({
        name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
        mobile: candidate.mobile || ''
    });

    const isValidSyrianMobile = SYRIAN_MOBILE_PATTERN.test(inputs.mobile);

    useEffect(() => {
        if (!isOpen) {
            setMatchResult(null);
            setIsSearching(false);
            setSearchError(null);
            return;
        }

        setInputs({
            name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
            mobile: candidate.mobile || ''
        });
    }, [candidate.firstName, candidate.lastName, candidate.mobile, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (!isValidSyrianMobile) {
            setMatchResult(null);
            setIsSearching(false);
            setSearchError(null);
            return;
        }

        let active = true;

        const runSmartMatch = async () => {
            try {
                setIsSearching(true);
                setSearchError(null);
                const result = await api.clients.smartMatch({
                    name: inputs.name.trim() || undefined,
                    phone: inputs.mobile,
                }) as ClientSmartMatchResponse;

                if (active) {
                    setMatchResult(result);
                }
            } catch (error) {
                console.error('Smart match failed:', error);
                if (active) {
                    setMatchResult(null);
                    setSearchError(extractSmartMatchErrorMessage(error));
                }
            } finally {
                if (active) {
                    setIsSearching(false);
                }
            }
        };

        runSmartMatch();

        return () => {
            active = false;
        };
    }, [inputs.mobile, inputs.name, isOpen, isValidSyrianMobile]);

    const phoneVerified = isValidSyrianMobile && matchResult?.status === 'NO_MATCH' && !isSearching;

    const mobileInputState = useMemo(() => {
        if (phoneVerified) {
            return 'verified';
        }

        if (matchResult?.status === 'MATCH_RESTRICTED') {
            return 'restricted';
        }

        if (matchResult?.status === 'MATCH_VISIBLE') {
            return 'duplicate';
        }

        return isValidSyrianMobile ? 'ready' : 'default';
    }, [isValidSyrianMobile, matchResult?.status, phoneVerified]);

    const handleUnlockMobile = () => {
        setInputs(prev => ({ ...prev, mobile: '' }));
        setMatchResult(null);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <Search className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">التحقق الذكي (Smart Match)</h2>
                            <p className="text-sm text-slate-500">فحص التكرار على مستوى النظام مع احترام صلاحيات العرض</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-4 custom-scrollbar bg-slate-50/30">
                    <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 space-y-4">
                        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                            <Search className="w-3.5 h-3.5" />
                            بيانات التحقق
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">الاسم / الكنية</label>
                                <input
                                    type="text"
                                    value={inputs.name}
                                    onChange={e => setInputs(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="الاسم يساعدك فقط في المراجعة"
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">
                                    رقم الموبايل
                                    {phoneVerified && (
                                        <span className="mr-1.5 text-emerald-600 font-black inline-flex items-center gap-0.5">
                                            <Lock className="w-2.5 h-2.5" /> تم التحقق
                                        </span>
                                    )}
                                    {matchResult?.status === 'MATCH_VISIBLE' && (
                                        <span className="mr-1.5 text-red-500 font-black">• مكرر</span>
                                    )}
                                    {matchResult?.status === 'MATCH_RESTRICTED' && (
                                        <span className="mr-1.5 text-amber-600 font-black">• موجود مع تقييد عرض</span>
                                    )}
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={inputs.mobile}
                                        onChange={e => {
                                            if (phoneVerified) return;
                                            const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                                            if (v.length === 1 && v !== '0') return;
                                            if (v.length >= 2 && !v.startsWith('09')) return;
                                            setInputs(prev => ({ ...prev, mobile: v }));
                                        }}
                                        readOnly={phoneVerified}
                                        placeholder="0912345678"
                                        maxLength={10}
                                        dir="ltr"
                                        className={`w-full border rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-4 transition-all text-right ${
                                            mobileInputState === 'verified'
                                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 cursor-default focus:ring-0 pr-10'
                                                : mobileInputState === 'duplicate'
                                                ? 'bg-red-50 border-red-300 focus:border-red-400 focus:ring-red-500/5'
                                                : mobileInputState === 'restricted'
                                                ? 'bg-amber-50 border-amber-300 focus:border-amber-400 focus:ring-amber-500/5'
                                                : mobileInputState === 'ready'
                                                ? 'bg-white border-indigo-300 focus:border-indigo-500 focus:ring-indigo-500/5'
                                                : 'bg-white border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/5'
                                        }`}
                                    />
                                    {phoneVerified && (
                                        <button
                                            type="button"
                                            onClick={handleUnlockMobile}
                                            title="تعديل الرقم وإعادة التحقق"
                                            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all shadow-sm"
                                        >
                                            <Pencil className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                                {!phoneVerified && inputs.mobile.length > 0 && !isValidSyrianMobile && (
                                    <p className="text-[10px] text-amber-500 mt-1 font-medium">
                                        {inputs.mobile.length < 10
                                            ? `${10 - inputs.mobile.length} خانة متبقية، ويجب أن يبدأ الرقم بـ 09`
                                            : 'يجب أن يبدأ رقم الموبايل بـ 09'}
                                    </p>
                                )}
                                {!phoneVerified && inputs.mobile.length === 0 && (
                                    <p className="text-[10px] text-slate-400 mt-1 font-medium">أدخل 10 أرقام تبدأ بـ 09 لإجراء الفحص</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-slate-700">نتيجة التحقق</h3>
                        </div>

                        {isSearching ? (
                            <div className="py-12 text-center bg-white rounded-2xl border border-slate-100">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-4" />
                                <p className="text-slate-500 font-medium">جاري فحص الرقم على مستوى النظام...</p>
                            </div>
                        ) : !isValidSyrianMobile ? (
                            <div className="py-12 text-center bg-white rounded-2xl border border-slate-100">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Search className="w-8 h-8 text-slate-300" />
                                </div>
                                <h4 className="text-slate-800 font-bold mb-1">أدخل رقم الموبايل للمتابعة</h4>
                                <p className="text-slate-500 text-sm">يجب أن يكون الرقم 10 خانات ويبدأ بـ 09</p>
                            </div>
                        ) : matchResult?.status === 'MATCH_VISIBLE' ? (
                            <div className="group bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full overflow-hidden border border-slate-100 shrink-0 bg-sky-50 flex items-center justify-center">
                                        <User className="w-6 h-6 text-sky-500" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-slate-800">{matchResult.client.name}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 rounded font-black bg-sky-50 text-sky-600 border border-sky-100">
                                                زبون موجود
                                            </span>
                                        </div>
                                        <div className="space-y-1 text-xs text-slate-500 font-medium">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono">{matchResult.client.phone}</span>
                                                <span>•</span>
                                                <span>ID: #{matchResult.client.id}</span>
                                            </div>
                                            <div>الفرع: {matchResult.client.branchName || '--'}</div>
                                            <div>المسند إليه: {matchResult.client.assignedUserName || '--'}</div>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => onLink({
                                        id: matchResult.client.id,
                                        name: matchResult.client.name,
                                        mobile: matchResult.client.phone,
                                    } as Client, 'Client')}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border bg-sky-50 text-sky-600 hover:bg-sky-600 hover:text-white border-sky-100"
                                >
                                    <Link2 className="w-4 h-4" />
                                    عرض هذا الزبون
                                </button>
                            </div>
                        ) : matchResult?.status === 'MATCH_RESTRICTED' ? (
                            <div className="py-8 px-5 bg-amber-50 rounded-2xl border border-amber-200">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                                        <Lock className="w-5 h-5 text-amber-700" />
                                    </div>
                                    <div>
                                        <h4 className="text-amber-900 font-bold mb-1">مطابقة موجودة لكن تفاصيلها مقيّدة</h4>
                                        <p className="text-sm text-amber-800 leading-6">{matchResult.message || RESTRICTED_MESSAGE}</p>
                                    </div>
                                </div>
                            </div>
                        ) : matchResult?.status === 'NO_MATCH' ? (
                            <div className="py-12 text-center bg-white rounded-2xl border border-slate-100">
                                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Search className="w-8 h-8 text-emerald-400" />
                                </div>
                                <h4 className="text-slate-800 font-bold mb-1">لا توجد نتائج مطابقة</h4>
                                <p className="text-slate-500 text-sm">يمكنك متابعة إنشاء الزبون بهذا الرقم</p>
                            </div>
                        ) : (
                            <div className="py-8 px-5 bg-red-50 rounded-2xl border border-red-200">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                                        <AlertCircle className="w-5 h-5 text-red-700" />
                                    </div>
                                    <div>
                                        <h4 className="text-red-900 font-bold mb-1">تعذر التحقق حالياً</h4>
                                        <p className="text-sm text-red-800 leading-6">{searchError || DEFAULT_ERROR_MESSAGE}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
                        >
                            إغلاق
                        </button>

                        {!phoneVerified && inputs.mobile.length === 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                أدخل رقم الموبايل للتحقق والمتابعة
                            </div>
                        )}
                        {matchResult?.status === 'MATCH_VISIBLE' && (
                            <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                الرقم موجود مسبقاً ولا يمكن إنشاء زبون مكرر
                            </div>
                        )}
                        {matchResult?.status === 'MATCH_RESTRICTED' && (
                            <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                {matchResult.message}
                            </div>
                        )}
                        {phoneVerified && (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                الرقم غير مستخدم ويمكن المتابعة
                            </div>
                        )}
                    </div>

                    {phoneVerified && (
                        <button
                            onClick={() => onNoMatch(inputs.mobile.trim())}
                            className="flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-bold text-white rounded-xl shadow-md transition-all duration-200 bg-slate-600 hover:bg-slate-700 hover:shadow-lg hover:gap-3"
                        >
                            لا توجد نتائج مطابقة - متابعة
                            <ArrowLeft className="w-5 h-5 shrink-0" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
