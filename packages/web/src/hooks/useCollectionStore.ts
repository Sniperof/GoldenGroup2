import { create } from 'zustand';
import { api } from '../lib/api';
import { Due, Contract } from '../lib/types';

interface CollectionState {
    contracts: Contract[];
    dues: (Due & { customerName: string; customerId: number; mobile: string })[];

    fetchData: () => Promise<void>;
    updateDue: (dueId: number, updates: Partial<Due>) => Promise<void>;
    assignAgent: (dueIds: number[], agentId: number) => Promise<void>;
    logCollection: (dueId: number, updates: { remainingBalance?: number; adjustedDate?: string; status?: Due['status'] }) => Promise<void>;

    getKPIs: () => {
        totalRemaining: number;
        overdueRate: number;
        unassignedDues: number;
    };
}

const flattenDues = (contracts: Contract[]) => {
    return contracts.flatMap(c =>
        c.dues.map(d => ({
            ...d,
            customerName: c.customerName,
            customerId: c.customerId,
            mobile: '07701234567'
        }))
    );
};

export const useCollectionStore = create<CollectionState>((set, get) => ({
    contracts: [],
    dues: [],

    fetchData: async () => {
        const contracts = await api.contracts.list();
        set({ contracts, dues: flattenDues(contracts) });
    },

    updateDue: async (dueId, updates) => {
        await api.dues.update(dueId, updates);
        await get().fetchData();
    },

    assignAgent: async (dueIds, agentId) => {
        await Promise.all(dueIds.map(id => api.dues.update(id, { assignedTelemarketerId: agentId })));
        await get().fetchData();
    },

    logCollection: async (dueId, updates) => {
        await api.dues.update(dueId, updates);
        await get().fetchData();
    },

    getKPIs: () => {
        const dues = get().dues;
        const totalRemaining = dues.reduce((acc, d) => acc + d.remainingBalance, 0);

        const overdueDues = dues.filter(d => {
            const diffTime = Math.abs(new Date().getTime() - new Date(d.adjustedDate).getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return d.status !== 'Paid' && new Date() > new Date(d.adjustedDate) && diffDays > 30;
        });
        const overdueRate = dues.length > 0 ? (overdueDues.length / dues.length) * 100 : 0;

        const unassignedDues = dues.filter(d => d.assignedTelemarketerId === null && d.status !== 'Paid').length;

        return { totalRemaining, overdueRate, unassignedDues };
    }
}));
