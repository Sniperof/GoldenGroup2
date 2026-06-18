import React, { useState, useEffect, useRef } from 'react';
import { X, Save, PlusCircle, Building2, User, Handshake, Search, CheckCircle, AlertCircle } from 'lucide-react';
import { ReferralType, ReferralOriginChannel, Client } from '../../lib/types';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import { api } from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import { findEmployeeByNumber, formatEmployeeMediatorLabel, MediatorEmployee, toMediatorEmployee } from '../../lib/employeeMediatorLookup';
import Select from '../ui/Select';
import Input from '../ui/Input';
import IconButton from '../ui/IconButton';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSheetCreated?: (sheetId: number) => void;
}

interface BranchOption {
    id: number;
    name: string;
}

interface HrUserOption {
    id: number;
    name: string;
    branchId?: number | null;
    roleDisplayName?: string | null;
}

const referralTypes: { value: ReferralType; label: string; icon: any }[] = [
    { value: 'Personal', label: 'شخصي', icon: User },
    { value: 'Client', label: 'زبون', icon: Handshake },
    { value: 'Employee', label: 'موظف', icon: Building2 },
    { value: 'Unknown', label: 'مجهول', icon: Search }
];

const channels: { value: ReferralOriginChannel; label: string }[] = [
    { value: 'Acquaintance', label: 'معرفة شخصية' },
    { value: 'PhoneCall', label: 'مكالمة هاتفية' },
    { value: 'SocialMedia', label: 'سوشال ميديا' },
    { value: 'Campaign', label: 'حملة إعلانية' },
];

