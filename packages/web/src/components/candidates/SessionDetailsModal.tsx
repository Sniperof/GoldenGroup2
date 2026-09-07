import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { Calendar, User, FileText, AlertCircle, Phone, MapPin, ShieldCheck, Gift } from '../ui/icons';
import QualificationModal from './QualificationModal';
import ClientModal from '../ClientModal';
import { Candidate, Client, GeoUnit } from '../../lib/types';
import { api } from '../../lib/api';
import { formatGeoUnitLastLevels } from '../GeoSmartSearch';
import { usePermissions } from '../../hooks/usePermissions';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import DataTable from '../ui/DataTable';
import ReferralGiftPromisesPanel from '../gifts/ReferralGiftPromisesPanel';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    sheetId: number | null;
}

export default function ReferralSheetDetailsModal({ isOpen, onClose, sheetId }: Props) {
    const { hasAnyPermission, hasPermission } = usePermissions();
    const referralSheets = useCandidateStore(state => state.referralSheets);
    const closeReferralSheet = useCandidateStore(state => state.closeReferralSheet);
    const setLoadedCandidates = useCandidateStore(state => state.setLoadedCandidates);
    const qualifyCandidate = useCandidateStore(state => state.qualifyCandidate);
    const linkCandidateToClient = useCandidateStore(state => state.linkCandidateToClient);
    const markJunk = useCandidateStore(state => state.markJunk);

    // This sheet's names, fetched for this sheet only.
    const [sheetCandidateRows, setSheetCandidateRows] = useState<Candidate[]>([]);
    const [sheetCandidatesRefreshKey, setSheetCandidatesRefreshKey] = useState(0);
    const reloadSheetCandidates = () => setSheetCandidatesRefreshKey(k => k + 1);

    const [isQualifyModalOpen, setIsQualifyModalOpen] = useState(false);
    const [activeCandidateForQualify, setActiveCandidateForQualify] = useState<Candidate | null>(null);
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [clientInitialData, setClientInitialData] = useState<Client | null>(null);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [operationError, setOperationError] = useState<string | null>(null);
    const canEditCandidates = hasPermission('candidates.edit');
    const canEditNameLists = hasAnyPermission('candidates.name_lists.edit');

    // The sheet's names — one scoped request per open sheet, refreshed after every
    // mutation here. `setLoadedCandidates` publishes them so the store's mutations
    // (which resolve their subject from it) can act on the rows shown here.
    useEffect(() => {
        if (!isOpen || !sheetId) return;
        let active = true;
        api.candidates.listPaged({ referralSheetId: sheetId, limit: 100, sortKey: 'id', sortDir: 'desc' })
            .then(res => {
                if (!active) return;
                setSheetCandidateRows(res.items as Candidate[]);
                setLoadedCandidates(res.items as Candidate[]);
            })
            .catch((err: any) => {
                if (!active) return;
                console.error('Failed to load sheet candidates:', err);
                setSheetCandidateRows([]);
                setOperationError(err?.message ?? 'تعذّر تحميل أسماء اللائحة');
            });
        return () => { active = false; };
    }, [isOpen, sheetId, sheetCandidatesRefreshKey, setLoadedCandidates]);

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        api.geoUnits.list()
            .then(units => { if (active) setGeoUnits(units); })
            .catch(() => {});
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
            reloadSheetCandidates();
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

    // Fetched per sheet (see the effect above) instead of filtered out of a
    // fully-loaded candidate array — this modal must not depend on the records
    // page having pulled every name first.
    const sheetCandidates = [...sheetCandidateRows].sort((a, b) => b.id - a.id);
    const getCandidateAddressDisplay = (candidate: Candidate) => {
        const savedText = candidate.addressText && candidate.addressText !== 'غير محدد' ? candidate.addressText : '';
        return formatGeoUnitLastLevels(geoUnits, candidate.geoUnitId) || savedText || '--';
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

                {hasPermission('contract_gifts.view') && (
                    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                            <Gift className="h-4 w-4 text-amber-600" />
                            وعود الهدايا المسجلة للائحة
                        </p>
                        <ReferralGiftPromisesPanel
                            referralSheetId={sheet.id}
                            emptyText="لا توجد وعود هدايا مسجلة لهذه اللائحة."
                        />
                    </div>
                )}

                {operationError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                        {operationError}
                    </div>
                )}

                <div className="border-t border-slate-100 pt-4 overflow-hidden flex flex-col flex-1">
                    <h3 className="text-base font-bold text-slate-800 mb-3 px-1">قائمة الأسماء في هذه الورقة</h3>
                    <DataTable wrapperClassName="rounded-xl border border-slate-200">
                        <DataTable.Head className="sticky top-0 z-10 shadow-sm">
                            <DataTable.Row>
                                <DataTable.Th className="w-16">ID</DataTable.Th>
                                <DataTable.Th>الاسم المقترح</DataTable.Th>
                                <DataTable.Th>أرقام التواصل</DataTable.Th>
                                <DataTable.Th>العنوان</DataTable.Th>
                                <DataTable.Th>المهنة</DataTable.Th>
                                <DataTable.Th>الحالة</DataTable.Th>
                                <DataTable.Th align="center" className="w-24">الإجراءات</DataTable.Th>
                            </DataTable.Row>
                        </DataTable.Head>
                        <DataTable.Body>
                            {sheetCandidates.map(c => {
                                    const allNumbers = c.contacts && c.contacts.length > 0
                                        ? c.contacts.map(con => con.number).filter(Boolean)
                                        : c.mobile ? [c.mobile] : [];
                                    return (
                                    <DataTable.Row key={c.id} className="hover:bg-slate-50/50 transition-colors group">
                                        {/* ID */}
                                        <DataTable.Td>
                                            <span className="text-xs font-mono text-slate-400">#{c.id}</span>
                                        </DataTable.Td>
                                        {/* الاسم المقترح */}
                                        <DataTable.Td>
                                            <Link to={`/candidates/${c.id}`} className="font-bold text-slate-800 text-sm hover:text-sky-700 hover:underline">
                                                {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.nickname || '--'}
                                            </Link>
                                            {c.nickname && (c.firstName || c.lastName) && (
                                                <div className="text-xs text-slate-400 mt-0.5">({c.nickname})</div>
                                            )}
                                        </DataTable.Td>
                                        {/* أرقام التواصل */}
                                        <DataTable.Td>
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
                                        </DataTable.Td>
                                        {/* العنوان */}
                                        <DataTable.Td>
                                            {getCandidateAddressDisplay(c) !== '--' ? (
                                                <div className="flex items-center gap-1.5 text-slate-600 text-sm">
                                                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                    <span>{getCandidateAddressDisplay(c)}</span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 text-sm">--</span>
                                            )}
                                        </DataTable.Td>
                                        {/* المهنة */}
                                        <DataTable.Td>
                                            <span className="text-sm text-slate-600">{c.occupation || '--'}</span>
                                        </DataTable.Td>
                                        {/* الحالة */}
                                        <DataTable.Td>
                                            <span className={`px-2 py-1 rounded text-xs font-bold border ${
                                                c.status === 'Suggested' ? 'bg-sky-50 text-sky-700 border-sky-200'
                                                : c.status === 'FollowUp' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                : c.status === 'Qualified' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-red-50 text-red-700 border-red-200'
                                            }`}>
                                                {c.status === 'Suggested' ? 'مقترح'
                                                : c.status === 'FollowUp' ? 'متابعة'
                                                : c.status === 'Qualified' ? 'مؤهل'
                                                : 'مرفوض'}
                                            </span>
                                            {c.duplicateFlag && (
                                                <div className={`text-xs font-bold mt-1 flex items-center gap-1 ${c.status === 'Qualified' ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                    <AlertCircle className="w-3 h-3" />
                                                    احتمال تكرار
                                                </div>
                                            )}
                                        </DataTable.Td>
                                        {/* الإجراءات */}
                                        <DataTable.Td align="center">
                                            {canEditCandidates && (c.status === 'Suggested' || c.status === 'FollowUp') && (
                                                <button
                                                    onClick={() => handleOpenQualify(c)}
                                                    className="flex flex-col mx-auto items-center justify-center w-9 h-9 bg-sky-50 text-sky-600 hover:bg-sky-500 hover:text-white rounded-xl border border-sky-100 hover:border-sky-500 shadow-sm transition-all"
                                                    title="تأهيل والتحقق الذكي"
                                                >
                                                    <ShieldCheck className="w-4 h-4" />
                                                </button>
                                            )}
                                        </DataTable.Td>
                                    </DataTable.Row>
                                    );
                                })}
                                {sheetCandidates.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                                            لا توجد أسماء مقترحة في هذه الورقة
                                        </td>
                                    </tr>
                                )}
                        </DataTable.Body>
                    </DataTable>
                </div>
            </div>
        </Modal>

            <QualificationModal
                isOpen={canEditCandidates && isQualifyModalOpen}
                onClose={() => setIsQualifyModalOpen(false)}
                candidate={activeCandidateForQualify}
                onQualified={handleQualificationConfirmed}
                onJunk={async (id) => {
                    setOperationError(null);
                    try {
                        await markJunk(id);
                        reloadSheetCandidates();
                        setIsQualifyModalOpen(false);
                    } catch (err: any) {
                        console.error('Failed to mark candidate as junk:', err);
                        setOperationError(err?.message ?? 'فشل رفض الاسم المقترح');
                    }
                }}
                onLink={(candidateId, client) => {
                    setOperationError(null);
                    linkCandidateToClient(candidateId, client.id)
                        .then(() => {
                            reloadSheetCandidates();
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

        </>
    );
}
