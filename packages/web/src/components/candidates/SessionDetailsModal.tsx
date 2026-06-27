import { useState, useEffect } from 'react';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { Calendar, User, FileText, AlertCircle, Phone, MapPin, ShieldCheck, Gift, Plus, Trash2 } from 'lucide-react';
import QualificationModal from './QualificationModal';
import ClientModal from '../ClientModal';
import { Candidate, Client, GeoUnit } from '../../lib/types';
import { api } from '../../lib/api';
import { formatGeoUnitLastLevels } from '../GeoSmartSearch';
import { usePermissions } from '../../hooks/usePermissions';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import {
    giftConditionStatusLabels,
    type GiftConditionStatus,
    type GiftDefinitionPrototype,
} from '../../data/giftsPrototype';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    sheetId: number | null;
}

interface SheetGiftPromiseDraft {
    giftDefinitionId: string;
    conditionLabel: string;
    conditionStatus: GiftConditionStatus;
    quantity: number;
}

interface SheetGiftPromisePreview extends SheetGiftPromiseDraft {
    id: string;
}

export default function ReferralSheetDetailsModal({ isOpen, onClose, sheetId }: Props) {
    const { hasAnyPermission, hasPermission } = usePermissions();
    const referralSheets = useCandidateStore(state => state.referralSheets);
    const closeReferralSheet = useCandidateStore(state => state.closeReferralSheet);
    const candidates = useCandidateStore(state => state.candidates);
    const qualifyCandidate = useCandidateStore(state => state.qualifyCandidate);
    const linkCandidateToClient = useCandidateStore(state => state.linkCandidateToClient);
    const markJunk = useCandidateStore(state => state.markJunk);

    const [isQualifyModalOpen, setIsQualifyModalOpen] = useState(false);
    const [activeCandidateForQualify, setActiveCandidateForQualify] = useState<Candidate | null>(null);
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientInitialData, setClientInitialData] = useState<Client | null>(null);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [operationError, setOperationError] = useState<string | null>(null);
    const [activeGiftDefinitions, setActiveGiftDefinitions] = useState<GiftDefinitionPrototype[]>([]);
    const [giftDefinitionsLoading, setGiftDefinitionsLoading] = useState(false);
    const [sheetGiftPromises, setSheetGiftPromises] = useState<SheetGiftPromisePreview[]>([]);
    const [isGiftPromiseModalOpen, setIsGiftPromiseModalOpen] = useState(false);
    const [giftPromiseDraft, setGiftPromiseDraft] = useState<SheetGiftPromiseDraft>({
        giftDefinitionId: '',
        conditionLabel: 'شراء زبون من لائحة الأسماء',
        conditionStatus: 'pending',
        quantity: 1,
    });
    const canEditCandidates = hasPermission('candidates.edit');
    const canEditNameLists = hasAnyPermission('candidates.name_lists.edit');

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        api.geoUnits.list()
            .then(units => { if (active) setGeoUnits(units); })
            .catch(() => {});
        setGiftDefinitionsLoading(true);
        api.gifts.definitions.list()
            .then(definitions => {
                if (!active) return;
                const activeDefinitions = definitions.filter(definition => definition.isActive);
                setActiveGiftDefinitions(activeDefinitions);
                setGiftPromiseDraft(prev => prev.giftDefinitionId
                    ? prev
                    : { ...prev, giftDefinitionId: activeDefinitions[0]?.id != null ? String(activeDefinitions[0].id) : '' });
            })
            .catch(() => { if (active) setActiveGiftDefinitions([]); })
            .finally(() => { if (active) setGiftDefinitionsLoading(false); });
        return () => { active = false; };
    }, [isOpen]);

    const handleOpenQualify = (candidate: Candidate) => {
        setOperationError(null);
        setActiveCandidateForQualify(candidate);
        setIsQualifyModalOpen(true);
    };

    const handleQualificationConfirmed = (candidate: Candidate) => {
        // Pre-fill the ClientModal with candidate data — same as CandidatesEntry page
        const prefilledClient: Partial<Client> = {
            firstName: candidate.firstName || '',
            lastName: candidate.lastName || '',
            nickname: candidate.nickname || '',
            name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.nickname || '',
            mobile: candidate.mobile,
            contacts: candidate.contacts || [],
            neighborhood: candidate.geoUnitId?.toString() || '',
            detailedAddress: candidate.addressText || '',
            occupation: candidate.occupation || '',
            sourceChannel: candidate.referralOriginChannel,
            referrerType: candidate.referralType,
            referrerName: candidate.referralNameSnapshot,
            referralEntityId: candidate.referralEntityId,
            referralDate: candidate.referralDate,
            referralReason: candidate.referralReason,
            referralSheetId: candidate.referralSheetId,
            referralAddressText: candidate.addressText,
            isCandidate: false,
            candidateStatus: 'Lead',
        };
        setClientInitialData(prefilledClient as Client);
        setIsQualifyModalOpen(false);
        setIsClientModalOpen(true);
    };

    const handleSaveClient = async (clientData: Client) => {
        if (!activeCandidateForQualify) return;
        try {
            setOperationError(null);
            await qualifyCandidate(activeCandidateForQualify.id, clientData);
            setIsClientModalOpen(false);
            setClientInitialData(null);
            setActiveCandidateForQualify(null);
        } catch (err: any) {
            console.error('Failed to qualify candidate:', err);
            setOperationError(err?.message ?? 'فشل تحويل الاسم المقترح إلى زبون');
        }
    };

    if (!isOpen || !sheetId) return null;

    const sheet = referralSheets.find(s => s.id === sheetId);
    if (!sheet) return null;

    const sheetCandidates = candidates
        .filter(c => c.referralSheetId === sheetId)
        .sort((a, b) => b.id - a.id);
    const selectedGiftDefinition = activeGiftDefinitions.find(definition => String(definition.id) === giftPromiseDraft.giftDefinitionId);
    const sheetReferralType = String(sheet.referralType ?? '').toLowerCase();
    const canCreateGiftPromiseForSheet = Boolean(
        sheet.referralEntityId && (sheetReferralType === 'client' || sheetReferralType === 'customer')
    );
    const getCandidateAddressDisplay = (candidate: Candidate) => {
        const savedText = candidate.addressText && candidate.addressText !== 'غير محدد' ? candidate.addressText : '';
        return formatGeoUnitLastLevels(geoUnits, candidate.geoUnitId) || savedText || '--';
    };

    const openGiftPromiseModal = () => {
        setGiftPromiseDraft({
            giftDefinitionId: activeGiftDefinitions[0]?.id != null ? String(activeGiftDefinitions[0].id) : '',
            conditionLabel: 'شراء زبون من لائحة الأسماء',
            conditionStatus: 'pending',
            quantity: 1,
        });
        setIsGiftPromiseModalOpen(true);
    };

    const addGiftPromise = () => {
        if (!selectedGiftDefinition || !canCreateGiftPromiseForSheet) return;
        setSheetGiftPromises(prev => [{
            ...giftPromiseDraft,
            id: `sheet-gift-${Date.now()}`,
            quantity: Math.max(1, giftPromiseDraft.quantity || 1),
        }, ...prev]);
        setIsGiftPromiseModalOpen(false);
    };

    const removeGiftPromise = (id: string) => {
        setSheetGiftPromises(prev => prev.filter(promise => promise.id !== id));
    };

    return (
        <>
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="6xl"
            title={
                <span className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-amber-600" />
                    تفاصيل لائحة الأسماء #{sheet.id}
                </span>
            }
            subtitle={`الوسيط: ${sheet.referralNameSnapshot}`}
            footer={
                canEditNameLists && sheet.status !== 'Completed' ? (
                    <Button onClick={() => { closeReferralSheet(sheet.id); onClose(); }}>
                        إغلاق الورقة (أرشفة)
                    </Button>
                ) : undefined
            }
        >
            <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-xs text-slate-400 block mb-1">تاريخ الورقة</span>
                        <div className="font-bold text-slate-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-sky-500" />
                            {sheet.referralDate.split('T')[0]}
                        </div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-xs text-slate-400 block mb-1">الأسماء المدخلة / المستهدف</span>
                        <div className="font-bold text-slate-700 flex items-center gap-2">
                            <User className="w-4 h-4 text-emerald-500" />
                            {(sheet.stats?.targetCandidates ?? 0) > 0 ? (
                                <span>
                                    <span className={
                                        (sheet.stats?.totalCandidates || 0) >= (sheet.stats?.targetCandidates ?? 0)
                                            ? 'text-emerald-600'
                                            : 'text-amber-600'
                                    }>
                                        {sheet.stats?.totalCandidates || 0}
                                    </span>
                                    <span className="text-slate-400 font-normal mx-1">/</span>
                                    <span className="text-slate-500">{sheet.stats.targetCandidates}</span>
                                </span>
                            ) : (
                                sheet.stats?.totalCandidates || 0
                            )}
                        </div>
                    </div>
                </div>

                <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Gift className="w-4 h-4 text-amber-600" />
                                وعود الهدايا من لائحة الأسماء
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                {canCreateGiftPromiseForSheet
                                    ? 'هذه اللائحة مرتبطة بوسيط زبون معروف، ويمكن إنشاء وعد هدية له عند تحقق شرط الشراء.'
                                    : 'إنشاء وعد قابل لمهمة تسليم يتطلب أن يكون وسيط اللائحة من نوع زبون مرتبط بسجل معروف.'}
                            </p>
                        </div>
                        <Button
                            size="sm"
                            variant="gold"
                            icon={Plus}
                            disabled={!canCreateGiftPromiseForSheet}
                            onClick={openGiftPromiseModal}
                        >
                            إضافة وعد هدية
                        </Button>
                    </div>
                    {sheetGiftPromises.length > 0 && (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {sheetGiftPromises.map(promise => {
                                const definition = activeGiftDefinitions.find(item => String(item.id) === promise.giftDefinitionId);
                                return (
                                    <div key={promise.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-slate-800 truncate">{definition?.name ?? 'هدية'}</p>
                                            <p className="text-xs text-slate-500 truncate">
                                                {promise.conditionLabel} · {giftConditionStatusLabels[promise.conditionStatus]} · {promise.quantity}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeGiftPromise(promise.id)}
                                            className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                            title="حذف الوعد"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {operationError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                        {operationError}
                    </div>
                )}

                <div className="border-t border-slate-100 pt-4 overflow-hidden flex flex-col flex-1">
                    <h3 className="text-base font-bold text-slate-800 mb-3 px-1">قائمة الأسماء في هذه الورقة</h3>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-right bg-white">
                            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-black text-slate-500 w-16">ID</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">الاسم المقترح</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">أرقام التواصل</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">العنوان</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">المهنة</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600">الحالة</th>
                                    <th className="px-4 py-3 text-xs font-black text-slate-600 text-center w-24">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sheetCandidates.map(c => {
                                    const allNumbers = c.contacts && c.contacts.length > 0
                                        ? c.contacts.map(con => con.number).filter(Boolean)
                                        : c.mobile ? [c.mobile] : [];
                                    return (
                                    <tr key={c.id} className="hover:bg-slate-50/50 transition-colors group">
                                        {/* ID */}
                                        <td className="px-4 py-3">
                                            <span className="text-xs font-mono text-slate-400">#{c.id}</span>
                                        </td>
                                        {/* الاسم المقترح */}
                                        <td className="px-4 py-3">
                                            <span className="font-bold text-slate-800 text-sm">
                                                {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.nickname || '--'}
                                            </span>
                                            {c.nickname && (c.firstName || c.lastName) && (
                                                <div className="text-xs text-slate-400 mt-0.5">({c.nickname})</div>
                                            )}
                                        </td>
                                        {/* أرقام التواصل */}
                                        <td className="px-4 py-3">
                                            {allNumbers.length > 0 ? (
                                                <div className="space-y-0.5">
                                                    {allNumbers.map((num, i) => (
                                                        <div key={i} className="flex items-center gap-1 text-slate-700 text-sm">
                                                            <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                                                            <span className="font-mono tracking-wide" dir="ltr">{num}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 text-sm">--</span>
                                            )}
                                        </td>
                                        {/* العنوان */}
                                        <td className="px-4 py-3">
                                            {getCandidateAddressDisplay(c) !== '--' ? (
                                                <div className="flex items-center gap-1.5 text-slate-600 text-sm">
                                                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    <span>{getCandidateAddressDisplay(c)}</span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 text-sm">--</span>
                                            )}
                                        </td>
                                        {/* المهنة */}
                                        <td className="px-4 py-3">
                                            <span className="text-sm text-slate-600">{c.occupation || '--'}</span>
                                        </td>
                                        {/* الحالة */}
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded text-xs font-bold border ${
                                                c.status === 'Suggested' ? 'bg-sky-50 text-sky-700 border-sky-200'
                                                : c.status === 'FollowUp' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                : c.status === 'Qualified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-red-50 text-red-700 border-red-200'
                                            }`}>
                                                {c.status === 'Suggested' ? 'مقترح'
                                                : c.status === 'FollowUp' ? 'متابعة'
                                                : c.status === 'Qualified' ? (c.duplicateFlag ? 'تم الربط' : 'تم التحويل')
                                                : 'مرفوض'}
                                            </span>
                                            {c.duplicateFlag && (
                                                <div className={`text-xs font-bold mt-1 flex items-center gap-1 ${c.status === 'Qualified' ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                    <AlertCircle className="w-3 h-3" />
                                                    {c.status === 'Qualified' ? 'زبون حالي' : 'احتمال تكرار'}
                                                </div>
                                            )}
                                        </td>
                                        {/* الإجراءات */}
                                        <td className="px-4 py-3 text-center">
                                            {canEditCandidates && (c.status === 'Suggested' || c.status === 'FollowUp') && (
                                                <button
                                                    onClick={() => handleOpenQualify(c)}
                                                    className="flex flex-col mx-auto items-center justify-center w-9 h-9 bg-sky-50 text-sky-600 hover:bg-sky-500 hover:text-white rounded-xl border border-sky-100 hover:border-sky-500 shadow-sm transition-all"
                                                    title="تأهيل والتحقق الذكي"
                                                >
                                                    <ShieldCheck className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    );
                                })}
                                {sheetCandidates.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                                            لا توجد أسماء مقترحة في هذه الورقة
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </Modal>

            <QualificationModal
                isOpen={canEditCandidates && isQualifyModalOpen}
                onClose={() => setIsQualifyModalOpen(false)}
                candidate={activeCandidateForQualify}
                onQualified={handleQualificationConfirmed}
                onJunk={(id) => { markJunk(id); setIsQualifyModalOpen(false); }}
                onLink={(candidateId, client) => {
                    setOperationError(null);
                    linkCandidateToClient(candidateId, client.id)
                        .then(() => {
                            setIsQualifyModalOpen(false);
                            setActiveCandidateForQualify(null);
                        })
                        .catch((err: any) => {
                            console.error('Failed to link candidate to client:', err);
                            setOperationError(err?.message ?? 'فشل ربط الاسم المقترح بالزبون');
                        });
                }}
            />

            <ClientModal
                isOpen={isClientModalOpen}
                onClose={() => setIsClientModalOpen(false)}
                onSave={handleSaveClient}
                initialData={clientInitialData}
                geoUnits={geoUnits}
                fromCandidate={true}
            />

            <Modal
                isOpen={isGiftPromiseModalOpen}
                onClose={() => setIsGiftPromiseModalOpen(false)}
                title="إضافة وعد هدية للائحة أسماء"
                size="lg"
                footer={(
                    <>
                        <Button variant="secondary" onClick={() => setIsGiftPromiseModalOpen(false)}>إلغاء</Button>
                        <Button variant="gold" icon={Gift} onClick={addGiftPromise} disabled={!selectedGiftDefinition}>
                            حفظ الوعد
                        </Button>
                    </>
                )}
            >
                <div className="space-y-4 p-5" dir="rtl">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        المستفيد من الوعد: <span className="font-bold text-slate-800">{sheet.referralNameSnapshot}</span>
                    </div>
                    <label className="block">
                        <span className="mb-1 block text-xs font-bold text-slate-500">نوع الهدية</span>
                        <select
                            value={giftPromiseDraft.giftDefinitionId}
                            onChange={e => setGiftPromiseDraft(prev => ({ ...prev, giftDefinitionId: e.target.value }))}
                            disabled={giftDefinitionsLoading || activeGiftDefinitions.length === 0}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                            {activeGiftDefinitions.length === 0 && (
                                <option value="">{giftDefinitionsLoading ? 'جاري تحميل التعريفات...' : 'لا توجد تعريفات هدايا فعالة'}</option>
                            )}
                            {activeGiftDefinitions.map(definition => (
                                <option key={definition.id} value={String(definition.id)}>{definition.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-xs font-bold text-slate-500">شرط الوعد</span>
                        <input
                            value={giftPromiseDraft.conditionLabel}
                            onChange={e => setGiftPromiseDraft(prev => ({ ...prev, conditionLabel: e.target.value }))}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-500">حالة تحقق الشرط</span>
                            <select
                                value={giftPromiseDraft.conditionStatus}
                                onChange={e => setGiftPromiseDraft(prev => ({ ...prev, conditionStatus: e.target.value as GiftConditionStatus }))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                                {Object.entries(giftConditionStatusLabels).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-500">العدد عند الاعتماد</span>
                            <input
                                type="number"
                                min={1}
                                value={giftPromiseDraft.quantity}
                                onChange={e => setGiftPromiseDraft(prev => ({ ...prev, quantity: Number(e.target.value) || 1 }))}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            />
                        </label>
                    </div>
                </div>
            </Modal>
        </>
    );
}
