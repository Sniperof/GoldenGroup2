import { create } from 'zustand';
import { EmergencyTicket } from '../lib/types';
import { api } from '../lib/api';

interface EmergencyStore {
    tickets: EmergencyTicket[];
    loadTickets: () => Promise<void>;
    addTicket: (ticket: Omit<EmergencyTicket, 'id' | 'createdAt'>) => Promise<EmergencyTicket | null>;
    updateTicket: (id: number, updates: Partial<EmergencyTicket>) => Promise<void>;
}

export const useEmergencyStore = create<EmergencyStore>((set, get) => ({
    tickets: [],

    loadTickets: async () => {
        try {
            const tickets = await api.emergencyTickets.list();
            set({ tickets });
        } catch (error) {
            console.error('Failed to load emergency tickets:', error);
            set({ tickets: [] });
        }
    },

    addTicket: async (ticketInput) => {
        try {
            const created = await api.emergencyTickets.create(ticketInput);
            set((state) => ({ tickets: [created, ...state.tickets] }));
            return created;
        } catch (error) {
            console.error('Failed to create emergency ticket:', error);
            return null;
        }
    },

    updateTicket: async (id, updates) => {
        const current = get().tickets.find((ticket) => ticket.id === id);
        if (!current) return;

        try {
            const updated = await api.emergencyTickets.update(id, { ...current, ...updates });
            set((state) => ({
                tickets: state.tickets.map((ticket) => (ticket.id === id ? updated : ticket)),
            }));
        } catch (error) {
            console.error('Failed to update emergency ticket:', error);
        }
    },
}));
