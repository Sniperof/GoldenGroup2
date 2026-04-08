import { create } from 'zustand';
import { Client, Contract, Visit } from '../lib/types';
import { api } from '../lib/api';

interface ClientStore {
    clients: Client[];
    loadClients: () => Promise<void>;
    updateClient: (id: number, updates: Partial<Client>) => Promise<void>;
    // getLeads is a selector function
    getLeads: (contracts: Contract[], visits: Visit[]) => Client[];
}

export const useClientStore = create<ClientStore>((set, get) => ({
    clients: [],

    loadClients: async () => {
        try {
            const loadedClients = await api.clients.list();
            set({ clients: loadedClients });
        } catch (error) {
            console.error('Failed to load clients from API:', error);
            set({ clients: [] });
        }
    },

    updateClient: async (id: number, updates: Partial<Client>) => {
        const currentClient = get().clients.find((client) => client.id === id);
        if (!currentClient) return;

        try {
            const updatedClient = await api.clients.update(id, { ...currentClient, ...updates });
            set((state) => ({
                clients: state.clients.map((client) => (client.id === id ? updatedClient : client)),
            }));
        } catch (error) {
            console.error('Failed to update client via API:', error);
        }
    },

    getLeads: (contracts: Contract[], visits: Visit[]) => {
        const { clients } = get();
        return clients.filter((c) => {
            const clientContracts = contracts.filter((contract) => contract.customerId === c.id);
            const clientVisits = visits.filter((v) => v.customerId === c.id);
            // Lifecycle 'Lead': no contracts and no visits. 
            // Based on existing logic in Clients.tsx:27-31
            return clientContracts.length === 0 && clientVisits.length === 0;
        });
    },
}));
