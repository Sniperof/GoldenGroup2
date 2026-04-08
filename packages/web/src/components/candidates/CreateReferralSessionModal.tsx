import React, { useState, useEffect, useRef } from 'react';
import { X, Save, PlusCircle, Building2, User, PhoneCall, Handshake, Search, CheckCircle, AlertCircle } from 'lucide-react';
import { ReferralType, ReferralOriginChannel, Client } from '../../lib/types';
import { useCandidateStore } from '../../hooks/useCandidateStore';
import GeoSmartSearch, { GeoSelection } from '../GeoSmartSearch';
import { api } from '../../lib/api';
import type { GeoUnit } from '../../lib/types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSheetCreated?: (sheetId: number) => void;
}

const referralTypes: { value: ReferralType; label: string; icon: any }[] = [
    { value: 'Personal', label: 'شخصي', icon: User },
    { value: 'Client', label: 'زبون حالي', icon: Handshake },
    { value: 'Employee', label: 'موظف', icon: Building2 },
    { value: 'Unknown', label: 'مجهول', icon: Search }
];

const channels: { value: ReferralOriginChannel; label: string }[] = [
    { value: 'App', label: 'سوشال ميديا' },
    { value: 'Campaign', label: 'حملة إعلانية' },
    { value: 'Acquaintance', label: 'معرفة شخصية' }
];

export default function CreateReferralSheetModal({ isOpen, onClose, onSheetCreated }: Props) {
    const addReferralSheet = useCandidateStore(state => state.addReferralSheet); // Updated hook

    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [allClients, setAllClients] = useState<Client[]>([]);
    const [visits, setVisits] = useState<Array<{ customerId: number }>>([]);
    const [contracts, setContracts] = useState<Array<{ customerId: number }>>([]);
    useEffect(() => {
        let active = true;

        Promise.all([
            api.geoUnits.list(),
            api.clients.list(),
            api.visits.list(),
            api.contracts.list(),
        ])
            .then(([units, clients, visitsData, contractsData]) => {
                if (!active) return;
                setGeoUnits(units);
                setAllClients(clients);
                setVisits(visitsData);
                setContracts(contractsData);
            })
            .catch((error) => {
                console.error(error);
                if (!active) return;
                setGeoUnits([]);
                setAllClients([]);
                setVisits([]);
                setContracts([]);
            });

        return () => {
            active = false;
        };
    }, []);

    const [referralType, setReferralType] = useState<ReferralType>('Personal');
    const [originChannel, setOriginChannel] = useState<ReferralOriginChannel>('Acquaintance');
    const [nameSnapshot, setNameSnapshot] = useState('إبراهيم (مشرف)');
    const [addressSelection, setAddressSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
    const [referralDate, setReferralDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');

    const [employeeIdInput, setEmployeeIdInput] = useState('');
    const [employeeFound, setEmployeeFound] = useState<{ name: string, id: number } | null>(null);
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
        setNameSnapshot('');
        setOriginChannel('Acquaintance');
        setEmployeeIdInput('');
        setEmployeeFound(null);
        setEmployeeSearchError('');
        setClientSearch('');
        setClientSuggestions([]);
        setSelectedClientId(null);
        setError('');

        if (referralType === 'Personal') {
            setOriginChannel('Acquaintance');
            setNameSnapshot('إبراهيم (مشرف)');
        } else if (referralType === 'Unknown') {
            setNameSnapshot('مجهول');
        }
    }, [referralType]);

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
        setNameSnapshot(client.name);
        setSelectedClientId(client.id);
        setClientSuggestions([]);
    };

    const handleSave = async () => {
        if (!nameSnapshot.trim() || !referralDate) {
            setError('الرجاء تعبئة جميع الحقول الإلزامية (اسم الوسيط، وتاريخ الورقة).');
            return;
        }
        let entityId: number | null = null;
        if (referralType === 'Employee' && employeeFound) {
            entityId = employeeFound.id;
        } else if (referralType === 'Client' && selectedClientId) {
            entityId = selectedClientId;
        }

        const unitId = addressSelection.neighborhoodId || addressSelection.subId || addressSelection.regionId || addressSelection.govId;
        const matchingUnit = geoUnits.find(u => u.id === Number(unitId));
        const addressText = matchingUnit ? matchingUnit.name : 'غير محدد';

        try {
            const newId = await addReferralSheet({
                referralType,
                referralOriginChannel: originChannel,
                referralNameSnapshot: nameSnapshot,
                referralAddressText: addressText,
                referralEntityId: entityId,
                referralDate: new Date(referralDate).toISOString(),
                referralNotes: notes,
                ownerUserId: 1,
                status: 'New',
                createdBy: 1
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
        setNameSnapshot('إبراهيم (مشرف)');
        setEmployeeIdInput('');
        setEmployeeFound(null);
        setEmployeeSearchError('');
        setClientSearch('');
        setClientSuggestions([]);
        setSelectedClientId(null);
        setReferralDate(new Date().toISOString().split('T')[0]);
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
                            <h2 className="text-xl font-bold text-slate-800">إضافة ورقة ترشيح جديدة </h2>
                            <p className="text-sm text-slate-500">تسجيل قائمة أسماء جديدة تحت وسيط محدد</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {error && (
                        <div className="p-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium border border-red-100">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">نوع الوسيط </label>
                            <select
                                value={referralType}
                                onChange={(e) => setReferralType(e.target.value as ReferralType)}
                                className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm font-bold"
                            >
                                {referralTypes.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">طريقة الوصول</label>
                            <select
                                value={originChannel}
                                onChange={(e) => setOriginChannel(e.target.value as ReferralOriginChannel)}
                                disabled={referralType === 'Personal' || referralType === 'Unknown'}
                                className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                            >
                                {channels.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* DYNAMIC MEDIATOR RENDER */}
                    {referralType === 'Employee' && (
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">رقم الموظف <span className="text-red-500">*</span></label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="text"
                                    value={employeeIdInput}
                                    onChange={(e) => setEmployeeIdInput(e.target.value)}
                                    onBlur={handleEmployeeBlur}
                                    placeholder="أدخل رقم الموظف..."
                                    className="w-1/2 p-2.5 rounded-xl border border-slate-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                                />
                                {employeeFound && (
                                    <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 flex-1">
                                        <CheckCircle className="w-5 h-5" />
                                        {employeeFound.name}
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
                            <label className="block text-sm font-bold text-slate-700 mb-2">اسم الزبون <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={clientSearch}
                                onChange={(e) => handleClientSearch(e.target.value)}
                                onFocus={() => handleClientSearch(clientSearch)}
                                placeholder="ابحث عن الزبون بالاسم أو رقم الهاتف..."
                                className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
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
                            <input
                                type="text"
                                value={nameSnapshot}
                                disabled
                                className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 font-bold cursor-not-allowed"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">تاريخ الورقة <span className="text-red-500">*</span></label>
                        <input
                            type="date"
                            value={referralDate}
                            onChange={(e) => setReferralDate(e.target.value)}
                            className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 text-sm"
                        />
                    </div>

                    <div>
                        <GeoSmartSearch
                            label="النطاق الجغرافي / منطقة العمل"
                            geoUnits={geoUnits}
                            value={addressSelection}
                            onChange={setAddressSelection}
                            placeholder="ابحث عن المنطقة المستهدفة..."
                        />
                    </div>

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
