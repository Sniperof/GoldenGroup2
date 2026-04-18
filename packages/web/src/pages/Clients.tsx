import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Trash2, UserPlus, CheckCircle2, AlertCircle, Clock, Search, Lightbulb, Pencil, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import type { Client, GeoUnit, Visit, Contract } from '../lib/types';
import ClientModal from '../components/ClientModal';
import SmartTable from '../components/SmartTable';
import type { ColumnDef, FilterDef } from '../components/SmartTable';
import ManualSearchModal from '../components/candidates/ManualSearchModal';
import QualificationModal from '../components/candidates/QualificationModal';
import AddCandidateModal from '../components/candidates/AddCandidateModal';
import { useCandidateStore } from '../hooks/useCandidateStore';

export default function Clients() {
    const [clients, setClients] = useState<Client[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [loading, setLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<'clients' | 'candidates'>('clients');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [isPreAddModalOpen, setIsPreAddModalOpen] = useState(false);
    const [activeCandidateForSearch, setActiveCandidateForSearch] = useState<any>(null);
    const [isAddCandidateModalOpen, setIsAddCandidateModalOpen] = useState(false);
    const qualifyCandidate = useCandidateStore((state: any) => state.qualifyCandidate);

    const navigate = useNavigate();

    // ─── Filters & Search State ───
    const [searchTerm, setSearchTerm] = useState('');
    const [filterClass, setFilterClass] = useState('all');
    const [filterArea, setFilterArea] = useState('all');
    const [filterMediator, setFilterMediator] = useState('all');

    const fetchClients = useCallback(async () => {
        const data = await api.clients.list();
        setClients(data);
    }, []);

    useEffect(() => {
        const fetchAll = async () => {
            try {
                setLoading(true);
                const [clientsData, visitsData, contractsData, geoUnitsData] = await Promise.all([
                    api.clients.list(),
                    api.visits.list(),
                    api.contracts.list(),
                    api.geoUnits.list(),
                ]);
                setClients(clientsData);
                setVisits(visitsData);
                setContracts(contractsData);
                setGeoUnits(geoUnitsData);
            } catch (err) {
                console.error('Failed to fetch data:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchAll();
    }, []);

    const getLifecycleStage = useCallback((client: Client) => {
        if (contracts.some(c => c.customerId === client.id)) return 'OP';
        if (visits.some(v => v.customerId === client.id)) return 'FOP';
        return 'Lead';
    }, [contracts, visits]);

    // ─── Computed Lists ───
    const mainList = useMemo(() => {
        let list = clients
            .filter(c => !c.isCandidate)
            .map(c => ({
                ...c,
                lifecycleStage: getLifecycleStage(c)
            }));

        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            list = list.filter(c => {
                const fullName = `${c.firstName} ${c.fatherName} ${c.lastName} ${c.nickname || ''}`.toLowerCase();
                const hasPhone = c.contacts?.some(con => con.number.includes(q)) || false;
                return fullName.includes(q) ||
                    hasPhone ||
                    c.id.toString().includes(q) ||
                    (c.referrerName || '').toLowerCase().includes(q);
            });
        }

        if (filterClass !== 'all') list = list.filter(c => c.lifecycleStage === filterClass);
        if (filterMediator !== 'all') list = list.filter(c => c.referrerType === filterMediator);
        if (filterArea !== 'all') list = list.filter(c => {
            const nId = parseInt(c.neighborhood);
            const n = geoUnits.find(g => g.id === nId);
            const gov = geoUnits.find(g => g.id === n?.parentId);
            const district = geoUnits.find(g => g.id === gov?.parentId);
            return n?.parentId === parseInt(filterArea) || gov?.id === parseInt(filterArea);
        });

        return list;
    }, [clients, getLifecycleStage, searchTerm, filterClass, filterMediator, filterArea, geoUnits]);

    const candidateList = useMemo(() => clients.filter(c => c.isCandidate), [clients]);

    // ─── KPI Calculations ───
    const kpis = useMemo(() => {
        const total = mainList.length;

        const leadsCount = mainList.filter(c => c.lifecycleStage === 'Lead').length;
        const fopsCount = mainList.filter(c => c.lifecycleStage === 'FOP').length;
        const opsCount = mainList.filter(c => c.lifecycleStage === 'OP').length;

        return { total, leadsCount, fopsCount, opsCount };
    }, [mainList]);

    const convertToLead = async (id: number) => {
        if (!confirm('هل أنت متأكد من تحويل هذا المرشح إلى عميل محتمل؟')) return;
        const client = clients.find(c => c.id === id);
        if (!client) return;
        try {
            await api.clients.update(id, { ...client, isCandidate: false });
            await fetchClients();
        } catch (err) {
            console.error('Failed to convert candidate:', err);
        }
    };

    const deleteClient = async (id: number) => {
        if (!confirm('حذف هذا العميل؟')) return;
        try {
            await api.clients.delete(id);
            await fetchClients();
        } catch (err) {
            console.error('Failed to delete client:', err);
        }
    };

    const bulkDelete = async (items: { id: number }[]) => {
        const ids = items.map(i => i.id);
        try {
            await api.clients.bulkDelete(ids);
            await fetchClients();
        } catch (err) {
            console.error('Failed to bulk delete:', err);
        }
    };

    const handleSaveClient = async (clientData: Client) => {
        try {
            if (editingClient) {
                await api.clients.update(clientData.id, clientData);
            } else {
                await api.clients.create({
                    ...clientData,
                    createdAt: new Date().toISOString(),
                    status: 'New',
                    isCandidate: activeTab === 'candidates',
                });
            }
            await fetchClients();
        } catch (err) {
            console.error('Failed to save client:', err);
        }
        setIsModalOpen(false);
        setIsAddCandidateModalOpen(false);
        setEditingClient(null);
    };

    const openEditModal = (client: Client) => { setEditingClient(client); setIsModalOpen(true); };

    const getNeighborhoodHierarchy = (id: string) => {
        const nId = parseInt(id);
        const neighborhood = geoUnits.find(gu => gu.id === nId);
        if (!neighborhood) return '--';
        const subArea = geoUnits.find(gu => gu.id === neighborhood.parentId);
        if (subArea) return `${subArea.name} > ${neighborhood.name}`;
        return neighborhood.name;
    };

    const clientColumns: ColumnDef<Client & { lifecycleStage: string }>[] = [
        { key: 'id', label: 'ID', sortable: true, render: (c) => <span className="text-sm text-slate-500 font-mono">#{c.id}</span> },
        {
            key: 'name', label: 'الاسم الكامل', sortable: true,
            render: (c) => (
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-sky-50 flex items-center justify-center text-sky-600 font-bold text-xs border border-sky-100">
                        {c.firstName?.[0] || 'Z'}{c.lastName?.[0] || ''}
                    </div>
                    <div>
                        <span className="block text-slate-800 font-semibold text-sm">{c.firstName} {c.fatherName} {c.lastName}</span>
                        {c.nickname && <span className="block text-[10px] text-slate-400">({c.nickname})</span>}
                    </div>
                </div>
            ),
        },
        {
            key: 'contacts', label: 'رقم الموبايل الرئيسي', sortable: true, render: (c) => {
                const primary = c.contacts?.find(con => con.isPrimary)?.number || c.contacts?.[0]?.number || '--';
                return <span className="text-sm text-slate-600 font-mono tracking-wide">{primary}</span>;
            }
        },
        { key: 'neighborhood', label: 'العنوان', sortable: true, render: (c) => <span className="text-sm text-slate-600 font-medium">{getNeighborhoodHierarchy(c.neighborhood)}</span> },
        { key: 'occupation', label: 'المهنة', sortable: true, render: (c) => <span className="text-sm text-slate-600">{c.occupation || '--'}</span> },
        {
            key: 'status', label: 'التصنيف', sortable: true,
            render: (c) => {
                const stage = c.lifecycleStage;
                if (stage === 'OP') return <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold border border-emerald-200 shadow-sm flex items-center gap-1 w-fit"><CheckCircle2 className="w-3 h-3" /> زبون فعلي (OP)</span>;
                if (stage === 'FOP') return <span className="px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-bold border border-orange-200 shadow-sm flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> مستهدف (FOP)</span>;
                return <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-bold border border-gray-200 flex items-center gap-1 w-fit"><AlertCircle className="w-3 h-3" /> مرشح (Lead)</span>;
            },
            getValue: (c) => c.lifecycleStage
        },
        {
            key: 'rating', label: 'الالتزام', sortable: true,
            render: (c) => {
                const r = c.rating || 'Undefined';
                if (r === 'Committed') return <span className="px-2.5 py-1 rounded-lg bg-green-50 text-green-700 text-[11px] font-black border border-green-200">ملتزم</span>;
                if (r === 'NotCommitted') return <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-[11px] font-black border border-red-200">غير ملتزم</span>;
                return <span className="px-2.5 py-1 rounded-lg bg-slate-50 text-slate-400 text-[11px] font-black border border-slate-200">غير محدد</span>;
            }
        },
        {
            key: 'referrerType', label: 'نوع الوسيط', sortable: true,
            render: (c) => {
                const types: Record<string, string> = {
                    'Personal': 'شخصي',
                    'Employee': 'موظف',
                    'Client': 'زبون حالي',
                    'Unknown': 'مجهول',
                    'Other': 'أخرى',
                };
                return <span className="text-xs text-slate-600 bg-gray-50 px-2 py-1 rounded border border-gray-200">{types[c.referrerType || ''] || c.referrerType || '--'}</span>;
            }
        },
        { key: 'referrerName', label: 'اسم الوسيط', sortable: true, render: (c) => <span className="text-sm font-medium text-slate-700">{c.referrerName || '--'}</span> },
    ];

    const candidateColumns: ColumnDef<Client>[] = [
        { key: 'name', label: 'الاسم المرشح', sortable: true, render: (c) => <span className="font-semibold text-slate-700">{c.name}</span> },
        { key: 'mobile', label: 'رقم الهاتف', sortable: true, render: (c) => <span className="font-mono text-slate-600">{c.mobile}</span> },
        { key: 'sourceChannel', label: 'المصدر', sortable: true, render: (c) => <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">{c.sourceChannel || 'N/A'}</span> },
        { key: 'createdAt', label: 'تاريخ الإضافة', sortable: true, render: (c) => <span className="text-sm text-slate-500">{c.createdAt?.slice(0, 10)}</span> },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6">
            {/* 1. Page Title */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">سجلات الزبائن</h1>
                    <p className="text-sm text-slate-500 font-medium">إدارة وتحليل بيانات الزبائن والشبكة</p>
                </div>
                <button
                    onClick={() => {
                        setActiveCandidateForSearch({
                            id: 0,
                            firstName: '',
                            lastName: '',
                            nickname: '',
                            mobile: '',
                            referralType: 'Personal',
                            referralNameSnapshot: 'المدير/المشرف المباشر'
                        });
                        setIsPreAddModalOpen(true);
                    }}
                    className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 transition-all active:scale-95"
                >
                    <UserPlus className="w-4 h-4" />
                    <span>إضافة اسم مرشح جديد</span>
                </button>
            </div>

            {/* 2. KPI Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'إجمالي الزبائن', value: kpis.total, icon: Users, color: 'text-sky-600', bg: 'bg-sky-50' },
                    { label: 'إجمالي الأسماء المرشحة', value: kpis.leadsCount, icon: AlertCircle, color: 'text-slate-600', bg: 'bg-slate-50' },
                    { label: 'إجمالي الزبائن المحتملة FOP', value: kpis.fopsCount, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'إجمالي الزبائن OP', value: kpis.opsCount, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                ].map((kpi, idx) => (
                    <div key={idx} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-center justify-between mb-2">
                            <div className={`p-2 rounded-xl ${kpi.bg} ${kpi.color} group-hover:scale-110 transition-transform`}>
                                <kpi.icon className="w-5 h-5" />
                            </div>
                            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">مؤشرات مباشرة</span>
                        </div>
                        <p className="text-xs font-bold text-slate-400 mb-1">{kpi.label}</p>
                        <p className={`text-xl font-black ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* 3. Unified Search & Filter Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row items-center gap-4">
                    {/* Smart Search */}
                    <div className="relative flex-1 w-full">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="بحث ذكي (الاسم، الهاتف، المعرف، الوسيط)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-3 text-sm focus:border-sky-500 focus:outline-none transition-all focus:bg-white"
                        />
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <select
                            value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-sky-500"
                        >
                            <option value="all">كل التصنيفات</option>
                            <option value="Lead">Lead - مرشح</option>
                            <option value="FOP">FOP - مستهدف</option>
                            <option value="OP">OP - فعلي</option>
                        </select>

                        <select
                            value={filterMediator} onChange={(e) => setFilterMediator(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-sky-500"
                        >
                            <option value="all">كل أنواع الوسيط</option>
                            <option value="Personal">شخصي</option>
                            <option value="Employee">موظف</option>
                            <option value="Client">زبون حالي</option>
                        </select>

                        <select
                            value={filterArea} onChange={(e) => setFilterArea(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-sky-500"
                        >
                            <option value="all">كل المحافظات</option>
                            {geoUnits.filter(g => g.level === 1).map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>

                        <button
                            onClick={() => { setSearchTerm(''); setFilterClass('all'); setFilterMediator('all'); setFilterArea('all'); }}
                            className="text-xs font-bold text-slate-400 hover:text-sky-600 px-3 transition-colors"
                        >
                            تفريغ الفلاتر
                        </button>
                    </div>
                </div>
            </div >

            {/* 4. Main Data Table */}
            <SmartTable<Client & { lifecycleStage: string }>
                title="جدول بيانات الزبائن"
                icon={Users}
                hideFilterBar={true}
                data={mainList}
                columns={clientColumns}
                tableMinWidth={980}
                getId={(c) => c.id}
                onRowClick={(c) => navigate(`/clients/${c.id}`)}
                bulkActions={[
                    { label: 'حذف', icon: Trash2, variant: 'danger', onClick: (items) => { if (confirm(`حذف ${items.length} عملاء؟`)) bulkDelete(items); } },
                ]}
                actions={(c) => (
                    <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); openEditModal(c as any); }} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-gray-400 hover:text-sky-500 transition-all border border-transparent hover:border-gray-100" title="تعديل بيانات الزبون">
                            <Pencil className="w-4 h-4" />
                        </button>
                    </div>
                )}
                emptyIcon={Users}
                emptyMessage="لا يوجد سجلات زبائن حالياً"
            />

            <ClientModal
                isOpen={isModalOpen || isAddCandidateModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setIsAddCandidateModalOpen(false);
                }}
                onSave={handleSaveClient}
                initialData={editingClient}
                geoUnits={geoUnits}
            />

            <ManualSearchModal
                isOpen={isPreAddModalOpen}
                onClose={() => setIsPreAddModalOpen(false)}
                candidate={activeCandidateForSearch || {}}
                clients={clients}
                candidates={candidateList}
                onLink={(entity, type) => {
                    setIsPreAddModalOpen(false);
                    if (type === 'Client') {
                        navigate(`/clients/${entity.id}`);
                    } else {
                        navigate(`/candidates`);
                    }
                }}
                onNoMatch={() => {
                    setIsPreAddModalOpen(false);
                    setIsAddCandidateModalOpen(true);
                }}
            />


        </div >
    );
}
