import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Phone, MapPin, Share2, Save, Plus, Trash2, MessageCircle, MapPinned, CheckCircle, AlertCircle, ClipboardList, Lock, ChevronDown } from 'lucide-react';
import type { Client, GeoUnit, ContactEntry, ContactType, ContactStatus, ReferralType, ReferralOriginChannel, ClientRating } from '../lib/types';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import MapPicker from './MapPicker';
import GeoSmartSearch from './GeoSmartSearch';
import type { GeoSelection } from './GeoSmartSearch';
import { useCandidateStore } from '../hooks/useCandidateStore';
import { api } from '../lib/api';
import { useAuthStore } from '../hooks/useAuthStore';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { findEmployeeByNumber, formatEmployeeMediatorLabel, MediatorEmployee, toMediatorEmployee } from '../lib/employeeMediatorLookup';
import {
    CONTACT_STATUS_CONFIG,
    CONTACT_TYPE_CONFIG,
    SYRIAN_MOBILE_HINT,
    getContactValidationMessage,
    isInvalidContactNumber,
    normalizeContactNumberInput,
} from '../lib/contactRules';

interface ClientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (client: Client) => void;
    initialData: Client | null;
    geoUnits: GeoUnit[];
    lockedPhone?: string;
    /** When true, all pre-filled fields from the candidate are locked — only empty fields can be filled */
    fromCandidate?: boolean;
}

type Tab = 'identity' | 'contact' | 'location' | 'referral' | 'contract' | 'additional';

interface BranchOption {
    id: number;
    name: string;
}

interface HrUserOption {
    id: number;
    name: string;
    branchId?: number | null;
    role_display_name?: string | null;
}

const tabsDef: { id: Tab; label: string; icon: any }[] = [
    { id: 'identity',    label: 'الهوية',         icon: User          },
    { id: 'contact',     label: 'التواصل',         icon: Phone         },
    { id: 'contract',    label: 'بيانات العقد',    icon: ClipboardList },
    { id: 'location',    label: 'العنوان',         icon: MapPin        },
    { id: 'referral',    label: 'الوسيط',          icon: Share2        },
    { id: 'additional',  label: 'معلومات إضافية',  icon: Plus          },
];

const contactTypeConfig = CONTACT_TYPE_CONFIG;
const contactStatusConfig = CONTACT_STATUS_CONFIG;

const makeId = () => Math.random().toString(36).slice(2, 10);

const emptyContact = (isPrimary = false): ContactEntry => ({
    id: makeId(), type: 'mobile', number: '', areaCode: '', label: '',
    hasWhatsApp: false, isPrimary, status: 'active',
});

const normalizeOriginChannel = (value?: string | null): ReferralOriginChannel => {
    if (value === 'PhoneCall' || value === 'SocialMedia' || value === 'Campaign' || value === 'Acquaintance') {
        return value;
    }
    if (value === 'App') return 'SocialMedia';
    return 'Acquaintance';
};

