import React, { useState, useMemo, useEffect } from 'react';
import { Target, Users, PhoneCall } from 'lucide-react';
import { api } from "../../lib/api";
import { useCandidateStore } from "../../hooks/useCandidateStore";
import { useClientStore } from "../../hooks/useClientStore";
import SmartTable, { ColumnDef } from "../SmartTable";
import { Candidate, Client, GeoUnit, Contract, Visit } from "../../lib/types";
import { getPrimaryContact } from "../../lib/contactUtils";

export default function MarketingOperationsContent() {
    // --- Data Sources ---
    const candidates = useCandidateStore((state) => state.candidates);
    const { clients, loadClients, getLeads } = useClientStore();

    const [contracts, setContracts] = useState<Contract[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

    useEffect(() => {
        loadClients();
    }, [loadClients]);

    useEffect(() => {
        let active = true;

        Promise.all([api.contracts.list(), api.visits.list(), api.geoUnits.list()])
            .then(([contractsData, visitsData, geoUnitsData]) => {
                if (!active) return;
                setContracts(contractsData);
                setVisits(visitsData);
                setGeoUnits(geoUnitsData);
            })
            .catch((error) => {
                console.error('Failed to load marketing operations data:', error);
                if (!active) return;
                setContracts([]);
                setVisits([]);
                setGeoUnits([]);
            });

        return () => {
            active = false;
        };
    }, []);

    // --- Computed Lists ---
    const followUpCandidates = useMemo(() => {
        return candidates.filter(c => c.status === 'FollowUp');
    }, [candidates]);

    const activeLeads = useMemo(() => {
        return getLeads(contracts, visits);
    }, [getLeads, contracts, visits, clients]);

    // --- KPIs ---
    const totalFollowUps = followUpCandidates.length;
    const totalLeads = activeLeads.length;
    const totalmarketingPool = totalFollowUps + totalLeads;

    // --- Helpers ---
    const getNeighborhoodName = (idOrName: string) => {
        const id = parseInt(idOrName);
        if (!isNaN(id)) {
            return geoUnits.find(u => u.id === id)?.name || idOrName;
        }
        return idOrName; // Fallback if it's already a name
    };

    // --- Columns ---
    const candidateColumns: ColumnDef<Candidate>[] = [
        { key: 'name', label: 'الاسم', sortable: true, render: (c) => <span className="font-semibold text-slate-700">{c.firstName} {c.lastName || ''} {c.nickname ? `(${c.nickname})` : ''}</span> },
        { key: 'mobile', label: 'رقم الهاتف', sortable: true, render: (c) => <span className="font-mono text-slate-600 tracking-wide" dir="ltr">{getPrimaryContact(c).number}</span> },
        { key: 'addressText', label: 'العنوان', sortable: true, render: (c) => <span className="text-sm text-slate-600">{c.addressText}</span> },
        { key: 'status', label: 'الحالة', render: () => <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold border border-amber-200">متابعة</span> },
    ];

    const leadColumns: ColumnDef<Client>[] = [
        { key: 'name', label: 'الزبون', sortable: true, render: (c) => <span className="font-semibold text-slate-700">{c.name}</span> },
        { key: 'mobile', label: 'رقم الهاتف', sortable: true, render: (c) => <span className="font-mono text-slate-600 tracking-wide" dir="ltr">{getPrimaryContact(c).number}</span> },
        { key: 'neighborhood', label: 'الحي', sortable: true, render: (c) => <span className="text-sm text-slate-600">{getNeighborhoodName(c.neighborhood)}</span> },
        { key: 'status', label: 'الحالة', render: () => <span className="px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-bold border border-sky-200">مرشح (Lead)</span> },
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Target className="w-6 h-6 text-indigo-600" />
                        عمليات التسويق
                    </h1>
                    <p className="text-slate-500 mt-1">لوحة تحكم مدير الفرع لاستعراض ومتابعة الزبائن المحتملين.</p>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 mb-1">إجمالي الأسماء للمتابعة</p>
                        <p className="text-3xl font-bold text-amber-600">{totalFollowUps}</p>
                    </div>
                    <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
                        <PhoneCall className="w-6 h-6 text-amber-500" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 mb-1">الزبائن المحتملين (Leads)</p>
                        <p className="text-3xl font-bold text-sky-600">{totalLeads}</p>
                    </div>
                    <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center">
                        <Users className="w-6 h-6 text-sky-500" />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold text-slate-500 mb-1">إجمالي قائمة التسويق الهاتفي</p>
                        <p className="text-3xl font-bold text-indigo-600">{totalmarketingPool}</p>
                    </div>
                    <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                        <Target className="w-6 h-6 text-indigo-500" />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Table A: Follow-ups */}
                <div>
                    <SmartTable<Candidate>
                        title="الأسماء للمتابعة (Table A)"
                        icon={PhoneCall}
                        data={followUpCandidates}
                        columns={candidateColumns}
                        filters={[]}
                        searchKeys={['firstName', 'lastName', 'nickname', 'mobile']}
                        searchPlaceholder="بحث في الأسماء المقترحة..."
                        getId={(c) => c.id}
                        emptyIcon={PhoneCall}
                        emptyMessage="لا يوجد أسماء بحالة متابعة"
                    />
                </div>

                {/* Table B: Leads */}
                <div>
                    <SmartTable<Client>
                        title="الزبائن المحتملين (Table B)"
                        icon={Users}
                        data={activeLeads}
                        columns={leadColumns}
                        filters={[]}
                        searchKeys={['name', 'mobile']}
                        searchPlaceholder="بحث في الزبائن المحتملين..."
                        getId={(c) => c.id}
                        emptyIcon={Users}
                        emptyMessage="لا يوجد زبائن محتملين حالياً"
                    />
                </div>
            </div>
        </div>
    );
}
