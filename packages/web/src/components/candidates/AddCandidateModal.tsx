import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { UserPlus, Calendar, PlusCircle, X, CheckCircle, AlertCircle, Save, MapPin, Trash2, MessageCircle, Plus } from 'lucide-react';
import { CandidateStatus, ReferralType, ReferralOriginChannel, Client, ContactEntry, Candidate, ContactType, ContactStatus } from '../../lib/types';
import CreateReferralSheetModal from './CreateReferralSessionModal';
import GeoSmartSearch, { GeoSelection } from '../GeoSmartSearch';
import { api } from '../../lib/api';
import type { GeoUnit } from '../../lib/types';
import { useAuthStore } from '../../hooks/useAuthStore';
import { findEmployeeByNumber, formatEmployeeMediatorLabel, MediatorEmployee, toMediatorEmployee } from '../../lib/employeeMediatorLookup';
import {
    CONTACT_STATUS_CONFIG,
    CONTACT_TYPE_CONFIG,
    SYRIAN_MOBILE_HINT,
    getContactValidationMessage,
    isInvalidContactNumber,
    normalizeContactNumberInput,
} from '../../lib/contactRules';

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

const contactTypeConfig = CONTACT_TYPE_CONFIG;
const contactStatusConfig = CONTACT_STATUS_CONFIG;

const normalizeOriginChannel = (value?: string | null): ReferralOriginChannel => {
    if (value === 'PhoneCall' || value === 'SocialMedia' || value === 'Campaign' || value === 'Acquaintance') {
        return value;
    }
    if (value === 'App') {
        return 'SocialMedia';
    }
    return 'Acquaintance';
};