export default function CreateReferralSheetModal({ isOpen, onClose, onSheetCreated }: Props) {
    const addReferralSheet = useCandidateStore(state => state.addReferralSheet); // Updated hook
    const authUser = useAuthStore(state => state.user);
    const getPermissionScope = useAuthStore(state => state.getPermissionScope);
    const { branchId: contextBranchId } = useBranchContextStore();
    const currentUserDisplayName = authUser?.name?.trim() || '';
    const canChooseBranch = authUser?.isSuperAdmin === true;
    const editNameListScope = getPermissionScope('candidates.name_lists.edit');
    const canChooseAssignedOwner =
        authUser?.isSuperAdmin === true ||
        editNameListScope === 'GLOBAL' ||
        editNameListScope === 'BRANCH';

    const [allClients, setAllClients] = useState<Client[]>([]);
    const [employees, setEmployees] = useState<MediatorEmployee[]>([]);
    const [contracts, setContracts] = useState<Array<{ customerId: number }>>([]);
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [hrUsers, setHrUsers] = useState<HrUserOption[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<number | ''>(contextBranchId ?? authUser?.branchId ?? '');
    const [selectedResponsibleUserId, setSelectedResponsibleUserId] = useState<number | ''>(authUser?.id ?? '');
    useEffect(() => {
        if (!isOpen) return;
        let active = true;

        Promise.allSettled([
            api.clients.list(),
            api.employees.list(),
            api.contracts.list(),
            canChooseBranch ? api.branches.list() : Promise.resolve([]),
            canChooseAssignedOwner ? api.admin.hrUsers.assignable() : Promise.resolve([]),
        ])
            .then(([clientsRes, employeesRes, contractsRes, branchesRes, hrUsersRes]) => {
                if (!active) return;
                setAllClients(clientsRes.status === 'fulfilled' ? clientsRes.value : []);
                setEmployees(
                    employeesRes.status === 'fulfilled'
                        ? employeesRes.value.map(toMediatorEmployee)
                        : [],
                );
                setContracts(contractsRes.status === 'fulfilled' ? contractsRes.value : []);
                setBranches(
                    branchesRes.status === 'fulfilled'
                        ? branchesRes.value.map((branch: any) => ({ id: branch.id, name: branch.name }))
                        : [],
                );
                setHrUsers(
                    hrUsersRes.status === 'fulfilled'
                        ? hrUsersRes.value.map((user: any) => ({
                            id: user.id,
                            name: user.name,
                            branchId: user.branch_id ?? user.branchId ?? null,
                            roleDisplayName: user.role_display_name ?? user.roleDisplayName ?? null,
                        }))
                        : [],
                );
            });

        return () => {
            active = false;
        };
    }, [isOpen, canChooseAssignedOwner, canChooseBranch]);

    const [referralType, setReferralType] = useState<ReferralType>('Personal');
    const [originChannel, setOriginChannel] = useState<ReferralOriginChannel>('Acquaintance');
    const [nameSnapshot, setNameSnapshot] = useState(currentUserDisplayName);
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');

    const [employeeIdInput, setEmployeeIdInput] = useState('');
    const [employeeFound, setEmployeeFound] = useState<MediatorEmployee | null>(null);
    const [employeeSearchError, setEmployeeSearchError] = useState('');

    const [clientSearch, setClientSearch] = useState('');
    const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

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
        setEmployeeIdInput('');
        setEmployeeFound(null);
        setEmployeeSearchError('');
        setClientSearch('');
        setClientSuggestions([]);
        setSelectedClientId(null);
        setError('');

        if (referralType === 'Personal') {
            setNameSnapshot(currentUserDisplayName);
        } else if (referralType === 'Unknown') {
            setNameSnapshot('مجهول');
        } else {
            setNameSnapshot('');
        }
    }, [referralType]);

    useEffect(() => {
        if (referralType === 'Personal') {
            setNameSnapshot(currentUserDisplayName);
        }
    }, [referralType, currentUserDisplayName]);

    const assignableHrUsers = React.useMemo(() => {
        if (!canChooseAssignedOwner) return [];
        if (selectedBranchId === '') return hrUsers;
        return hrUsers.filter(user => user.branchId == null || user.branchId === Number(selectedBranchId));
    }, [canChooseAssignedOwner, hrUsers, selectedBranchId]);

    useEffect(() => {
        if (isOpen && referralType === 'Personal') {
            setNameSnapshot(currentUserDisplayName);
        }
    }, [isOpen, referralType, currentUserDisplayName]);

    const handleEmployeeBlur = async () => {
        if (!employeeIdInput.trim()) {
            setEmployeeFound(null);
            setEmployeeSearchError('');
            return;
        }
        const loadedEmployee = findEmployeeByNumber(employees, employeeIdInput);
        if (loadedEmployee) {
            setEmployeeFound(loadedEmployee);
            setNameSnapshot(loadedEmployee.name);
            setEmployeeSearchError('');
            return;
        }
        if (employees.length > 0) {
            setEmployeeFound(null);
            setNameSnapshot('');
            setEmployeeSearchError('لم يتم العثور على الموظف');
            return;
        }
        try {
            const employees = (await api.employees.list()).map(toMediatorEmployee);
            const emp = findEmployeeByNumber(employees, employeeIdInput);
            if (emp) {
                setEmployeeFound(emp);
                setNameSnapshot(emp.name);
                setEmployeeSearchError('');
            } else {
                setEmployeeFound(null);
                setNameSnapshot('');
                setEmployeeSearchError('لم يتم العثور على الموظف');
            }
        } catch {
            setEmployeeFound(null);
            setNameSnapshot('');
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
        setNameSnapshot(client.name);
        setSelectedClientId(client.id);
        setClientSuggestions([]);
    };

    const handleSave = async () => {
        if (!nameSnapshot.trim()) {
            setError('الرجاء تعبئة جميع الحقول الإلزامية.');
            return;
        }
        if (referralType === 'Employee' && !employeeFound) {
            setError('الرجاء اختيار موظف صالح كوسيط.');
            return;
        }
        if (referralType === 'Client' && !selectedClientId) {
            setError('الرجاء اختيار زبون صالح كوسيط.');
            return;
        }

        if (canChooseBranch && !selectedBranchId) {
            setError('يجب تحديد الفرع لهذه اللائحة.');
            return;
        }
        if (canChooseAssignedOwner && !selectedResponsibleUserId) {
            setError('يجب تحديد المسؤول عن هذه اللائحة.');
            return;
        }

        let entityId: number | null = null;
        if (referralType === 'Employee' && employeeFound) {
            entityId = employeeFound.id;
        } else if (referralType === 'Client' && selectedClientId) {
            entityId = selectedClientId;
        }

        try {
            const resolvedResponsibleUserId = selectedResponsibleUserId === '' ? (authUser?.id ?? undefined) : Number(selectedResponsibleUserId);
            const assignmentOwnerId = canChooseAssignedOwner ? resolvedResponsibleUserId : (authUser?.id ?? undefined);
            const newId = await addReferralSheet({
                referralType,
                referralOriginChannel: originChannel,
                referralNameSnapshot: nameSnapshot,
                referralAddressText: '',
                referralEntityId: entityId,
                referralDate: new Date().toISOString(),
                referralNotes: notes,
                ownerUserId: assignmentOwnerId,
                assignedHrUserId: assignmentOwnerId,
                branchId: selectedBranchId === '' ? (contextBranchId ?? authUser?.branchId ?? undefined) : Number(selectedBranchId),
                status: 'New',
                createdBy: authUser?.id
            });

            if (onSheetCreated) onSheetCreated(newId);
            resetState();
            onClose();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const resetState = () => {
        setReferralType('Personal');
        setOriginChannel('Acquaintance');
        setNameSnapshot(currentUserDisplayName);
        setNameSnapshot(currentUserDisplayName);
        setEmployeeIdInput('');
        setEmployeeFound(null);
        setEmployeeSearchError('');
        setClientSearch('');
        setClientSuggestions([]);
        setSelectedClientId(null);
        setSelectedBranchId(contextBranchId ?? authUser?.branchId ?? '');
        setSelectedResponsibleUserId(authUser?.id ?? '');
        setNotes('');
        setError('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                            <PlusCircle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">إضافة لائحة أسماء جديدة </h2>
                            <p className="text-sm text-slate-500">تسجيل لائحة أسماء جديدة تحت وسيط محدد</p>
                        </div>
                    </div>
                    <IconButton icon={X} label="إغلاق" onClick={onClose} />
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {error && (
                        <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                            {error}
                        </div>
                    )}

                    {(canChooseBranch || canChooseAssignedOwner) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
                            {canChooseBranch && (
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">الفرع</label>
                                    <Select
                                        value={selectedBranchId === '' ? '' : String(selectedBranchId)}
                                        onChange={v => setSelectedBranchId(v === '' ? '' : Number(v))}
                                        placeholder="-- اختر الفرع --"
                                        ariaLabel="الفرع"
                                        className="w-full"
                                        options={branches.map(branch => ({ value: String(branch.id), label: branch.name }))}
                                    />
                                </div>
                            )}
                            {canChooseAssignedOwner && (
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">المسؤول عن اللائحة</label>
                                    <Select
                                        value={selectedResponsibleUserId === '' ? '' : String(selectedResponsibleUserId)}
                                        onChange={v => setSelectedResponsibleUserId(v === '' ? '' : Number(v))}
                                        placeholder="-- اختر المسؤول --"
                                        ariaLabel="المسؤول عن اللائحة"
                                        className="w-full"
                                        options={assignableHrUsers.map(user => ({
                                            value: String(user.id),
                                            label: `${user.name}${user.roleDisplayName ? ` - ${user.roleDisplayName}` : ''}`,
                                        }))}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">نوع الوسيط </label>
                            <Select<ReferralType>
                                value={referralType}
                                onChange={setReferralType}
                                ariaLabel="نوع الوسيط"
                                className="w-full"
                                options={referralTypes.map(rt => ({ value: rt.value, label: rt.label }))}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">طريقة التواصل</label>
                            <Select<ReferralOriginChannel>
                                value={originChannel}
                                onChange={setOriginChannel}
                                ariaLabel="طريقة التواصل"
                                className="w-full"
                                options={channels.map(c => ({ value: c.value, label: c.label }))}
                            />
                        </div>
                    </div>

                    {/* DYNAMIC MEDIATOR RENDER */}
                    {referralType === 'Employee' && (
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">رقم الموظف <span className="text-red-500">*</span></label>
                            <div className="flex items-center gap-3">
                                <div className="w-1/2">
                                    <Input
                                        value={employeeIdInput}
                                        onChange={(e) => setEmployeeIdInput(e.target.value)}
                                        onBlur={handleEmployeeBlur}
                                        placeholder="أدخل رقم الموظف..."
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleEmployeeBlur}
                                    className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold hover:bg-amber-100"
                                >
                                    اعتماد
                                </button>
                                {employeeFound && (
                                    <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 flex-1">
                                        <CheckCircle className="w-5 h-5" />
                                        {formatEmployeeMediatorLabel(employeeFound)}
                                    </div>
                                )}
                                {employeeSearchError && (
                                    <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 px-3 py-2 rounded-lg border border-red-100 flex-1">
                                        <AlertCircle className="w-5 h-5" />
                                        {employeeSearchError}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {referralType === 'Client' && (
                        <div ref={clientSearchRef} className="relative">
                            <label className="block text-sm font-bold text-slate-700 mb-2">اسم الوسيط <span className="text-red-500">*</span></label>
                            <Input
                                value={clientSearch}
                                onChange={(e) => handleClientSearch(e.target.value)}
                                onFocus={() => handleClientSearch(clientSearch)}
                                placeholder="ابحث عن الزبون بالاسم أو رقم الهاتف..."
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
                                                <span className="font-bold text-slate-700">{client.name}</span>
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
                            <label className="block text-sm font-bold text-slate-700 mb-2"> اسم الوسيط <span className="text-red-500">*</span></label>
                            <Input
                                value={nameSnapshot}
                                disabled
                                className="font-bold"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">ملاحظات عامة</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="تفاصيل إضافية حول هذه الورقة..."
                            className="w-full p-3 rounded-xl border border-slate-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">
                        إلغاء
                    </button>
                    <button onClick={handleSave} className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-md shadow-amber-500/20 rounded-xl transition-all">
                        <Save className="w-4 h-4" />
                        حفظ الورقة
                    </button>
                </div>

            </div>
        </div>
    );
}