export default function ClientModal({ isOpen, onClose, onSave, initialData, geoUnits, lockedPhone, fromCandidate }: ClientModalProps) {
    const isEditMode = Boolean(initialData?.id);
    const [activeTab, setActiveTab] = useState<Tab>('identity');
    const [formData, setFormData] = useState<Partial<Client>>({});
    const authUser = useAuthStore(state => state.user);
    const getPermissionScope = useAuthStore(state => state.getPermissionScope);
    const { branchId: contextBranchId } = useBranchContextStore();
    const canChooseBranch = authUser?.isSuperAdmin === true;
    const editClientScope = getPermissionScope('clients.edit');
    const canChooseAssignedOwner =
        authUser?.isSuperAdmin === true ||
        editClientScope === 'GLOBAL' ||
        editClientScope === 'BRANCH';

    const candidates = useCandidateStore(state => state.candidates);
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [contracts, setContracts] = useState<Array<{ customerId: number }>>([]);
    const [employees, setEmployees] = useState<MediatorEmployee[]>([]);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [hrUsers, setHrUsers] = useState<HrUserOption[]>([]);
    const [occupationOptions, setOccupationOptions] = useState<string[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<number | ''>('');
    const [assignmentUserIds, setAssignmentUserIds] = useState<number[]>([]);
    const [assignDropdownOpen, setAssignDropdownOpen] = useState(false);
    const assignDropdownRef = useRef<HTMLDivElement>(null);

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
    const [originChannel, setOriginChannel] = useState<ReferralOriginChannel>('Acquaintance');
    const [referralNameSnapshot, setReferralNameSnapshot] = useState('');
    const [employeeIdInput, setEmployeeIdInput] = useState('');
    const [employeeFound, setEmployeeFound] = useState<MediatorEmployee | null>(null);
    const [employeeSearchError, setEmployeeSearchError] = useState('');
    const [clientSearch, setClientSearch] = useState('');
    const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
    const [gender, setGender] = useState<'male' | 'female' | ''>('');
    const [nationalId, setNationalId] = useState('');
    const [birthDate, setBirthDate] = useState('');
    const [motherName, setMotherName] = useState('');
    const [nationalIdRegistry, setNationalIdRegistry] = useState('');
    const [nationalIdIssuedBy, setNationalIdIssuedBy] = useState('');
    const [nationalIdIssueDate, setNationalIdIssueDate] = useState('');
    const [nationalIdBox, setNationalIdBox] = useState('');
    const [referralNotes, setReferralNotes] = useState('');
    const [occupation, setOccupation] = useState('');
    const [spouseOccupation, setSpouseOccupation] = useState('');
    const [waterSource, setWaterSource] = useState('');
    const [dataQuality, setDataQuality] = useState<string>('');
    const [notes, setNotes] = useState('');
    const [rating, setRating] = useState<ClientRating>('Undefined');
    const clientSearchRef = useRef<HTMLDivElement>(null);
    const currentUserDisplayName = authUser?.name?.trim() || '';

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (clientSearchRef.current && !clientSearchRef.current.contains(event.target as Node)) {
                setClientSuggestions([]);
            }
            if (assignDropdownRef.current && !assignDropdownRef.current.contains(event.target as Node)) {
                setAssignDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        let active = true;

        const fetchLookupData = async () => {
            // X3.4: Use allSettled so a permission failure on one lookup (e.g.
            // contracts.view_list for a supervisor) does NOT blank out the clients
            // list that powers the mediator/وسيط field.  Each fetch is independent.
            const [
                clientsRes,
                employeesRes,
                contractsRes,
                occupationRes,
                branchesRes,
                hrUsersRes,
            ] = await Promise.allSettled([
                api.clients.list(),
                api.employees.list(),
                api.contracts.list(),
                api.systemLists.list({ category: 'occupation', activeOnly: true }),
                canChooseBranch ? api.branches.list() : Promise.resolve([]),
                canChooseAssignedOwner ? api.admin.hrUsers.assignable() : Promise.resolve([]),
            ]);

            if (!active) return;

            // clients: authorized by GET /clients (GLOBAL / BRANCH / ASSIGNED)
            setAllClients(clientsRes.status === 'fulfilled' ? clientsRes.value : []);

            setEmployees(
                employeesRes.status === 'fulfilled'
                    ? employeesRes.value.map(toMediatorEmployee)
                    : [],
            );
            setContracts(contractsRes.status === 'fulfilled' ? contractsRes.value : []);
            setOccupationOptions(
                occupationRes.status === 'fulfilled'
                    ? occupationRes.value.map((item: any) => item.value)
                    : [],
            );
            setBranches(
                branchesRes.status === 'fulfilled'
                    ? branchesRes.value.map((b: any) => ({ id: b.id, name: b.name }))
                    : [],
            );
            setHrUsers(
                hrUsersRes.status === 'fulfilled'
                    ? hrUsersRes.value.map((u: any) => ({
                          id: u.id,
                          name: u.name,
                          branchId: u.branch_id ?? u.branchId ?? null,
                          role_display_name: u.role_display_name ?? null,
                      }))
                    : [],
            );
        };

        fetchLookupData();

        return () => {
            active = false;
        };
    }, [isOpen, canChooseAssignedOwner, canChooseBranch]);

    useEffect(() => {
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
        } else if (referralType === 'Employee' && employeeFound) {
            setReferralNameSnapshot(employeeFound.name);
        } else if (referralType === 'Client' && selectedClientId) {
            // Already handled in select client
        }
    }, [referralType, employeeFound, selectedClientId, currentUserDisplayName]);

    const handleEmployeeBlur = () => {
        if (!employeeIdInput.trim()) {
            setEmployeeFound(null);
            setEmployeeSearchError('');
            return;
        }
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
    };

    const getClientLifecycleStage = useCallback((client: Client) => {
        const serverStage = (client as any).lifecycleStage;
        if (serverStage === 'OP' || serverStage === 'FOP') return serverStage;
        if (contracts.some(contract => contract.customerId === client.id)) return 'OP';
        return 'Lead';
    }, [contracts]);

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
                setSelectedBranchId(initialData.branchId ?? '');
                setAssignmentUserIds((initialData.assignments || []).map(a => a.userId));
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
                setOriginChannel(normalizeOriginChannel(initialData.sourceChannel as string | undefined));
                setReferralNameSnapshot(initialData.referrerName || '');
                setClientSearch(initialData.referrerType === 'Client' ? (initialData.referrerName || '') : '');
                setSelectedClientId(initialData.referrerType === 'Client' ? (initialData.referralEntityId || null) : null);
                setGender((initialData.gender as any) || '');
                setNationalId(initialData.nationalId || '');
                setBirthDate(initialData.birthDate ? initialData.birthDate.slice(0, 10) : '');
                setMotherName(initialData.motherName || '');
                setNationalIdRegistry(initialData.nationalIdRegistry || '');
                setNationalIdIssuedBy(initialData.nationalIdIssuedBy || '');
                setNationalIdIssueDate(initialData.nationalIdIssueDate ? initialData.nationalIdIssueDate.slice(0, 10) : '');
                setNationalIdBox(initialData.nationalIdBox || '');
                setReferralNotes(initialData.referralNotes || '');
                setOccupation(initialData.occupation || '');
                setSpouseOccupation(initialData.spouseOccupation || '');
                setWaterSource(initialData.waterSource || '');
                setDataQuality(initialData.dataQuality || '');
                setNotes(initialData.notes || '');
                setRating(initialData.rating || 'Undefined');
            } else {
                setFormData({
                    sourceChannel: 'Acquaintance',
                    referrerType: 'Other',
                    governorate: '1',
                    branchId: canChooseBranch ? (contextBranchId ?? undefined) : undefined,
                });
                setSelectedBranchId(canChooseBranch ? (contextBranchId ?? '') : '');
                setAssignmentUserIds([]);
                setFirstName(''); setNickname(''); setLastName(''); setFatherName('');
                setContacts(lockedPhone
                    ? [{ ...emptyContact(true), number: lockedPhone, type: 'mobile' }]
                    : [emptyContact(true)]);
                setMapPosition(null);
                setReferralType('Personal');
                setOriginChannel('Acquaintance');
                setReferralNameSnapshot(currentUserDisplayName);
                setGender('');
                setNationalId('');
                setBirthDate('');
                setReferralNotes('');
                setOccupation('');
                setSpouseOccupation('');
                setWaterSource('');
                setDataQuality('');
                setNotes('');
                setRating('Undefined');
                setEmployeeIdInput('');
                setClientSearch('');
                setSelectedClientId(null);
            }
            setActiveTab('identity');
            // Reconstruct geoSelection from any stored level. Candidates may carry only governorate/region.
            const storedNeighId = initialData?.neighborhood?.toString() || '';
            const storedUnit = storedNeighId ? geoUnits.find(u => u.id.toString() === storedNeighId) : null;
            const path: GeoUnit[] = [];
            let cursor = storedUnit;
            while (cursor) {
                path.unshift(cursor);
                cursor = cursor.parentId != null ? geoUnits.find(u => u.id === cursor!.parentId) || null : null;
            }
            setGeoSelection({
                govId: path[0]?.id?.toString() || initialData?.governorate?.toString() || '',
                regionId: path[1]?.id?.toString() || '',
                subId: path[2]?.id?.toString() || '',
                neighborhoodId: path[3]?.id?.toString() || '',
            });
        }
    }, [isOpen, initialData, geoUnits, canChooseBranch, contextBranchId, currentUserDisplayName]);

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
        // Store the deepest selected level: حي (level 4) if available, otherwise ناحية (level 3)
        updateForm('neighborhood', sel.neighborhoodId || sel.subId || '');
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

    const assignableHrUsers = useMemo(() => {
        if (!canChooseAssignedOwner) return [];
        if (selectedBranchId === '') return hrUsers;
        return hrUsers.filter(user => user.branchId == null || user.branchId === Number(selectedBranchId));
    }, [canChooseAssignedOwner, hrUsers, selectedBranchId]);

    // -- fromCandidate locking helpers --
    // effectiveLockedPhone: either explicit lockedPhone prop OR the candidate's mobile when fromCandidate
    const effectiveLockedPhone = useMemo(() => {
        if (lockedPhone) return lockedPhone;
        if (!fromCandidate || !initialData) return '';
        return initialData.contacts?.find(c => c.isPrimary)?.number
            || initialData.contacts?.[0]?.number
            || initialData.mobile
            || '';
    }, [lockedPhone, fromCandidate, initialData]);

    // fl = "field locked": returns true when fromCandidate and the value is non-empty (came from candidate)
    const fl = (val: string | undefined | null): boolean =>
        Boolean(fromCandidate && val !== '' && val !== null && val !== undefined);
    const firstNameLocked = fl(initialData?.firstName);
    const lastNameLocked = fl(initialData?.lastName);
    const nicknameLocked = fl(initialData?.nickname);
    const detailedAddressLocked = fl(initialData?.detailedAddress);
    const occupationLocked = fl(initialData?.occupation);

    const candidateGeoNeedsUpgrade = Boolean(fromCandidate && (geoSelection.govId || geoSelection.regionId) && !(geoSelection.subId || geoSelection.neighborhoodId));

    // Locked field style (amber = from candidate, distinct from emerald = verified phone)
    const lockedCls = 'bg-amber-50/40 border-amber-200 text-amber-800 cursor-not-allowed focus:ring-0';

    // -- Save --
    const handleSave = () => {
        if (canChooseBranch && !selectedBranchId) {
            alert('يجب تحديد الفرع قبل حفظ العميل');
            return;
        }

        if (!firstName.trim()) {
            alert('الاسم الأول إلزامي');
            return;
        }

        if (!lastName.trim()) {
            alert('الكنية (العائلة) إلزامية');
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

        const invalidContact = contacts.find(contact => getContactValidationMessage(contact));
        if (invalidContact) {
            alert(getContactValidationMessage(invalidContact)!);
            return;
        }

        // Geo validation: skip when fromCandidate (geo is locked from candidate data)
        if ((!fromCandidate || candidateGeoNeedsUpgrade) && !(geoSelection.subId || geoSelection.neighborhoodId)) {
            alert('يجب اختيار ناحية على الأقل في العنوان — لا يمكن الاكتفاء بمحافظة أو منطقة');
            return;
        }

        // Referral validation: skip when fromCandidate (all referral data locked from candidate)
        if (!fromCandidate && referralType === 'Employee' && !employeeFound) {
            alert('يجب تحديد الموظف الوسيط');
            return;
        }

        if (!fromCandidate && referralType === 'Client' && !selectedClientId) {
            alert('يجب تحديد الزبون الوسيط');
            return;
        }

        const resolvedReferrerName = referralType === 'Personal'
            ? currentUserDisplayName
            : referralType === 'Unknown'
                ? 'مجهول'
                : referralType === 'Employee'
                    ? (employeeFound?.name || '')
                    : referralType === 'Client'
                        ? (clientSearch.trim() || referralNameSnapshot.trim())
                        : referralNameSnapshot.trim();
        const resolvedReferralEntityId = referralType === 'Client'
            ? selectedClientId || undefined
            : referralType === 'Employee'
                ? employeeFound?.id || undefined
                : undefined;

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
            referrerName: resolvedReferrerName || undefined,
            referralEntityId: resolvedReferralEntityId,
            gender: (gender as any) || undefined,
            nationalId: nationalId.trim() || undefined,
            birthDate: birthDate || undefined,
            motherName: motherName.trim() || undefined,
            nationalIdRegistry: nationalIdRegistry.trim() || undefined,
            nationalIdIssuedBy: nationalIdIssuedBy.trim() || undefined,
            nationalIdIssueDate: nationalIdIssueDate || undefined,
            nationalIdBox: nationalIdBox.trim() || undefined,
            referralNotes: referralNotes.trim() || undefined,
            occupation: occupation.trim() || undefined,
            spouseOccupation: spouseOccupation.trim() || undefined,
            waterSource: waterSource.trim() || undefined,
            dataQuality: (dataQuality as any) || undefined,
            notes: notes.trim() || undefined,
            branchId: selectedBranchId === '' ? undefined : Number(selectedBranchId),
            assignmentUserIds: canChooseAssignedOwner && assignmentUserIds.length > 0 ? assignmentUserIds : undefined,
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
                        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[860px] max-h-[96vh] bg-white rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col"
                        style={{ direction: 'rtl' }}
                    >
                        {/* Header */}
                        <div className="bg-white border-b border-gray-100 px-4 sm:px-5 py-4 flex items-center justify-between shrink-0">
                            <h2 className="text-lg sm:text-xl font-bold text-slate-800">
                                {isEditMode ? 'تعديل بيانات الزبون' : 'إضافة زبون جديد'}
                            </h2>
                            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* From-candidate banner */}
                        {fromCandidate && (
                            <div className="bg-amber-50 border-b border-amber-100 px-5 py-2.5 flex items-center gap-2 text-xs font-semibold text-amber-700 shrink-0">
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                البيانات المنقولة من الاسم المقترح محمية ومقيّدة — استكمل المعلومات الناقصة فقط
                            </div>
                        )}

                        {/* Tabs */}
                        <div className="bg-gray-50 px-2 sm:px-4 pt-3 border-b border-gray-200 flex gap-1 overflow-x-auto shrink-0 scrollbar-none">
                            {tabsDef.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-1.5 px-2.5 sm:px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-lg transition-all relative top-[1px] whitespace-nowrap shrink-0 ${activeTab === tab.id
                                        ? 'bg-white text-sky-600 border border-gray-200 border-b-white z-10 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-gray-100'
                                        }`}
                                >
                                    <tab.icon className="w-4 h-4 shrink-0" />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="p-4 sm:p-6 flex-1 overflow-y-auto custom-scroll bg-white">

                            {/* ============ IDENTITY TAB ============ */}
                            {activeTab === 'identity' && (
                                <div className="space-y-4">
                                    {(canChooseBranch || canChooseAssignedOwner) && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                            {canChooseBranch && (
                                                <div className="space-y-1">
                                                    <label className="text-xs font-semibold text-slate-500">
                                                        الفرع التشغيلي <span className="text-red-500">*</span>
                                                    </label>
                                                    <select
                                                        value={selectedBranchId}
                                                        onChange={e => setSelectedBranchId(e.target.value ? Number(e.target.value) : '')}
                                                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none bg-white"
                                                    >
                                                        <option value="">اختر الفرع</option>
                                                        {branches.map(branch => (
                                                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                                                        ))}
                                                    </select>
                                                    <p className="text-[11px] text-slate-400">
                                                        هذا هو الفرع التشغيلي للعميل، وليس فلتر عرض فقط.
                                                    </p>
                                                </div>
                                            )}

                                            {canChooseAssignedOwner && (
                                                <div className="space-y-1.5" ref={assignDropdownRef}>
                                                    <label className="text-xs font-semibold text-slate-500">المسؤولون عن العميل</label>

                                                    {/* Trigger button */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setAssignDropdownOpen(prev => !prev)}
                                                        className="w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white hover:border-sky-400 focus:outline-none focus:border-sky-500 transition-colors"
                                                    >
                                                        <span className={assignmentUserIds.length === 0 ? 'text-slate-400' : 'text-slate-700 font-medium'}>
                                                            {assignmentUserIds.length === 0
                                                                ? 'اختر المسؤولين...'
                                                                : `${assignmentUserIds.length} مسؤول مختار`}
                                                        </span>
                                                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${assignDropdownOpen ? 'rotate-180' : ''}`} />
                                                    </button>

                                                    {/* Dropdown list */}
                                                    {assignDropdownOpen && (
                                                        <div className="w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto divide-y divide-slate-50">
                                                            {assignableHrUsers.length === 0 ? (
                                                                <p className="px-3 py-4 text-xs text-slate-400 text-center">لا يوجد مستخدمون مؤهلون للإسناد في هذا الفرع</p>
                                                            ) : (
                                                                assignableHrUsers.map(user => {
                                                                    const checked = assignmentUserIds.includes(user.id);
                                                                    return (
                                                                        <label key={user.id} className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors select-none">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={checked}
                                                                                onChange={e => {
                                                                                    if (e.target.checked) {
                                                                                        setAssignmentUserIds(prev => [...prev, user.id]);
                                                                                    } else {
                                                                                        setAssignmentUserIds(prev => prev.filter(id => id !== user.id));
                                                                                    }
                                                                                }}
                                                                                className="w-4 h-4 rounded accent-sky-500 shrink-0"
                                                                            />
                                                                            <div>
                                                                                <div className="text-sm text-slate-700 font-medium">{user.name}</div>
                                                                                {user.role_display_name && (
                                                                                    <div className="text-[10px] text-slate-400">{user.role_display_name}</div>
                                                                                )}
                                                                            </div>
                                                                        </label>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Selected chips */}
                                                    {assignmentUserIds.length > 0 && (
                                                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                                                            {assignmentUserIds.map(uid => {
                                                                const user = assignableHrUsers.find(u => u.id === uid);
                                                                if (!user) return null;
                                                                return (
                                                                    <span key={uid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-xs font-bold border border-sky-200">
                                                                        {user.name}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setAssignmentUserIds(prev => prev.filter(id => id !== uid))}
                                                                            className="hover:text-sky-900 ml-0.5"
                                                                        >
                                                                            <X className="w-2.5 h-2.5" />
                                                                        </button>
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    )}

                                                    <p className="text-[11px] text-slate-400">
                                                        القائمة تعرض فقط الأدوار المصرح لها بالإسناد (clients.can_be_assigned).
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                                الاسم الأول <span className="text-red-500">*</span>
                                                {firstNameLocked && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                            </label>
                                            <input
                                                value={firstName}
                                                onChange={e => !firstNameLocked && setFirstName(e.target.value)}
                                                readOnly={firstNameLocked}
                                                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none ${firstNameLocked ? lockedCls : 'border-gray-200 focus:border-sky-500'}`}
                                                placeholder="مثال: أحمد"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">اسم الأب</label>
                                            <input value={fatherName} onChange={e => setFatherName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" placeholder="مثال: خالد" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                                الكنية (العائلة) <span className="text-red-500">*</span>
                                                {lastNameLocked && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                            </label>
                                            <input
                                                value={lastName}
                                                onChange={e => !lastNameLocked && setLastName(e.target.value)}
                                                readOnly={lastNameLocked}
                                                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none ${lastNameLocked ? lockedCls : 'border-gray-200 focus:border-sky-500'}`}
                                                placeholder="مثال: زيتون"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                                اللقب
                                                {nicknameLocked && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                            </label>
                                            <input
                                                value={nickname}
                                                onChange={e => !nicknameLocked && setNickname(e.target.value)}
                                                readOnly={nicknameLocked}
                                                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none ${nicknameLocked ? lockedCls : 'border-gray-200 focus:border-sky-500'}`}
                                                placeholder="مثال: أبو أيوب"
                                            />
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
                                            // Locked = verified phone (smart search) OR candidate phone
                                            const isLocked = Boolean(effectiveLockedPhone && c.number === effectiveLockedPhone && c.isPrimary);
                                            const lockSource = lockedPhone ? 'smart' : 'candidate'; // to differentiate badge text
                                            const hasInvalidNumber = isInvalidContactNumber(c) || c.status === 'invalid';

                                            return (
                                            <motion.div
                                                key={c.id}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className={`rounded-xl p-3 border space-y-2.5 ${
                                                    isLocked
                                                        ? lockSource === 'smart' ? 'bg-emerald-50/40 border-emerald-200' : 'bg-amber-50/40 border-amber-200'
                                                        : hasInvalidNumber
                                                        ? 'bg-red-50/40 border-red-200'
                                                        : c.isPrimary && dup
                                                        ? 'bg-red-50/40 border-red-300'
                                                        : dup
                                                        ? 'bg-amber-50/30 border-amber-200'
                                                        : 'bg-gray-50 border-gray-100'
                                                }`}
                                            >
                                                {/* Locked badge */}
                                                {isLocked && (
                                                    <div className={`flex items-center gap-1.5 text-[10px] font-bold rounded-lg px-2.5 py-1 w-fit border ${
                                                        lockSource === 'smart'
                                                            ? 'text-emerald-700 bg-emerald-100 border-emerald-200'
                                                            : 'text-amber-700 bg-amber-100 border-amber-200'
                                                    }`}>
                                                        <Lock className="w-3 h-3 shrink-0" />
                                                        {lockSource === 'smart'
                                                            ? 'رقم محقق من التحقق الذكي — لا يمكن تعديله'
                                                            : 'رقم منقول من الاسم المقترح — لا يمكن تعديله'}
                                                    </div>
                                                )}

                                                {/* Row 1: Type + Number + Duplicate badge + Remove */}
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={c.type}
                                                        onChange={e => !isLocked && updateContact(c.id, 'type', e.target.value as ContactType)}
                                                        disabled={isLocked}
                                                        className={`border rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none min-w-[100px] ${
                                                            isLocked
                                                                ? lockSource === 'smart' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 cursor-not-allowed' : 'bg-amber-50/40 border-amber-200 text-amber-700 cursor-not-allowed'
                                                                : 'bg-white border-gray-200'
                                                        }`}
                                                    >
                                                        {Object.entries(contactTypeConfig).map(([key, cfg]) => (
                                                            <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                                                        ))}
                                                    </select>

                                                    {c.type === 'mobile' && (
                                                        <span className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 select-none shrink-0" dir="ltr">+963</span>
                                                    )}

                                                    {c.type === 'landline' && !isLocked && (
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
                                                        readOnly={isLocked}
                                                        onChange={e => {
                                                            if (isLocked) return;
                                                            let v = e.target.value.replace(/\D/g, '');
                                                            v = normalizeContactNumberInput(c.type, c.status, v, c.number);
                                                            updateContact(c.id, 'number', v);
                                                        }}
                                                        placeholder={c.type === 'mobile' ? SYRIAN_MOBILE_HINT : c.type === 'landline' ? 'XXXXXXX' : 'الرقم...'}
                                                        dir="ltr"
                                                        maxLength={c.type === 'mobile' ? 10 : c.type === 'landline' ? 7 : 15}
                                                        className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono text-slate-800 placeholder:text-gray-300 focus:outline-none ${
                                                            isLocked
                                                                ? lockSource === 'smart'
                                                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 cursor-default focus:ring-0'
                                                                    : 'bg-amber-50/40 border-amber-200 text-amber-800 cursor-not-allowed focus:ring-0'
                                                                : hasInvalidNumber
                                                                ? 'bg-white border-red-300 text-red-700 focus:border-red-400'
                                                                : dup
                                                                ? 'bg-white border-amber-300 focus:border-amber-400'
                                                                : 'bg-white border-gray-200 focus:border-sky-500'
                                                        }`}
                                                    />

                                                    <button
                                                        type="button"
                                                        onClick={() => !isLocked && removeContact(c.id)}
                                                        disabled={isLocked}
                                                        title={isLocked ? 'لا يمكن حذف الرقم المحقق' : 'حذف الرقم'}
                                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${
                                                            isLocked
                                                                ? 'text-gray-200 border-transparent cursor-not-allowed'
                                                                : 'text-gray-300 hover:text-red-500 hover:bg-red-50 border-transparent hover:border-red-100'
                                                        }`}
                                                    >
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

                                                {hasInvalidNumber && (
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border w-fit bg-red-100 text-red-700 border-red-200">
                                                        <AlertCircle className="w-3 h-3 shrink-0" />
                                                        رقم موبايل غير مطابق للصيغة 09XXXXXXXX
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
                                                        className={`border rounded-lg px-2 py-1.5 text-[11px] font-medium focus:outline-none min-w-[110px] ${contactStatusConfig[c.status]?.style || contactStatusConfig.active.style}`}
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
                                                            if (isDupPrimary || isLocked || Boolean(effectiveLockedPhone && !isLocked)) return;
                                                            setPrimary(c.id);
                                                        }}
                                                        disabled={isDupPrimary || Boolean(effectiveLockedPhone && !isLocked)}
                                                        title={
                                                            isLocked ? 'الرقم الأساسي محقق ومحمي' :
                                                            effectiveLockedPhone && !isLocked ? 'لا يمكن تغيير الرقم الأساسي المحمي' :
                                                            isDupPrimary ? 'لا يمكن تعيين رقم مكرر كرقم أساسي' :
                                                            'تعيين كرقم أساسي'
                                                        }
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
                                        placeholder="ابحث عن ناحية أو حي..."
                                        disabled={fl(initialData?.neighborhood) && !candidateGeoNeedsUpgrade}
                                        minSelectableLevel={3}
                                        invalid={candidateGeoNeedsUpgrade}
                                    />
                                    {fl(initialData?.neighborhood) && !candidateGeoNeedsUpgrade && (
                                        <p className="text-[11px] text-amber-600 font-medium flex items-center gap-1.5 -mt-2">
                                            <Lock className="w-3.5 h-3.5 shrink-0" />
                                            العنوان منقول من الاسم المقترح — لا يمكن تعديله
                                        </p>
                                    )}
                                    {!fl(initialData?.neighborhood) && !(geoSelection.subId || geoSelection.neighborhoodId) && (
                                        <p className="text-[11px] text-amber-600 font-medium flex items-center gap-1.5 -mt-2">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                            يجب اختيار ناحية على الأقل — لا يمكن الاكتفاء بمحافظة أو منطقة
                                        </p>
                                    )}
                                    {candidateGeoNeedsUpgrade && (
                                        <p className="text-[11px] text-red-600 font-medium flex items-center gap-1.5 -mt-2">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                            عنوان الاسم المقترح غير كاف لإنشاء زبون — يجب تحديد ناحية على الأقل.
                                        </p>
                                    )}
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                            العنوان التفصيلي
                                            {detailedAddressLocked && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                        </label>
                                        <textarea
                                            value={formData.detailedAddress || ''}
                                            onChange={e => !detailedAddressLocked && updateForm('detailedAddress', e.target.value)}
                                            readOnly={detailedAddressLocked}
                                            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none min-h-[60px] resize-none ${detailedAddressLocked ? lockedCls : 'border-gray-200 focus:border-sky-500'}`}
                                        />
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
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                                                    نوع الوسيط *
                                                    {fromCandidate && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                                </label>
                                                <select
                                                    value={referralType}
                                                    onChange={(e) => !fromCandidate && setReferralType(e.target.value as ReferralType)}
                                                    disabled={fromCandidate}
                                                    className={`w-full p-2.5 rounded-xl border text-sm focus:outline-none ${fromCandidate ? 'bg-amber-50/40 border-amber-200 text-amber-800 cursor-not-allowed' : 'border-gray-200 bg-gray-50 focus:border-sky-500'}`}
                                                >
                                                    <option value="Personal">شخصي</option>
                                                    <option value="Employee">موظف</option>
                                                    <option value="Client">زبون</option>
                                                    <option value="Unknown">مجهول</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                                                    طريقة التواصل *
                                                    {fromCandidate && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                                </label>
                                                <select
                                                    value={originChannel}
                                                    onChange={(e) => !fromCandidate && setOriginChannel(e.target.value as ReferralOriginChannel)}
                                                    disabled={fromCandidate}
                                                    className={`w-full p-2.5 rounded-xl border text-sm focus:outline-none ${fromCandidate ? 'bg-amber-50/40 border-amber-200 text-amber-800 cursor-not-allowed' : 'border-gray-200 bg-white focus:border-sky-500'}`}
                                                >
                                                    <option value="Acquaintance">معرفة شخصية</option>
                                                    <option value="PhoneCall">مكالمة هاتفية</option>
                                                    <option value="SocialMedia">سوشال ميديا</option>
                                                    <option value="Campaign">حملة إعلانية</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Referrer name — locked display when fromCandidate */}
                                        {fromCandidate ? (
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                                                    اسم الوسيط *
                                                    <Lock className="w-2.5 h-2.5 text-amber-500" />
                                                </label>
                                                <input
                                                    type="text"
                                                    value={referralNameSnapshot}
                                                    readOnly
                                                    className={`w-full p-2.5 rounded-xl border text-sm font-bold ${lockedCls}`}
                                                />
                                            </div>
                                        ) : (
                                            <>
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
                                                            <button
                                                                type="button"
                                                                onClick={handleEmployeeBlur}
                                                                className="px-3 py-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-bold hover:bg-sky-100"
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
                                                        {allClients.filter(c => !c.isCandidate).length === 0 ? (
                                                            <p className="text-xs text-slate-400 italic py-2 px-1">
                                                                لا يوجد زبائن متاحون كوسيط ضمن صلاحياتك.
                                                            </p>
                                                        ) : (
                                                            <>
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
                                                            </>
                                                        )}
                                                    </div>
                                                )}

                                                {(referralType === 'Personal' || referralType === 'Unknown') && (
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الوسيط *</label>
                                                        <input
                                                            type="text"
                                                            value={referralNameSnapshot}
                                                            readOnly
                                                            className="w-full p-2.5 rounded-xl border border-gray-200 bg-slate-50 text-slate-600 font-bold cursor-not-allowed text-sm focus:border-sky-500 focus:outline-none"
                                                        />
                                                        {referralType === 'Personal' && (
                                                            <p className="mt-1 text-[11px] text-slate-400">
                                                                يتم اعتماد اسم المستخدم الحالي تلقائياً عند اختيار وسيط شخصي.
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {/* ملاحظات الوسيط — always editable */}
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">ملاحظات الوسيط</label>
                                            <textarea
                                                value={referralNotes}
                                                onChange={e => setReferralNotes(e.target.value)}
                                                placeholder="أي ملاحظات تخص الوسيط أو طريقة التواصل..."
                                                rows={3}
                                                className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none resize-none"
                                            />
                                        </div>
                                    </div>
                                )
                            }

                            {/* ============ CONTRACT TAB ============ */}
                            {activeTab === 'contract' && (
                                <div className="space-y-5">
                                    {/* Gender */}
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-slate-500">الجنس</label>
                                        <div className="flex gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setGender(gender === 'male' ? '' : 'male')}
                                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all ${gender === 'male' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-gray-200 text-slate-500 hover:border-sky-200 hover:text-sky-600'}`}
                                            >
                                                <svg width="18" height="18" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                                                    <circle cx="32" cy="20" r="12" fill="currentColor" opacity="0.9" />
                                                    <path d="M14 56c0-9.941 8.059-18 18-18s18 8.059 18 18H14z" fill="currentColor" opacity="0.75" />
                                                </svg>
                                                ذكر
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setGender(gender === 'female' ? '' : 'female')}
                                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all ${gender === 'female' ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-gray-200 text-slate-500 hover:border-rose-200 hover:text-rose-600'}`}
                                            >
                                                <svg width="18" height="18" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                                                    <ellipse cx="32" cy="21" rx="16" ry="14" fill="currentColor" opacity="0.5" />
                                                    <ellipse cx="32" cy="22" rx="10" ry="11" fill="white" opacity="0.85" />
                                                    <path d="M16 28 Q16 40 32 40 Q48 40 48 28 Q44 36 32 36 Q20 36 16 28z" fill="currentColor" opacity="0.5" />
                                                    <path d="M12 56c0-11 9-20 20-20s20 9 20 20H12z" fill="currentColor" opacity="0.7" />
                                                </svg>
                                                أنثى
                                            </button>
                                        </div>
                                    </div>

                                    {/* Mother Name + Birth Date */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">اسم الأم</label>
                                            <input type="text" value={motherName} onChange={e => setMotherName(e.target.value)}
                                                placeholder="اسم الأم"
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">تاريخ الميلاد</label>
                                            <input
                                                type="date"
                                                value={birthDate}
                                                onChange={e => setBirthDate(e.target.value)}
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    {/* National ID */}
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold text-slate-500">رقم الهوية الوطنية</label>
                                        <input
                                            type="text"
                                            value={nationalId}
                                            onChange={e => {
                                                const v = e.target.value.replace(/\D/g, '').slice(0, 12);
                                                setNationalId(v);
                                            }}
                                            placeholder="000000000000"
                                            dir="ltr"
                                            maxLength={12}
                                            className={`w-full border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none transition-colors ${
                                                nationalId.length > 0 && nationalId.length < 12
                                                    ? 'border-amber-300 focus:border-amber-400 bg-amber-50/30'
                                                    : nationalId.length === 12
                                                    ? 'border-emerald-300 focus:border-emerald-400 bg-emerald-50/20'
                                                    : 'border-gray-200 focus:border-sky-500'
                                            }`}
                                        />
                                        {nationalId.length > 0 && nationalId.length < 12 && (
                                            <p className="text-[10px] text-amber-600 font-medium">
                                                {12 - nationalId.length} خانة متبقية
                                            </p>
                                        )}
                                        {nationalId.length === 12 && (
                                            <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                                                <CheckCircle className="w-3 h-3" /> مكتمل
                                            </p>
                                        )}
                                    </div>

                                    {/* Registry + Box */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">القيد</label>
                                            <input type="text" value={nationalIdRegistry} onChange={e => setNationalIdRegistry(e.target.value)}
                                                placeholder="رقم القيد"
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">الخانة</label>
                                            <input type="text" value={nationalIdBox} onChange={e => setNationalIdBox(e.target.value)}
                                                placeholder="رقم أو اسم الخانة"
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" />
                                        </div>
                                    </div>

                                    {/* Issued By + Issue Date */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">أمانة السجل المدني</label>
                                            <input type="text" value={nationalIdIssuedBy} onChange={e => setNationalIdIssuedBy(e.target.value)}
                                                placeholder="أمين السجل المدني"
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">تاريخ منح الهوية</label>
                                            <input type="date" value={nationalIdIssueDate} onChange={e => setNationalIdIssueDate(e.target.value)}
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none" />
                                        </div>
                                    </div>
                                </div>
                            )}

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

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                                                    مهنة الزبون
                                                    {occupationLocked && <Lock className="w-2.5 h-2.5 text-amber-500" />}
                                                </label>
                                                <select
                                                    value={occupation}
                                                    onChange={e => !occupationLocked && setOccupation(e.target.value)}
                                                    disabled={occupationLocked}
                                                    className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none ${occupationLocked ? 'bg-amber-50/40 border-amber-200 text-amber-800 cursor-not-allowed' : 'bg-white border-gray-200 focus:border-sky-500'}`}
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
                                        <div className="space-y-1">
                                            <label className="text-xs font-semibold text-slate-500">مصدر المياه</label>
                                            <input
                                                type="text"
                                                value={waterSource}
                                                onChange={e => setWaterSource(e.target.value)}
                                                placeholder="مثال: شبكة عامة، بئر، صهريج..."
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none bg-white"
                                            />
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
                        <div className="bg-gray-50 px-4 sm:px-5 py-3 sm:py-4 border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
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
