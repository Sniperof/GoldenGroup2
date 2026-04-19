import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Users, Phone, MapPin, Share2, Save, Plus, Trash2, MessageCircle, MapPinned, CheckCircle, AlertCircle } from 'lucide-react';
import type { Client, GeoUnit, ContactEntry, ContactType, ContactStatus, ReferralType, ReferralOriginChannel, ClientRating } from '../lib/types';
import { useRef } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import MapPicker from './MapPicker';
import GeoSmartSearch from './GeoSmartSearch';
import type { GeoSelection } from './GeoSmartSearch';
import { useCandidateStore } from '../hooks/useCandidateStore';
import { api } from '../lib/api';

interface ClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (client: Client) => void;
    initialData: Client | null;
    geoUnits: GeoUnit[];
}

type Tab = 'identity' | 'contact' | 'location' | 'referral' | 'network' | 'additional';

const tabsDef: { id: Tab; label: string; icon: any }[] = [
    { id: 'identity', label: 'الهوية', icon: User },
    { id: 'contact', label: 'التواصل', icon: Phone },
    { id: 'location', label: 'العنوان', icon: MapPin },
    { id: 'referral', label: 'الوسيط', icon: Share2 },
    { id: 'additional', label: 'معلومات إضافية', icon: Plus },
];

const contactTypeConfig: Record<ContactType, { label: string; emoji: string }> = {
    mobile: { label: 'موبايل', emoji: '📱' },
    landline: { label: 'أرضي', emoji: '☎️' },
    other: { label: 'آخر', emoji: '📞' },
};