const initialCandidateState: {
    firstName: string;
    nickname: string;
    lastName: string;
    contacts: ContactEntry[];
    locationSelection: GeoSelection;
    addressText: string;
    occupation: string;
    candidateNotes: string;
} = {
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
    const authUser = useAuthStore(state => state.user);
    const currentUserDisplayName = authUser?.name?.trim() || '';
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [contracts, setContracts] = useState<Array<{ customerId: number }>>([]);
    const [occupationOptions, setOccupationOptions] = useState<string[]>([]);
    useEffect(() => {
        let active = true;

        Promise.all([
            api.geoUnits.list(),
            api.clients.list(),
            api.contracts.list(),
            api.systemLists.list({ category: 'occupation', activeOnly: true }),
        ])
            .then(([units, clients, contractsData, occupationList]) => {
                if (!active) return;
                setGeoUnits(units);
                setAllClients(clients);
                setContracts(contractsData);
                setOccupationOptions(occupationList.map((item: any) => item.value));
            })
            .catch((error) => {
                console.error(error);
                if (!active) return;
                setGeoUnits([]);
                setAllClients([]);
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
    const [employeeFound, setEmployeeFound] = useState<MediatorEmployee | null>(null);
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
                    setOriginChannel(normalizeOriginChannel(initialData.referralOriginChannel));
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
                setReferralNameSnapshot(currentUserDisplayName);
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
            setReferralNameSnapshot(currentUserDisplayName);
            setEmployeeIdInput('');
            setEmployeeFound(null);
            setEmployeeSearchError('');
            setClientSearch('');
            setSelectedClientId(null);
            setClientSuggestions([]);
        } else if (referralType === 'Unknown') {
            setReferralNameSnapshot('مجهول');
            setEmployeeIdInput('');
            setEmployeeFound(null);
            setEmployeeSearchError('');
            setClientSearch('');
            setSelectedClientId(null);
            setClientSuggestions([]);
        } else {
            setReferralNameSnapshot('');
            if (referralType === 'Employee') {
                setClientSearch('');
                setSelectedClientId(null);
                setClientSuggestions([]);
            }
            if (referralType === 'Client') {
                setEmployeeIdInput('');
                setEmployeeFound(null);
                setEmployeeSearchError('');
            }
        }
    }, [referralType, isDirectMode, isOpen, currentUserDisplayName]);



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
            const employees = (await api.employees.list()).map(toMediatorEmployee);
            const emp = findEmployeeByNumber(employees, employeeIdInput);
            if (emp) {
                setEmployeeFound(emp);
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
        const serverStage = (client as any).lifecycleStage;
        if (serverStage === 'OP' || serverStage === 'FOP') return serverStage;
        if (contracts.some(contract => contract.customerId === client.id)) return 'OP';
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

    const selectedSheet = useMemo(
        () => activeSheets.find((sheet: any) => sheet.id === selectedSheetId),
        [activeSheets, selectedSheetId],
    );



    const candidatesList = useCandidateStore((state: any) => state.candidates);

    const validateForm = () => {
        if (!isDirectMode && !selectedSheetId) {
            setError('يجب اختيار لائحة أسماء في وضع (لائحة الأسماء).');
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
        const invalidContact = candidateData.contacts.find(contact => getContactValidationMessage(contact));
        if (invalidContact) {
            setError(getContactValidationMessage(invalidContact)!);
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
            let resolvedReferralType = referralType;
            let resolvedOriginChannel = originChannel;
            let resolvedReferralNameSnapshot = referralNameSnapshot;
            if (!isDirectMode && selectedSheet) {
                resolvedReferralType = selectedSheet.referralType;
                resolvedOriginChannel = selectedSheet.referralOriginChannel;
                resolvedReferralNameSnapshot = selectedSheet.referralNameSnapshot;
                entityId = selectedSheet.referralEntityId ?? null;
            } else if (referralType === 'Employee' && employeeFound) {
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
                referralType: resolvedReferralType,
                referralOriginChannel: resolvedOriginChannel,
                referralNameSnapshot: resolvedReferralNameSnapshot,
                referralEntityId: entityId,
                referralDate: new Date(referralDate).toISOString(),
                referralReason: isDirectMode ? 'Direct Referral' : 'Part of Sheet',
                occupation: candidateData.occupation,
                candidateNotes: candidateData.candidateNotes,
                ownerUserId: authUser?.id ?? 0,
                createdBy: authUser?.id ?? 0
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
        setOriginChannel('Acquaintance');
        setReferralNameSnapshot(currentUserDisplayName);
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
                                عبر لائحة أسماء
                            </button>
                            <button
                                onClick={() => setIsDirectMode(true)}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${isDirectMode ? 'bg-indigo-100 text-indigo-800 shadow-sm border border-indigo-200' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                عبر اقتراح مباشر
                            </button>
                        </div>

                        {/* SECTION A */}
                        <div className="space-y-4">
                            <div className="mb-2"></div>

                            {!isDirectMode ? (
                                /* MODE B: Sheet-based */
                                <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 flex items-end gap-3 transition-all">
                                    <div className="flex-1">
                                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">اختر لائحة أسماء  <span className="text-red-500">*</span></label>
                                        <select
                                            value={selectedSheetId}
                                            onChange={(e) => setSelectedSheetId(e.target.value ? Number(e.target.value) : '')}
                                            className="w-full p-2.5 rounded-xl border border-amber-200 bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm"
                                        >
                                            <option value="" disabled>-- اختر لائحة أسماء لإضافة أسماء مقترحة مرتبطة بها --</option>
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
                                        لائحة جديدة
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
                                                <option value="Client">زبون</option>
                                                <option value="Employee">موظف</option>
                                                <option value="Unknown">مجهول</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">طريقة التواصل *</label>
                                            <select
                                                value={originChannel}
                                                onChange={e => setOriginChannel(e.target.value as ReferralOriginChannel)}
                                                className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-sm"
                                            >
                                                <option value="Acquaintance">معرفة شخصية</option>
                                                <option value="PhoneCall">مكالمة هاتفية</option>
                                                <option value="SocialMedia">سوشال ميديا</option>
                                                <option value="Campaign">حملة إعلانية</option>
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
                                                <button
                                                    type="button"
                                                    onClick={handleEmployeeBlur}
                                                    className="px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-100"
                                                >
                                                    اعتماد
                                                </button>
                                                {employeeFound && (
                                                    <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 flex-1 text-sm">
                                                        <CheckCircle className="w-5 h-5" />
                                                        {formatEmployeeMediatorLabel(employeeFound)}
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
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الوسيط *</label>
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

                            <div className="md:col-span-3 space-y-3">
                                <label className="block text-xs font-semibold text-slate-500">أرقام التواصل <span className="text-red-500">*</span></label>

                                <AnimatePresence initial={false}>
                                    {candidateData.contacts.map((contact, index) => {
                                        const hasInvalidNumber = isInvalidContactNumber(contact) || contact.status === 'invalid';
                                        return (
                                        <motion.div
                                            key={contact.id}
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className={`rounded-xl p-3 border space-y-2.5 ${hasInvalidNumber ? 'bg-red-50/40 border-red-200' : 'bg-gray-50 border-gray-100'}`}
                                        >
                                            {/* Row 1: Type + Country code / Area code + Number + Delete */}
                                            <div className="flex items-center gap-2">
                                                <select
                                                    value={contact.type}
                                                    onChange={e => {
                                                        const newContacts = [...candidateData.contacts];
                                                        newContacts[index] = { ...contact, type: e.target.value as ContactType, number: '', areaCode: '' };
                                                        setCandidateData({ ...candidateData, contacts: newContacts });
                                                    }}
                                                    className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none min-w-[100px]"
                                                >
                                                    {Object.entries(contactTypeConfig).map(([key, cfg]) => (
                                                        <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                                                    ))}
                                                </select>

                                                {/* +963 badge for mobile */}
                                                {contact.type === 'mobile' && (
                                                    <span className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 select-none shrink-0" dir="ltr">+963</span>
                                                )}

                                                {/* Area code for landline */}
                                                {contact.type === 'landline' && (
                                                    <input
                                                        type="text"
                                                        value={(contact as any).areaCode || ''}
                                                        onChange={e => {
                                                            const v = e.target.value.replace(/\D/g, '').slice(0, 3);
                                                            const newContacts = [...candidateData.contacts];
                                                            newContacts[index] = { ...contact, areaCode: v } as any;
                                                            setCandidateData({ ...candidateData, contacts: newContacts });
                                                        }}
                                                        placeholder="011"
                                                        dir="ltr"
                                                        maxLength={3}
                                                        className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-800 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none w-[60px] text-center"
                                                    />
                                                )}

                                                <input
                                                    type="text"
                                                    value={contact.number}
                                                    onChange={e => {
                                                        const v = normalizeContactNumberInput(contact.type, contact.status, e.target.value, contact.number);
                                                        const newContacts = [...candidateData.contacts];
                                                        newContacts[index] = { ...contact, number: v };
                                                        setCandidateData({ ...candidateData, contacts: newContacts });
                                                        setError('');
                                                    }}
                                                    placeholder={
                                                        contact.type === 'mobile'   ? SYRIAN_MOBILE_HINT :
                                                        contact.type === 'landline' ? 'XXXXXXX'    : 'الرقم...'
                                                    }
                                                    dir="ltr"
                                                    maxLength={contact.type === 'mobile' ? 10 : contact.type === 'landline' ? 7 : 15}
                                                    className={`flex-1 bg-white border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-gray-300 focus:outline-none ${hasInvalidNumber ? 'border-red-300 text-red-700 focus:border-red-400' : 'border-gray-200 text-slate-800 focus:border-sky-500'}`}
                                                />

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const newContacts = candidateData.contacts.filter((_, i) => i !== index);
                                                        if (contact.isPrimary && newContacts.length > 0) newContacts[0].isPrimary = true;
                                                        setCandidateData({ ...candidateData, contacts: newContacts.length > 0 ? newContacts : [{ id: simpleUUID(), type: 'mobile', number: '', label: '', hasWhatsApp: false, isPrimary: true, status: 'active' }] });
                                                    }}
                                                    title="حذف الرقم"
                                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all border border-transparent hover:border-red-100 shrink-0"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
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
                                                        newContacts[index] = { ...contact, status: e.target.value as ContactStatus };
                                                        setCandidateData({ ...candidateData, contacts: newContacts });
                                                    }}
                                                    className={`border rounded-lg px-2 py-1.5 text-[11px] font-medium focus:outline-none min-w-[110px] ${contactStatusConfig[contact.status as ContactStatus]?.style || ''}`}
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
                                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${contact.hasWhatsApp ? 'bg-green-50 border-green-200 text-green-600' : 'bg-white border-gray-200 text-gray-300 hover:text-gray-400'}`}
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
                                                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${contact.isPrimary ? 'bg-sky-50 border-sky-200' : 'bg-white border-gray-200 hover:border-gray-300'}`}
                                                    title="تعيين كرقم أساسي"
                                                >
                                                    <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${contact.isPrimary ? 'border-sky-500' : 'border-gray-300'}`}>
                                                        {contact.isPrimary && <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
                                                    </div>
                                                </button>
                                            </div>

                                            {hasInvalidNumber && (
                                                <div className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border w-fit bg-red-100 text-red-700 border-red-200">
                                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                                    رقم موبايل غير مطابق للصيغة 09XXXXXXXX
                                                </div>
                                            )}
                                        </motion.div>
                                    );
                                    })}
                                </AnimatePresence>

                                {/* Add button — full-width dashed */}
                                <button
                                    type="button"
                                    onClick={() => setCandidateData({
                                        ...candidateData,
                                        contacts: [...candidateData.contacts, { id: simpleUUID(), type: 'mobile', number: '', label: '', hasWhatsApp: false, isPrimary: candidateData.contacts.length === 0, status: 'active' }]
                                    })}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-200 text-slate-500 hover:border-sky-300 hover:text-sky-600 hover:bg-sky-50/50 transition-all text-sm font-medium"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span>إضافة رقم</span>
                                </button>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <GeoSmartSearch label="العنوان" geoUnits={geoUnits} value={candidateData.locationSelection} onChange={loc => setCandidateData({ ...candidateData, locationSelection: loc })} />
                                    <p className="mt-1.5 text-[11px] text-slate-500 font-medium">
                                        يمكن اختيار أي مستوى متاح للاسم المقترح، لكن عند تحويله إلى زبون يجب تحديد ناحية على الأقل.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />العنوان التفصيلي</label>
                                    <textarea
                                        rows={3}
                                        placeholder="الشارع، البناية، الطابق..."
                                        value={candidateData.addressText}
                                        onChange={e => setCandidateData({ ...candidateData, addressText: e.target.value })}
                                        className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 text-sm resize-none"
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
