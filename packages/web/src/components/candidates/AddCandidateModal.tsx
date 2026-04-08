import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { UserPlus, Calendar, PlusCircle, X, CheckCircle, AlertCircle, Save, MapPin, Trash2, MessageCircle, Plus } from 'lucide-react';
import { CandidateStatus, ReferralType, ReferralOriginChannel, Client, ContactEntry, Candidate, ContactType, ContactStatus } from '../../lib/types';
import CreateReferralSheetModal from './CreateReferralSessionModal';
import GeoSmartSearch, { GeoSelection } from '../GeoSmartSearch';
import { api } from '../../lib/api';
import type { GeoUnit } from '../../lib/types';

interface AddCandidateModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialDirectMode?: boolean;
    initialData?: Candidate;
    title?: string;
}
function simpleUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const contactTypeConfig = {
    mobile: { label: 'موبايل', emoji: '📱', color: 'text-indigo-600' },
    landline: { label: 'هاتف أرضي', emoji: '☎️', color: 'text-blue-600' },
    other: { label: 'أخرى', emoji: '🔗', color: 'text-slate-600' }
};

const contactStatusConfig = {
    active: { label: 'نشط', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    objection: { label: 'اعتراض', style: 'bg-amber-50 text-amber-700 border-amber-200' },
    nonbinding: { label: 'غير ملزم', style: 'bg-sky-50 text-sky-700 border-sky-200' },
    inactive: { label: 'خارج الخدمة', style: 'bg-red-50 text-red-700 border-red-200' }
};

const initialCandidateState = {
    firstName: '',
    nickname: '',
    lastName: '',
    contacts: [{ id: simpleUUID(), type: 'mobile' as ContactType, number: '', label: 'شخصي', hasWhatsApp: true, isPrimary: true, status: 'active' as ContactStatus }],
    locationSelection: { govId: '', regionId: '', subId: '', neighborhoodId: '' } as GeoSelection,
    addressText: '',
    occupation: '',
    candidateNotes: ''
};

export default function AddCandidateModal({ isOpen, onClose, initialDirectMode, initialData, title }: AddCandidateModalProps) {
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [visits, setVisits] = useState<Array<{ customerId: number }>>([]);
    const [contracts, setContracts] = useState<Array<{ customerId: number }>>([]);
    const [occupationOptions, setOccupationOptions] = useState<string[]>([]);
    useEffect(() => {
        let active = true;

        Promise.all([
            api.geoUnits.list(),
            api.clients.list(),
            api.visits.list(),
            api.contracts.list(),
            api.systemLists.list({ category: 'occupation', activeOnly: true }),
        ])
            .then(([units, clients, visitsData, contractsData, occupationList]) => {
                if (!active) return;
                setGeoUnits(units);
                setAllClients(clients);
                setVisits(visitsData);
                setContracts(contractsData);
                setOccupationOptions(occupationList.map((item: any) => item.value));
            })
            .catch((error) => {
                console.error(error);
                if (!active) return;
                setGeoUnits([]);
                setAllClients([]);
                setVisits([]);
                setContracts([]);
                setOccupationOptions([]);
            });

        return () => {
            active = false;
        };
    }, []);

    const addCandidate = useCandidateStore((state: any) => state.addCandidate);
    const updateCandidate = useCandidateStore((state: any) => state.updateCandidate);
    const referralSheets = useCandidateStore((state: any) => state.referralSheets);

    const activeSheets = useMemo(() => referralSheets.filter((s: any) => s.status !== 'Archived' && s.status !== 'Completed'), [referralSheets]);

    const [isDirectMode, setIsDirectMode] = useState(initialDirectMode || false);

    const [selectedSheetId, setSelectedSheetId] = useState<number | ''>('');
    const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);

    const [referralDate, setReferralDate] = useState(new Date().toISOString().split('T')[0]);
    const [referralType, setReferralType] = useState<ReferralType>('Personal');
    const [originChannel, setOriginChannel] = useState<ReferralOriginChannel>('Acquaintance');
    const [referralNameSnapshot, setReferralNameSnapshot] = useState('');

    const [employeeIdInput, setEmployeeIdInput] = useState('');
    const [employeeFound, setEmployeeFound] = useState<{ name: string, id: number } | null>(null);
    const [employeeSearchError, setEmployeeSearchError] = useState('');

    const [clientSearch, setClientSearch] = useState('');
    const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

    const clientSearchRef = useRef<HTMLDivElement>(null);
    const isInitialSync = useRef(true);

    const [candidateData, setCandidateData] = useState(initialCandidateState);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                const sheetId = initialData.referralSheetId;
                setIsDirectMode(sheetId === null);
                setCandidateData({
                    firstName: initialData.firstName || '',
                    nickname: initialData.nickname || '',
                    lastName: initialData.lastName || '',
                    contacts: initialData.contacts || [],
                    locationSelection: { govId: '', regionId: '', subId: '', neighborhoodId: initialData.geoUnitId?.toString() || '' },
                    addressText: initialData.addressText || '',
                    occupation: initialData.occupation || '',
                    candidateNotes: initialData.candidateNotes || ''
                });

                if (sheetId === null) {
                    setReferralType(initialData.referralType);
                    setOriginChannel(initialData.referralOriginChannel);
                    setReferralNameSnapshot(initialData.referralNameSnapshot);
                    setReferralDate(initialData.referralDate?.split('T')[0] || new Date().toISOString().split('T')[0]);

                    if (initialData.referralType === 'Employee') {
                        setEmployeeIdInput(initialData.referralEntityId?.toString() || '');
                    } else if (initialData.referralType === 'Client') {
                        setSelectedClientId(initialData.referralEntityId);
                        setClientSearch(initialData.referralNameSnapshot);
                    }
                } else {
                    setSelectedSheetId(sheetId);
                }
            } else {
                setIsDirectMode(initialDirectMode || false);
                setCandidateData(initialCandidateState);
                setReferralType('Personal');
                setReferralNameSnapshot('أحمد (مشرف)');
                setReferralDate(new Date().toISOString().split('T')[0]);
                setSelectedSheetId('');
                setEmployeeIdInput('');
                setEmployeeFound(null);
                setClientSearch('');
                setSelectedClientId(null);
                setOriginChannel('Acquaintance');
            }
            isInitialSync.current = false;
        } else {
            isInitialSync.current = true;
        }
    }, [isOpen, initialData, initialDirectMode]);

    useEffect(() => {
        if (!isOpen || isInitialSync.current || !isDirectMode) return;

        if (referralType === 'Personal') {
            setOriginChannel('Acquaintance');
            setReferralNameSnapshot('أحمد (مشرف)');
        } else if (referralType === 'Unknown') {
            setReferralNameSnapshot('مجهول');
        } else {
            setReferralNameSnapshot('');
            setEmployeeIdInput('');
            setEmployeeFound(null);
            setClientSearch('');
            setSelectedClientId(null);
        }
    }, [referralType, isDirectMode, isOpen]);



    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (clientSearchRef.current && !clientSearchRef.current.contains(event.target as Node)) {
                setClientSuggestions([]);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);



    const handleEmployeeBlur = async () => {
        if (!employeeIdInput.trim()) {
            setEmployeeFound(null);
            setEmployeeSearchError('');
            return;
        }
        try {
            const employees = await api.employees.list();
            const emp = employees.find((e: any) => e.id.toString() === employeeIdInput.trim() || e.employeeId === employeeIdInput.trim());
            if (emp) {
                setEmployeeFound({ name: emp.name, id: emp.id });
                setReferralNameSnapshot(emp.name);
                setEmployeeSearchError('');
            } else {
                setEmployeeFound(null);
                setReferralNameSnapshot('');
                setEmployeeSearchError('لم يتم العثور على الموظف');
            }
        } catch {
            setEmployeeFound(null);
            setReferralNameSnapshot('');
            setEmployeeSearchError('خطأ في البحث عن الموظف');
        }
    };

    const getClientLifecycleStage = (client: Client) => {
        if (contracts.some(contract => contract.customerId === client.id)) return 'OP';
        if (visits.some(visit => visit.customerId === client.id)) return 'FOP';
        return 'Lead';
    };

    const handleClientSearch = async (text: string) => {
        setClientSearch(text);
        const query = text.trim();
        const matches = allClients
            .filter(client => !client.isCandidate)
            .filter(client =>
                !query ||
                client.name.includes(query) ||
                client.contacts?.some(con => con.number.includes(query)) ||
                client.mobile?.includes(query)
            )
            .slice(0, query ? 10 : 20);
        setClientSuggestions(matches);
    };

    const handleSelectClient = (client: Client) => {
        setClientSearch(client.name);
        setReferralNameSnapshot(client.name);
        setSelectedClientId(client.id);
        setClientSuggestions([]);
    };



    const candidatesList = useCandidateStore((state: any) => state.candidates);

    const validateForm = () => {
        if (!isDirectMode && !selectedSheetId) {
            setError('يجب اختيار ورقة ترشيح في وضع (ورقة الترشيح).');
            return false;
        }
        if (isDirectMode && (!referralDate || !referralNameSnapshot)) {
            setError('الرجاء تعبئة جميع الحقول الإلزامية الخاصة بالاستقطاب المباشر.');
            return false;
        }
        if (!candidateData.firstName.trim() && !candidateData.nickname.trim()) {
            setError('يجب إدخال الاسم الأول أو اللقب للاسم المقترح على الأقل.');
            return false;
        }
        if (candidateData.contacts.length === 0 || !candidateData.contacts.some(c => c.number.trim() && c.isPrimary)) {
            setError('يجب إدخال رقم هاتف واحد أساسي على الأقل.');
            return false;
        }
        setError('');
        return true;
    };

    const handleSave = async (addAnother: boolean) => {
        if (!validateForm()) return;

        const candidateUnitId = candidateData.locationSelection.neighborhoodId || candidateData.locationSelection.subId || candidateData.locationSelection.regionId || candidateData.locationSelection.govId;
        const candidateAddressText = geoUnits.find(u => u.id === Number(candidateUnitId))?.name || 'غير محدد';

        try {
            const firstName = candidateData.firstName || null;
            const nickname = candidateData.nickname || null;
            const lastName = candidateData.lastName;
            const mobile = candidateData.contacts.find(c => c.isPrimary)?.number || candidateData.contacts[0]?.number || '';
            const contacts = candidateData.contacts.filter(c => c.number.trim());
            const neighborhood = candidateAddressText;
            const detailedAddress = candidateData.addressText;

            let entityId: number | null = null;
            if (referralType === 'Employee' && employeeFound) {
                entityId = employeeFound.id;
            } else if (referralType === 'Client' && selectedClientId) {
                entityId = selectedClientId;
            }

            const newC: Omit<Candidate, 'id' | 'createdAt' | 'duplicateFlag' | 'duplicateType' | 'duplicateReferenceId' | 'status' | 'referralConfirmationStatus' | 'convertedToLeadId' | 'referralSheetId'> & { referralSheetId: number | null } = {
                firstName,
                lastName,
                nickname,
                mobile,
                contacts,
                addressText: detailedAddress || neighborhood,
                geoUnitId: Number(candidateUnitId) || null,
                referralSheetId: isDirectMode ? null : (selectedSheetId as number),
                referralType: referralType,
                referralOriginChannel: originChannel,
                referralNameSnapshot: referralNameSnapshot,
                referralEntityId: entityId,
                referralDate: new Date(referralDate).toISOString(),
                referralReason: isDirectMode ? 'Direct Referral' : 'Part of Sheet',
                occupation: candidateData.occupation,
                candidateNotes: candidateData.candidateNotes,
                ownerUserId: 1,
                createdBy: 1
            };
            await addCandidate(newC as any);
            if (addAnother) {
                setCandidateData(initialCandidateState);
                setError('');
            } else {
                resetAndClose();
            }
        } catch (err: any) {
            setError(err.message || 'حدث خطأ غير متوقع');
        }
    };

    const resetAndClose = () => {
        setIsDirectMode(false);
        setSelectedSheetId('');
        setCandidateData(initialCandidateState);
        setReferralType('Personal');
        setReferralNameSnapshot('أحمد (مشرف)');
        setReferralDate(new Date().toISOString().split('T')[0]);
        setError('');
        setEmployeeIdInput('');
        setEmployeeFound(null);
        setEmployeeSearchError('');
        setClientSearch('');
        setClientSuggestions([]);
        setSelectedClientId(null);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
                <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                    {/* Header */}
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                                <UserPlus className="w-5 h-5 text-sky-600" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-800">{title || 'إضافة اسم مرشح جديد'}</h2>
                            </div>
                        </div>
                        <button onClick={resetAndClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-6 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
                        {error && (
                            <div className="p-3 mb-4 rounded-xl bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                                {error}
                            </div>
                        )}

                        {/* MODE TOGGLE */}
                        <div className="flex items-center bg-slate-100 p-1 rounded-xl w-full">
                            <button
                                onClick={() => setIsDirectMode(false)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!isDirectMode ? 'bg-amber-100 text-amber-800 shadow-sm border border-amber-200' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                عبر ورقة ترشيح
                            </button>
                            <button
                                onClick={() => setIsDirectMode(true)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${isDirectMode ? 'bg-indigo-100 text-indigo-800 shadow-sm border border-indigo-200' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                عبر ترشيح مباشر
                            </button>
                        </div>

                        {/* SECTION A */}
                        <div className="space-y-4">
                            <div className="mb-2"></div>

                            {!isDirectMode ? (
                                /* MODE B: Sheet-based */
                                <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 flex items-end gap-3 transition-all">
                                    <div className="flex-1">
                                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">اختر ورقة ترشيح  <span className="text-red-500">*</span></label>
                                        <select
                                            value={selectedSheetId}
                                            onChange={(e) => setSelectedSheetId(e.target.value ? Number(e.target.value) : '')}
                                            className="w-full p-2.5 rounded-xl border border-amber-200 bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm"
                                        >
                                            <option value="" disabled>-- اختر ورقة ترشيح لإضافة أسماء مقترحة مرتبطة بها --</option>
                                            {activeSheets.map((sheet: any) => (
                                                <option key={sheet.id} value={sheet.id}>
                                                    [#{sheet.id}] {sheet.referralNameSnapshot} - {sheet.stats.totalCandidates} أسماء
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        onClick={() => setIsCreateSheetOpen(true)}
                                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-xl text-sm font-bold shadow-sm transition-all h-[42px]"
                                    >
                                        <PlusCircle className="w-4 h-4" />
                                        ورقة جديدة
                                    </button>
                                </div>
                            ) : (
                                /* MODE A: Direct Referral */
                                <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-4 transition-all">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />التاريخ *</label>
                                            <input type="date" value={referralDate} onChange={e => setReferralDate(e.target.value)} className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-sm" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">نوع الوسيط *</label>
                                            <select value={referralType} onChange={e => setReferralType(e.target.value as ReferralType)} className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-sm">
                                                <option value="Personal">شخصي</option>
                                                <option value="Client">زبون حالي</option>
                                                <option value="Employee">موظف</option>
                                                <option value="Unknown">مجهول</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">طريقة الوصول *</label>
                                            <select
                                                value={originChannel}
                                                onChange={e => setOriginChannel(e.target.value as ReferralOriginChannel)}
                                                disabled={referralType === 'Personal' || referralType === 'Unknown'}
                                                className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                            >
                                                <option value="App">سوشال ميديا</option>
                                                <option value="Campaign">حملة إعلانية</option>
                                                <option value="Acquaintance">معرفة شخصية</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* DYNAMIC MEDIATOR RENDER */}
                                    {referralType === 'Employee' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">رقم الموظف *</label>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="text"
                                                    value={employeeIdInput}
                                                    onChange={(e) => setEmployeeIdInput(e.target.value)}
                                                    onBlur={handleEmployeeBlur}
                                                    placeholder="أدخل رقم الموظف..."
                                                    className="w-1/2 p-2.5 rounded-xl border border-indigo-200 bg-white text-sm"
                                                />
                                                {employeeFound && (
                                                    <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 flex-1 text-sm">
                                                        <CheckCircle className="w-5 h-5" />
                                                        {employeeFound.name}
                                                    </div>
                                                )}
                                                {employeeSearchError && (
                                                    <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 px-3 py-2 rounded-lg border border-red-100 flex-1 text-sm">
                                                        <AlertCircle className="w-5 h-5" />
                                                        {employeeSearchError}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {referralType === 'Client' && (
                                        <div ref={clientSearchRef} className="relative">
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الزبون *</label>
                                            <input
                                                type="text"
                                                value={clientSearch}
                                                onChange={(e) => handleClientSearch(e.target.value)}
                                                onFocus={() => handleClientSearch(clientSearch)}
                                                placeholder="ابحث عن الزبون بالاسم أو رقم الهاتف..."
                                                className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-sm"
                                            />
                                            {clientSuggestions.length > 0 && (
                                                <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                                                    {clientSuggestions.map(client => (
                                                        <button
                                                            key={client.id}
                                                            onClick={() => handleSelectClient(client)}
                                                            className="w-full text-right px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex items-center justify-between"
                                                        >
                                                            <div className="flex flex-col items-start gap-1">
                                                                <span className="font-bold text-slate-700 text-sm">{client.name}</span>
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${getClientLifecycleStage(client) === 'OP'
                                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                    : getClientLifecycleStage(client) === 'FOP'
                                                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                        : 'bg-slate-50 text-slate-600 border-slate-200'
                                                                    }`}>
                                                                    {getClientLifecycleStage(client) === 'OP' ? 'زبون OP' : getClientLifecycleStage(client) === 'FOP' ? 'زبون محتمل FOP' : 'اسم مرشح'}
                                                                </span>
                                                            </div>
                                                            <span className="text-xs text-slate-400 font-mono" dir="ltr">
                                                                {client.contacts?.find(con => con.isPrimary)?.number || client.contacts?.[0]?.number || client.mobile || '--'}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {(referralType === 'Personal' || referralType === 'Unknown') && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">  اسم الوسيط*</label>
                                            <input
                                                type="text"
                                                value={referralNameSnapshot}
                                                disabled
                                                className="w-full p-2.5 rounded-xl border border-indigo-200 bg-slate-50 text-slate-500 font-bold cursor-not-allowed text-sm"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* SECTION B: Candidate */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-slate-800 border-r-4 border-sky-500 pr-2"> بيانات الاسم المقترح</h3>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">الاسم الأول</label>
                                    <input type="text" value={candidateData.firstName} onChange={e => setCandidateData({ ...candidateData, firstName: e.target.value })} className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5"> اسم العائلة / الكنية</label>
                                    <input type="text" value={candidateData.lastName} onChange={e => setCandidateData({ ...candidateData, lastName: e.target.value })} className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">اللقب</label>
                                    <input type="text" value={candidateData.nickname} onChange={e => setCandidateData({ ...candidateData, nickname: e.target.value })} className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm" />
                                </div>
                            </div>

                            <div className="md:col-span-3">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-xs font-semibold text-slate-500">أرقام التواصل <span className="text-red-500">*</span></label>
                                    <button
                                        type="button"
                                        onClick={() => setCandidateData({
                                            ...candidateData,
                                            contacts: [...candidateData.contacts, { id: simpleUUID(), type: 'mobile', number: '', label: '', hasWhatsApp: false, isPrimary: candidateData.contacts.length === 0, status: 'active' }]
                                        })}
                                        className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1"
                                    >
                                        <PlusCircle className="w-3.5 h-3.5" /> إضافة رقم
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    <AnimatePresence initial={false}>
                                        {candidateData.contacts.map((contact, index) => (
                                            <motion.div
                                                key={contact.id}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="bg-gray-50 rounded-xl p-3 border border-gray-100 space-y-2.5"
                                            >
                                                {/* Row 1: Type + Number */}
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={contact.type}
                                                        onChange={e => {
                                                            const newContacts = [...candidateData.contacts];
                                                            newContacts[index] = { ...contact, type: e.target.value as any };
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                        }}
                                                        className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none min-w-[100px]"
                                                    >
                                                        {Object.entries(contactTypeConfig).map(([key, cfg]) => (
                                                            <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                                                        ))}
                                                    </select>

                                                    <input
                                                        type="text"
                                                        value={contact.number}
                                                        onChange={e => {
                                                            const newContacts = [...candidateData.contacts];
                                                            newContacts[index] = { ...contact, number: e.target.value.replace(/\D/g, '') };
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                            setError('');
                                                        }}
                                                        placeholder={contact.type === 'mobile' ? '09XXXXXXXX' : 'الرقم...'}
                                                        dir="ltr"
                                                        className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none"
                                                    />

                                                    {candidateData.contacts.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const newContacts = candidateData.contacts.filter((_, i) => i !== index);
                                                                if (contact.isPrimary && newContacts.length > 0) newContacts[0].isPrimary = true;
                                                                setCandidateData({ ...candidateData, contacts: newContacts });
                                                            }}
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all border border-transparent hover:border-red-100 shrink-0"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Row 2: Label + Status + WhatsApp + Primary */}
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={contact.label}
                                                        onChange={e => {
                                                            const newContacts = [...candidateData.contacts];
                                                            newContacts[index] = { ...contact, label: e.target.value };
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                        }}
                                                        placeholder="العلاقة (شخصي، زوجة، ابن...)"
                                                        className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none"
                                                    />

                                                    <select
                                                        value={contact.status}
                                                        onChange={e => {
                                                            const newContacts = [...candidateData.contacts];
                                                            newContacts[index] = { ...contact, status: e.target.value as any };
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                        }}
                                                        className={`border rounded-lg px-2 py-1.5 text-[11px] font-medium focus:outline-none min-w-[110px] ${contactStatusConfig[contact.status as keyof typeof contactStatusConfig]?.style || ''}`}
                                                    >
                                                        {Object.entries(contactStatusConfig).map(([key, cfg]) => (
                                                            <option key={key} value={key}>{cfg.label}</option>
                                                        ))}
                                                    </select>

                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newContacts = [...candidateData.contacts];
                                                            newContacts[index] = { ...contact, hasWhatsApp: !contact.hasWhatsApp };
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                        }}
                                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${contact.hasWhatsApp
                                                            ? 'bg-green-50 border-green-200 text-green-600'
                                                            : 'bg-white border-gray-200 text-gray-300 hover:text-gray-400'
                                                            }`}
                                                        title={contact.hasWhatsApp ? 'يدعم واتساب' : 'بدون واتساب'}
                                                    >
                                                        <MessageCircle className="w-3.5 h-3.5" />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const newContacts = candidateData.contacts.map((c, i) => ({ ...c, isPrimary: i === index }));
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                        }}
                                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${contact.isPrimary
                                                            ? 'bg-sky-50 border-sky-200'
                                                            : 'bg-white border-gray-200 hover:border-gray-300'
                                                            }`}
                                                        title="تعيين كرقم أساسي"
                                                    >
                                                        <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${contact.isPrimary ? 'border-sky-500' : 'border-gray-300'}`}>
                                                            {contact.isPrimary && <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
                                                        </div>
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <GeoSmartSearch label="العنوان" geoUnits={geoUnits} value={candidateData.locationSelection} onChange={loc => setCandidateData({ ...candidateData, locationSelection: loc })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />تفاصيل العنوان</label>
                                    <input
                                        type="text"
                                        placeholder="الشارع، البناية، الطابق..."
                                        value={candidateData.addressText}
                                        onChange={e => setCandidateData({ ...candidateData, addressText: e.target.value })}
                                        className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">المهنة</label>
                                    <select
                                        value={candidateData.occupation}
                                        onChange={e => setCandidateData({ ...candidateData, occupation: e.target.value })}
                                        className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm bg-white"
                                    >
                                        <option value="">اختر المهنة</option>
                                        {occupationOptions.map((option) => (
                                            <option key={option} value={option}>{option}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">ملاحظات الوسيط</label>
                                <textarea value={candidateData.candidateNotes} onChange={e => setCandidateData({ ...candidateData, candidateNotes: e.target.value })} rows={3} className="w-full p-3 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm resize-none" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-50 p-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                        <button onClick={resetAndClose} className="px-5 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition-all">إلغاء</button>
                        {!initialData && (
                            <button onClick={() => handleSave(true)} className="px-5 py-2 rounded-xl text-sky-600 bg-sky-50 border border-sky-100 font-bold hover:bg-sky-100 transition-all flex items-center gap-2">
                                <PlusCircle className="w-4 h-4" />
                                <span>حفظ وإضافة آخر</span>
                            </button>
                        )}
                        <button onClick={() => handleSave(false)} className="px-8 py-2 rounded-xl text-white bg-sky-600 font-bold hover:bg-sky-700 shadow-lg shadow-sky-500/20 transition-all flex items-center gap-2">
                            <Save className="w-4 h-4" />
                            <span>{initialData ? 'حفظ التغييرات' : 'حفظ الاسم'}</span>
                        </button>
                    </div>

                </div>
            </div >

            <CreateReferralSheetModal
                isOpen={isCreateSheetOpen}
                onClose={() => setIsCreateSheetOpen(false)}
                onSheetCreated={(id) => { setSelectedSheetId(id); setIsDirectMode(false); }}
            />
        </>
    );
}