const contactStatusConfig: Record<ContactStatus, { label: string; style: string }> = {
    active: { label: 'فعّال', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    preferred: { label: 'مفضّل', style: 'bg-sky-50 text-sky-700 border-sky-200' },
    'out-of-coverage': { label: 'خارج التغطية', style: 'bg-amber-50 text-amber-700 border-amber-200' },
    unused: { label: 'غير مستخدم', style: 'bg-gray-50 text-gray-500 border-gray-200' },
};

const makeId = () => Math.random().toString(36).slice(2, 10);

const emptyContact = (isPrimary = false): ContactEntry => ({
    id: makeId(), type: 'mobile', number: '', areaCode: '', label: '',
    hasWhatsApp: false, isPrimary, status: 'active',
});

export default function ClientModal({ isOpen, onClose, onSave, initialData, geoUnits }: ClientModalProps) {
    const isEditMode = Boolean(initialData?.id);
    const [activeTab, setActiveTab] = useState<Tab>('identity');
    const [formData, setFormData] = useState<Partial<Client>>({});

    const candidates = useCandidateStore(state => state.candidates);
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [visits, setVisits] = useState<Array<{ customerId: number }>>([]);
    const [contracts, setContracts] = useState<Array<{ customerId: number }>>([]);
    const [employees, setEmployees] = useState<Array<{ id: number; name: string }>>([]);
    const [occupationOptions, setOccupationOptions] = useState<string[]>([]);

    // Identity fields
    const [firstName, setFirstName] = useState('');
    const [nickname, setNickname] = useState('');
    const [lastName, setLastName] = useState('');
    const [fatherName, setFatherName] = useState('');

    // Contacts
    const [contacts, setContacts] = useState<ContactEntry[]>([emptyContact(true)]);

    // Geo — single smart search
    const [geoSelection, setGeoSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });

    // Map
    const [mapPosition, setMapPosition] = useState<[number, number] | null>(null);

    // Mediator states
    const [referralType, setReferralType] = useState<ReferralType>('Personal');
    const [originChannel, setOriginChannel] = useState<ReferralOriginChannel>('App');
    const [referralNameSnapshot, setReferralNameSnapshot] = useState('');
    const [employeeIdInput, setEmployeeIdInput] = useState('');
    const [employeeFound, setEmployeeFound] = useState<{ name: string, id: number } | null>(null);
    const [employeeSearchError, setEmployeeSearchError] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
    const [occupation, setOccupation] = useState('');
    const [spouseOccupation, setSpouseOccupation] = useState('');
    const [dataQuality, setDataQuality] = useState<string>('');
    const [notes, setNotes] = useState('');
    const [rating, setRating] = useState<ClientRating>('Undefined');
    const clientSearchRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (clientSearchRef.current && !clientSearchRef.current.contains(event.target as Node)) {
                setClientSuggestions([]);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        let active = true;

        const fetchLookupData = async () => {
            try {
                const [clientsData, employeesData, visitsData, contractsData, occupationList] = await Promise.all([
                    api.clients.list(),
                    api.employees.list(),
                    api.visits.list(),
                    api.contracts.list(),
                    api.systemLists.list({ category: 'occupation', activeOnly: true }),
                ]);

                if (!active) return;
                setAllClients(clientsData);
                setEmployees(employeesData.map((employee: any) => ({ id: employee.id, name: employee.name })));
                setVisits(visitsData);
                setContracts(contractsData);
                setOccupationOptions(occupationList.map((item: any) => item.value));
            } catch (error) {
                console.error('Failed to fetch client modal lookup data:', error);
                if (!active) return;
                setAllClients([]);
                setEmployees([]);
                setVisits([]);
                setContracts([]);
                setOccupationOptions([]);
            }
        };

        fetchLookupData();

        return () => {
            active = false;
        };
    }, [isOpen]);

    useEffect(() => {
        if (referralType === 'Personal') {
            setOriginChannel('Acquaintance');
            setReferralNameSnapshot('المدير/المشرف المباشر');
        } else if (referralType === 'Unknown') {
            setReferralNameSnapshot('مجهول');
        } else if (referralType === 'Employee' && employeeFound) {
            setReferralNameSnapshot(employeeFound.name);
        } else if (referralType === 'Client' && selectedClientId) {
            // Already handled in select client
        }
    }, [referralType, employeeFound, selectedClientId]);

    const handleEmployeeBlur = () => {
        if (!employeeIdInput.trim()) {
            setEmployeeFound(null);
            setEmployeeSearchError('');
            return;
        }
        const emp = employees.find(e => e.id.toString() === employeeIdInput.trim());
        if (emp) {
            setEmployeeFound({ name: emp.name, id: emp.id });
            setReferralNameSnapshot(emp.name);
            setEmployeeSearchError('');
        } else {
            setEmployeeFound(null);
            setReferralNameSnapshot('');
            setEmployeeSearchError('لم يتم العثور على الموظف');
        }
    };

    const getClientLifecycleStage = useCallback((client: Client) => {
        if (contracts.some(contract => contract.customerId === client.id)) return 'OP';
        if (visits.some(visit => visit.customerId === client.id)) return 'FOP';
        return 'Lead';
    }, [contracts, visits]);

    const handleClientSearch = (text: string) => {
        setClientSearch(text);
        const query = text.trim();
        const matches = allClients
            .filter(c => !c.isCandidate && c.id !== initialData?.id)
            .filter(c =>
                !query ||
                c.name.includes(query) ||
                (c.contacts?.some(con => con.number.includes(query)) || false)
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

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setFormData(initialData);
                setFirstName(initialData.firstName || '');
                setNickname(initialData.nickname || '');
                setLastName(initialData.lastName || '');
                setFatherName(initialData.fatherName || '');
                if (initialData.contacts && initialData.contacts.length > 0) {
                    setContacts(initialData.contacts);
                } else {
                    setContacts([emptyContact(true)]);
                }
                if (initialData.gpsCoordinates) {
                    setMapPosition([initialData.gpsCoordinates.lat, initialData.gpsCoordinates.lng]);
                } else {
                    setMapPosition(null);
                }
                setReferralType((initialData.referrerType as ReferralType) || 'Personal');
                setOriginChannel((initialData.sourceChannel as ReferralOriginChannel) || 'App');
                setReferralNameSnapshot(initialData.referrerName || '');
                setClientSearch(initialData.referrerType === 'Client' ? (initialData.referrerName || '') : '');
                setSelectedClientId(initialData.referrerType === 'Client' ? (initialData.referralEntityId || null) : null);
                setOccupation(initialData.occupation || '');
                setSpouseOccupation(initialData.spouseOccupation || '');
                setDataQuality(initialData.dataQuality || '');
                setNotes(initialData.notes || '');
                setRating(initialData.rating || 'Undefined');
            } else {
                setFormData({ sourceChannel: 'App', referrerType: 'Other', governorate: '1' });
                setFirstName(''); setNickname(''); setLastName(''); setFatherName('');
                setContacts([emptyContact(true)]);
                setMapPosition(null);
                setReferralType('Personal');
                setOriginChannel('App');
                setReferralNameSnapshot('');
                setOccupation('');
                setSpouseOccupation('');
                setDataQuality('');
                setNotes('');
                setRating('Undefined');
                setEmployeeIdInput('');
                setClientSearch('');
                setSelectedClientId(null);
            }
            setActiveTab('identity');
            setGeoSelection({
                govId: initialData?.governorate?.toString() || '',
                regionId: '',
                subId: '',
                neighborhoodId: initialData?.neighborhood?.toString() || '',
            });
        }
    }, [isOpen, initialData]);

    const updateForm = useCallback((key: string, value: any) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    }, []);

    // -- Contact handlers --
    const updateContact = useCallback((id: string, field: keyof ContactEntry, value: any) => {
        setContacts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    }, []);

    const addContact = useCallback(() => setContacts(prev => [...prev, emptyContact()]), []);

    const removeContact = useCallback((id: string) => {
        setContacts(prev => {
            const updated = prev.filter(c => c.id !== id);
            if (updated.length > 0 && !updated.some(c => c.isPrimary)) updated[0].isPrimary = true;
            return updated.length === 0 ? [emptyContact(true)] : updated;
        });
    }, []);

    const setPrimary = useCallback((id: string) => {
        setContacts(prev => prev.map(c => ({ ...c, isPrimary: c.id === id })));
    }, []);

    // -- Geo --
    const handleGeoChange = useCallback((sel: GeoSelection) => {
        setGeoSelection(sel);
        updateForm('governorate', sel.govId);
        updateForm('neighborhood', sel.neighborhoodId);
    }, [updateForm]);

    const handleLocationSelect = useCallback((lat: number, lng: number) => {
        setMapPosition([lat, lng]);
        setFormData(prev => ({ ...prev, gpsCoordinates: { lat, lng } }));
    }, []);

    const broughtBy = useMemo(() => {
        if (!initialData) return null;
        if (initialData.referrerType === 'Client' && initialData.referralEntityId) {
            return allClients.find(c => c.id === initialData.referralEntityId);
        }
        return null;
    }, [initialData, allClients]);

    const referralsList = useMemo(() => {
        if (!initialData || !initialData.id) return [];
        const cid = initialData.id;

        const clientRefs: any[] = [];
        allClients.forEach(c => {
            const referrersToCheck = c.referrers && c.referrers.length > 0
                ? c.referrers
                : [{
                    referralEntityId: c.referralEntityId,
                    referrerType: c.referrerType,
                    referralSheetId: c.referralSheetId,
                    referralDate: c.referralDate
                }];

            referrersToCheck.forEach(r => {
                if (r.referralEntityId === cid && r.referrerType === 'Client') {
                    // avoid duplicates if somehow legacy and referrers array have the same entry
                    if (!clientRefs.some(ref => ref.id === c.id && ref.date === (r.referralDate || c.createdAt))) {
                        clientRefs.push({
                            id: c.id,
                            name: c.name,
                            status: c.isCandidate ? 'Candidate' : (c.candidateStatus || 'Client'),
                            method: r.referralSheetId ? `ورقة #${r.referralSheetId}` : 'مباشر',
                            date: r.referralDate || c.createdAt,
                            type: 'client' as const
                        });
                    }
                }
            });
        });

        const candRefs = candidates
            .filter(c => c.referralEntityId === cid && c.referralType === 'Client')
            .map(c => ({
                id: c.id,
                name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.nickname || '',
                status: c.status,
                method: c.referralSheetId ? `ورقة #${c.referralSheetId}` : 'مباشر',
                date: c.referralDate,
                type: 'candidate' as const
            }));

        const unconvertedCandRefs = candRefs.filter(cr => {
            const cand = candidates.find(c => c.id === cr.id);
            return cand && !cand.convertedToLeadId;
        });

        return [...clientRefs, ...unconvertedCandRefs].sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime());
    }, [initialData, allClients, candidates]);

    // -- Duplicate detection: map number → {id, name, isPrimary} of the OTHER client --
    const duplicateMap = useMemo(() => {
        const map = new Map<string, { id: number; name: string; contactPrimary: boolean }>();
        for (const client of allClients) {
            if (initialData?.id && client.id === initialData.id) continue; // skip self
            for (const contact of (client.contacts || [])) {
                if (contact.number && contact.number.length >= 6 && !map.has(contact.number)) {
                    map.set(contact.number, {
                        id: client.id,
                        name: client.name,
                        contactPrimary: contact.isPrimary,
                    });
                }
            }
        }
        return map;
    }, [allClients, initialData?.id]);

    const primaryContact = contacts.find(c => c.isPrimary);
    const primaryDup = primaryContact?.number && primaryContact.number.length >= 6
        ? duplicateMap.get(primaryContact.number)
        : undefined;

    // -- Save --
    const handleSave = () => {
        if (!firstName.trim() && !nickname.trim()) {
            alert('يرجى ملء الاسم الأول أو اللقب على الأقل');
            return;
        }

        const fullName = [firstName.trim(), fatherName.trim(), lastName.trim(), nickname.trim() ? '(' + nickname.trim() + ')' : ''].filter(Boolean).join(' ').trim();
        const primaryNumber = primaryContact?.number || contacts[0]?.number || '';

        if (!primaryNumber) {
            alert('يرجى ملء رقم هاتف رئيسي واحد على الأقل');
            return;
        }

        if (primaryDup) {
            alert(`الرقم الأساسي (${primaryNumber}) مكرر عند الزبون: ${primaryDup.name} (كرقم ${primaryDup.contactPrimary ? 'أساسي' : 'ثانوي'}). يجب اختيار رقم أساسي فريد.`);
            return;
        }

        onSave({
            ...formData,
            firstName: firstName.trim(),
            fatherName: fatherName.trim(),
            lastName: lastName.trim(),
            nickname: nickname.trim() || undefined,
            name: fullName,
            mobile: primaryNumber,
            contacts: contacts.filter(c => c.number.trim()),
            gpsCoordinates: mapPosition ? { lat: mapPosition[0], lng: mapPosition[1] } : undefined,
            referrerType: referralType,
            sourceChannel: originChannel,
            referrerName: referralNameSnapshot,
            referralEntityId: selectedClientId || employeeFound?.id || undefined,
            occupation: occupation.trim() || undefined,
            spouseOccupation: spouseOccupation.trim() || undefined,
            dataQuality: (dataQuality as any) || undefined,
            notes: notes.trim() || undefined,
            ...(isEditMode ? { rating } : {}),
        } as Client);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40" onClick={onClose} />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] max-h-[90vh] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col"
                        style={{ direction: 'rtl' }}
                    >
                        {/* Header */}
                        <div className="bg-white border-b border-gray-100 p-5 flex items-center justify-between shrink-0">
                            <h2 className="text-xl font-bold text-slate-800">
                                {isEditMode ? 'تعديل بيانات الزبون' : 'إضافة زبون جديد'}
                            </h2>
                            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="bg-gray-50 px-5 pt-4 border-b border-gray-200 flex gap-2 overflow-x-auto shrink-0">
                            {tabsDef.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-lg transition-all relative top-[1px] ${activeTab === tab.id
                                        ? 'bg-white text-sky-600 border border-gray-200 border-b-white z-10 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-gray-100'
                                        }`}
                                >
                                    <tab.icon className="w-4 h-4" />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="p-6 flex-1 overflow-y-auto custom-scroll bg-white">

                            {/* ============ IDENTITY TAB ============ */}
                            {activeTab === 'identity' && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">الاسم الأول <span className="text-red-500">*</span></label>
                                            <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" placeholder="مثال: أحمد" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">اسم الأب</label>
                                            <input value={fatherName} onChange={e => setFatherName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" placeholder="مثال: خالد" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">الكنية (العائلة)</label>
                                            <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" placeholder="مثال: زيتون" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">اللقب</label>
                                            <input value={nickname} onChange={e => setNickname(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" placeholder="مثال: أبو أيوب" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ============ CONTACT TAB ============ */}
                            {activeTab === 'contact' && (
                                <div className="space-y-3">
                                    {/* Primary duplicate warning banner */}
                                    {primaryDup && (
                                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-xs text-red-700">
                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                                            <div>
                                                <span className="font-bold">الرقم الأساسي مكرر!</span> موجود عند الزبون:{' '}
                                                <strong>{primaryDup.name}</strong> كرقم{' '}
                                                {primaryDup.contactPrimary ? 'أساسي' : 'ثانوي'}.
                                                يجب تغيير الرقم الأساسي لحفظ البيانات.
                                            </div>
                                        </div>
                                    )}

                                    <AnimatePresence initial={false}>
                                        {contacts.map((c) => {
                                            const dup = c.number && c.number.length >= 6
                                                ? duplicateMap.get(c.number)
                                                : undefined;
                                            const isDupPrimary = Boolean(dup) && !c.isPrimary;

                                            return (
                                            <motion.div
                                                key={c.id}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className={`bg-gray-50 rounded-xl p-3 border space-y-2.5 ${c.isPrimary && dup ? 'border-red-300 bg-red-50/40' : dup ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100'}`}
                                            >
                                                {/* Row 1: Type + Number + Duplicate badge + Remove */}
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={c.type}
                                                        onChange={e => updateContact(c.id, 'type', e.target.value as ContactType)}
                                                        className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none min-w-[100px]"
                                                    >
                                                        {Object.entries(contactTypeConfig).map(([key, cfg]) => (
                                                            <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                                                        ))}
                                                    </select>

                                                    {c.type === 'mobile' && (
                                                        <span className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 select-none shrink-0" dir="ltr">+963</span>
                                                    )}

                                                    {c.type === 'landline' && (
                                                        <input
                                                            type="text"
                                                            value={c.areaCode || ''}
                                                            onChange={e => {
                                                                const v = e.target.value.replace(/\D/g, '').slice(0, 3);
                                                                updateContact(c.id, 'areaCode', v);
                                                            }}
                                                            placeholder="011"
                                                            dir="ltr"
                                                            maxLength={3}
                                                            className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-800 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none w-[60px] text-center"
                                                        />
                                                    )}

                                                    <input
                                                        type="text"
                                                        value={c.number}
                                                        onChange={e => {
                                                            let v = e.target.value.replace(/\D/g, '');
                                                            if (c.type === 'mobile') v = v.slice(0, 10);
                                                            else if (c.type === 'landline') v = v.slice(0, 7);
                                                            updateContact(c.id, 'number', v);
                                                        }}
                                                        placeholder={c.type === 'mobile' ? '9XXXXXXXXX' : c.type === 'landline' ? 'XXXXXXX' : 'الرقم...'}
                                                        dir="ltr"
                                                        maxLength={c.type === 'mobile' ? 10 : c.type === 'landline' ? 7 : 15}
                                                        className={`flex-1 bg-white border rounded-lg px-3 py-2 text-sm font-mono text-slate-800 placeholder:text-gray-300 focus:outline-none ${
                                                            dup ? 'border-amber-300 focus:border-amber-400' : 'border-gray-200 focus:border-sky-500'
                                                        }`}
                                                    />

                                                    <button type="button" onClick={() => removeContact(c.id)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all border border-transparent hover:border-red-100 shrink-0">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>

                                                {/* Duplicate badge */}
                                                {dup && (
                                                    <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border w-fit ${
                                                        c.isPrimary
                                                            ? 'bg-red-100 text-red-700 border-red-200'
                                                            : 'bg-amber-100 text-amber-700 border-amber-200'
                                                    }`}>
                                                        <AlertCircle className="w-3 h-3 shrink-0" />
                                                        مكرر عند: {dup.name} (#{dup.id}) — رقم {dup.contactPrimary ? 'أساسي' : 'ثانوي'}
                                                    </div>
                                                )}

                                                {/* Row 2: Label + Status + WhatsApp + Primary */}
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={c.label}
                                                        onChange={e => updateContact(c.id, 'label', e.target.value)}
                                                        placeholder="العلاقة (شخصي، زوجة، ابن...)"
                                                        className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none"
                                                    />

                                                    <select
                                                        value={c.status}
                                                        onChange={e => updateContact(c.id, 'status', e.target.value as ContactStatus)}
                                                        className={`border rounded-lg px-2 py-1.5 text-[11px] font-medium focus:outline-none min-w-[110px] ${contactStatusConfig[c.status].style}`}
                                                    >
                                                        {Object.entries(contactStatusConfig).map(([key, cfg]) => (
                                                            <option key={key} value={key}>{cfg.label}</option>
                                                        ))}
                                                    </select>

                                                    <button
                                                        type="button"
                                                        onClick={() => updateContact(c.id, 'hasWhatsApp', !c.hasWhatsApp)}
                                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${c.hasWhatsApp
                                                            ? 'bg-green-50 border-green-200 text-green-600'
                                                            : 'bg-white border-gray-200 text-gray-300 hover:text-gray-400'
                                                            }`}
                                                        title={c.hasWhatsApp ? 'يدعم واتساب' : 'بدون واتساب'}
                                                    >
                                                        <MessageCircle className="w-3.5 h-3.5" />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (isDupPrimary) return; // can't set duplicate as primary
                                                            setPrimary(c.id);
                                                        }}
                                                        disabled={isDupPrimary}
                                                        title={isDupPrimary ? 'لا يمكن تعيين رقم مكرر كرقم أساسي' : 'تعيين كرقم أساسي'}
                                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${
                                                            c.isPrimary
                                                                ? dup ? 'bg-red-50 border-red-300' : 'bg-sky-50 border-sky-200'
                                                                : isDupPrimary
                                                                    ? 'bg-gray-50 border-gray-200 opacity-40 cursor-not-allowed'
                                                                    : 'bg-white border-gray-200 hover:border-gray-300'
                                                        }`}
                                                    >
                                                        <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                                                            c.isPrimary
                                                                ? dup ? 'border-red-500' : 'border-sky-500'
                                                                : 'border-gray-300'
                                                        }`}>
                                                            {c.isPrimary && <div className={`w-1.5 h-1.5 rounded-full ${dup ? 'bg-red-500' : 'bg-sky-500'}`} />}
                                                        </div>
                                                    </button>
                                                </div>
                                            </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>

                                    <button type="button" onClick={addContact} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-gray-200 text-slate-500 hover:border-sky-300 hover:text-sky-600 hover:bg-sky-50/50 transition-all text-sm font-medium">
                                        <Plus className="w-4 h-4" />
                                        <span>إضافة رقم</span>
                                    </button>
                                </div>
                            )}

                            {/* ============ LOCATION TAB ============ */}
                            {activeTab === 'location' && (
                                <div className="space-y-4">
                                    <GeoSmartSearch
                                        geoUnits={geoUnits}
                                        value={geoSelection}
                                        onChange={handleGeoChange}
                                        label="العنوان"
                                        required
                                        placeholder="ابحث عن محافظة، منطقة، حي..."
                                    />
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold text-slate-500">أقرب نقطة دالة / تفاصيل العنوان</label>
                                        <textarea value={formData.detailedAddress || ''} onChange={e => updateForm('detailedAddress', e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-sky-500 focus:outline-none min-h-[60px] resize-none" />
                                    </div>

                                    {/* Map */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                                                <MapPinned className="w-3.5 h-3.5" />
                                                <span>تحديد الموقع على الخريطة</span>
                                            </label>
                                            {mapPosition && (
                                                <span className="text-[10px] font-mono text-slate-400" dir="ltr">
                                                    {mapPosition[0].toFixed(5)}, {mapPosition[1].toFixed(5)}
                                                </span>
                                            )}
                                        </div>
                                        <MapPicker position={mapPosition} onLocationSelect={handleLocationSelect} />
                                    </div>
                                </div>
                            )
                            }

                            {/* ============ REFERRAL TAB ============ */}
                            {
                                activeTab === 'referral' && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">نوع الوسيط *</label>
                                                <select
                                                    value={referralType}
                                                    onChange={(e) => setReferralType(e.target.value as ReferralType)}
                                                    className="w-full p-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:border-sky-500 focus:outline-none"
                                                >
                                                    <option value="Personal">شخصي (أنا)</option>
                                                    <option value="Employee"> موظف</option>
                                                    <option value="Client">زبون حالي </option>
                                                    <option value="Unknown">مجهول</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">طريقة التواصل *</label>
                                                <select
                                                    value={originChannel}
                                                    onChange={(e) => setOriginChannel(e.target.value as ReferralOriginChannel)}
                                                    disabled={referralType === 'Personal' || referralType === 'Unknown'}
                                                    className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                                                >
                                                    <option value="Acquaintance">معرفة شخصية</option>
                                                    <option value="PhoneCall">مكالمة هاتفية</option>
                                                    <option value="SocialMedia">سوشال ميديا</option>
                                                </select>
                                            </div>
                                        </div>

                                        {referralType === 'Employee' && (
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">الرقم الوظيفي *</label>
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="text"
                                                        value={employeeIdInput}
                                                        onChange={(e) => setEmployeeIdInput(e.target.value)}
                                                        onBlur={handleEmployeeBlur}
                                                        placeholder="أدخل رقم الموظف..."
                                                        className="w-1/2 p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none"
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
                                                    className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none"
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
                                                                    {client.contacts.find(con => con.isPrimary)?.number || client.contacts[0]?.number || '--'}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {(referralType === 'Personal' || referralType === 'Unknown') && (
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الوسيط *</label>
                                                <input
                                                    type="text"
                                                    value={referralNameSnapshot}
                                                    disabled
                                                    className="w-full p-2.5 rounded-xl border border-gray-200 bg-slate-50 text-slate-500 font-bold cursor-not-allowed text-sm focus:border-sky-500 focus:outline-none"
                                                />
                                            </div>
                                        )}
                                    </div>
                                )
                            }
                            {/* ============ ADDITIONAL TAB ============ */}
                            {
                                activeTab === 'additional' && (
                                    <div className="space-y-6">
                                        {isEditMode && (
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">تقييم الزبون</label>
                                            <select
                                                value={rating}
                                                onChange={e => setRating(e.target.value as ClientRating)}
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none bg-white"
                                            >
                                                <option value="Undefined">غير محدد</option>
                                                <option value="Committed">ملتزم</option>
                                                <option value="NotCommitted">غير ملتزم</option>
                                            </select>
                                        </div>
                                        )}
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">صحة البيانات</label>
                                            <select
                                                value={dataQuality}
                                                onChange={e => setDataQuality(e.target.value)}
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none bg-white"
                                            >
                                                <option value="">غير محدد</option>
                                                <option value="correct">✅ صحيحة</option>
                                                <option value="incorrect">❌ خاطئة</option>
                                                <option value="needs_edit">✏️ للتعديل</option>
                                            </select>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold text-slate-500">مهنة الزبون</label>
                                                <select
                                                    value={occupation}
                                                    onChange={e => setOccupation(e.target.value)}
                                                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none bg-white"
                                                >
                                                    <option value="">اختر المهنة</option>
                                                    {occupationOptions.map((option) => (
                                                        <option key={option} value={option}>{option}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold text-slate-500">مهنة الزوج / الزوجة</label>
                                                <select
                                                    value={spouseOccupation}
                                                    onChange={e => setSpouseOccupation(e.target.value)}
                                                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none bg-white"
                                                >
                                                    <option value="">اختر المهنة</option>
                                                    {occupationOptions.map((option) => (
                                                        <option key={option} value={option}>{option}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-slate-500">ملاحظات إضافية (محرر نصي)</label>
                                            <div className="quill-wrapper rounded-xl overflow-hidden border border-gray-200">
                                                <ReactQuill
                                                    theme="snow"
                                                    value={notes}
                                                    onChange={setNotes}
                                                    placeholder="اكتب ملاحظات مفصلة عن الزبون هنا..."
                                                    className="h-48"
                                                />
                                            </div>
                                            <style>{`
                                            .quill-wrapper .ql-toolbar { border:none; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
                                            .quill-wrapper .ql-container { border:none; font-family: inherit; font-size: 0.875rem; }
                                            .quill-wrapper .ql-editor { min-height: 150px; text-align: right; direction: rtl; }
                                            .quill-wrapper .ql-editor.ql-blank::before { left: auto; right: 15px; text-align: right; font-style: normal; font-family: inherit; }
                                        `}</style>
                                        </div>
                                    </div>
                                )
                            }

                        </div >

                        {/* Footer */}
                        <div className="bg-gray-50 p-4 border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
                            {primaryDup ? (
                                <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                    الرقم الأساسي مكرر — لا يمكن الحفظ
                                </div>
                            ) : <div />}
                            <div className="flex gap-3">
                                <button onClick={onClose} className="px-5 py-2 rounded-lg text-slate-600 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 font-medium transition-all">
                                    إلغاء
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={Boolean(primaryDup)}
                                    title={primaryDup ? `الرقم الأساسي مكرر عند: ${primaryDup.name}` : undefined}
                                    className="px-5 py-2 rounded-lg text-white bg-sky-600 hover:bg-sky-500 shadow-lg shadow-sky-500/20 font-bold transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                                >
                                    <Save className="w-4 h-4" />
                                    <span>{isEditMode ? 'حفظ التعديلات' : 'إضافة'}</span>
                                </button>
                            </div>
                        </div>
                    </motion.div >
                </>
            )}
        </AnimatePresence >
    );
}
