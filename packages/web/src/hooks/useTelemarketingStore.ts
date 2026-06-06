import { create } from 'zustand';
import { TaskList, TaskListItem, Appointment, CallLog } from '../lib/types';
import type { TelemarketingOutcomeCode } from '@golden-crm/shared';
import type { SelectedTaskEntry } from '../components/telemarketing/AppointmentSchedulerModal';
import { api } from '../lib/api';

function simpleUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

interface TelemarketingStore {
    taskLists: TaskList[];
    appointments: Appointment[];
    callLogs: CallLog[];
    loadData: (date?: string) => Promise<void>;
    generateTaskList: (teamKey: string, date: string, items: Omit<TaskListItem, 'id' | 'status'>[]) => Promise<void>;
    addCallLog: (log: Omit<CallLog, 'id' | 'timestamp'>) => Promise<void>;
    addAppointment: (appointment: Omit<Appointment, 'id' | 'createdAt'>, selectedTaskEntries?: SelectedTaskEntry[]) => Promise<void>;
    addDirectAppointment: (appointment: Omit<Appointment, 'id' | 'createdAt'>, selectedTaskEntries: SelectedTaskEntry[]) => Promise<void>;
    updateTaskListItemStatus: (taskListId: string, itemId: string, status: TaskListItem['status'], outcome?: TelemarketingOutcomeCode) => Promise<void>;
    getTaskList: (teamKey: string, date: string) => TaskList | undefined;
    getAppointmentsForTeamDate: (teamKey: string, date: string) => Appointment[];
    getBookedSlots: (teamKey: string, date: string) => Set<string>;
    getCallHistory: (entityType: 'candidate' | 'client', entityId: number) => CallLog[];
}

export const useTelemarketingStore = create<TelemarketingStore>((set, get) => ({
    taskLists: [],
    appointments: [],
    callLogs: [],

    loadData: async (date?: string) => {
        try {
            const snapshot = await api.telemarketing.snapshot(date);
            set({
                taskLists: snapshot.taskLists,
                appointments: snapshot.appointments,
                callLogs: snapshot.callLogs,
            });
        } catch (error) {
            console.error('Failed to load telemarketing data:', error);
            set({ taskLists: [], appointments: [], callLogs: [] });
        }
    },

    generateTaskList: async (teamKey, date, newItems) => {
        const taskList: TaskList = {
            id: simpleUUID(),
            teamKey,
            date,
            items: newItems.map((item) => ({
                ...item,
                id: simpleUUID(),
                status: 'pending' as const,
            })),
            createdAt: new Date().toISOString(),
        };

        try {
            const saved = await api.telemarketing.upsertTaskList(taskList);
            set((state) => ({
                taskLists: [
                    ...state.taskLists.filter((list) => !(list.teamKey === teamKey && list.date === date)),
                    saved,
                ],
            }));
        } catch (error) {
            console.error('Failed to generate telemarketing task list:', error);
        }
    },

    addCallLog: async (logInput) => {
        const newLog: CallLog = {
            ...logInput,
            id: simpleUUID(),
            timestamp: new Date().toISOString(),
        };

        const saved = await api.telemarketing.createCallLog(newLog);
        set((state) => ({ callLogs: [saved, ...state.callLogs] }));
    },

    addAppointment: async (appointmentInput, selectedTaskEntries) => {
        const isBooked = get().appointments.some(
            (appointment) =>
                appointment.teamKey === appointmentInput.teamKey &&
                appointment.date === appointmentInput.date &&
                appointment.timeSlot === appointmentInput.timeSlot,
        );

        if (isBooked) {
            throw new Error('هذا الموعد محجوز مسبقاً للفريق في نفس الوقت.');
        }

        let saved: Appointment;

        if (appointmentInput.entityType === 'client') {
            const selectedOpenTasks = (selectedTaskEntries ?? [])
                .filter((entry) => entry.openTaskId != null)
                .map((entry) => ({
                    openTaskId: entry.openTaskId!,
                    taskType: entry.taskType,
                }));

            if (selectedOpenTasks.length === 0) {
                throw new Error('لا يمكن حجز موعد دون مهمة مفتوحة مرتبطة.');
            }

            const result = await api.telemarketing.bookVisit({
                clientId: appointmentInput.entityId,
                date: appointmentInput.date,
                timeSlot: appointmentInput.timeSlot,
                teamKey: appointmentInput.teamKey,
                taskListId: appointmentInput.taskListId,
                taskListItemId: appointmentInput.taskListItemId,
                selectedOpenTasks,
                customerSnapshot: {
                    name: appointmentInput.customerName,
                    mobile: appointmentInput.customerMobile,
                    addressText: appointmentInput.customerAddress,
                    occupation: appointmentInput.occupation,
                    waterSource: appointmentInput.waterSource,
                },
                notes: appointmentInput.notes,
            });

            saved = {
                ...appointmentInput,
                id: `fv_${result.fieldVisitId}`,
                createdAt: new Date().toISOString(),
                contactTargetId: result.contactTargetId ?? appointmentInput.contactTargetId,
                marketingVisitId: String(result.fieldVisitId),
            };
        } else {
            const newAppointment: Appointment = {
                ...appointmentInput,
                id: simpleUUID(),
                createdAt: new Date().toISOString(),
            };
            const payload = selectedTaskEntries && selectedTaskEntries.length > 0
                ? { ...newAppointment, selectedOpenTasks: selectedTaskEntries }
                : newAppointment;
            saved = await api.telemarketing.createAppointment(payload);
        }

        set((state) => ({ appointments: [...state.appointments, saved] }));
    },

    addDirectAppointment: async (appointmentInput, selectedTaskEntries) => {
        const isBooked = get().appointments.some(
            (appointment) =>
                appointment.teamKey === appointmentInput.teamKey &&
                appointment.date === appointmentInput.date &&
                appointment.timeSlot === appointmentInput.timeSlot,
        );

        if (isBooked) {
            throw new Error('هذا الموعد محجوز مسبقا للفريق في نفس الوقت.');
        }

        const selectedOpenTasks = selectedTaskEntries
            .filter((entry) => entry.openTaskId != null)
            .map((entry) => ({
                openTaskId: entry.openTaskId!,
                taskType: entry.taskType,
            }));

        if (selectedOpenTasks.length === 0) {
            throw new Error('لا يمكن حجز موعد دون مهمة مفتوحة مرتبطة.');
        }

        const sourceTaskId = selectedOpenTasks[0].openTaskId;
        const result = await api.openTasks.scheduleFromExpected(sourceTaskId, {
            date: appointmentInput.date,
            timeSlot: appointmentInput.timeSlot,
            teamKey: appointmentInput.teamKey,
            taskListId: appointmentInput.taskListId,
            taskListItemId: appointmentInput.taskListItemId,
            taskListItemIds: selectedTaskEntries.map((entry) => entry.taskListItemId),
            contactTargetId: appointmentInput.contactTargetId ?? null,
            selectedOpenTasks,
            customerSnapshot: {
                name: appointmentInput.customerName,
                mobile: appointmentInput.customerMobile,
                addressText: appointmentInput.customerAddress,
                occupation: appointmentInput.occupation,
                waterSource: appointmentInput.waterSource,
            },
            notes: appointmentInput.notes,
        });

        const saved: Appointment = {
            ...appointmentInput,
            id: `fv_${result.fieldVisitId}`,
            createdAt: new Date().toISOString(),
            contactTargetId: result.contactTargetId ?? appointmentInput.contactTargetId,
            marketingVisitId: String(result.fieldVisitId),
        };

        set((state) => ({ appointments: [...state.appointments, saved] }));
    },

    updateTaskListItemStatus: async (taskListId, itemId, status, outcome) => {
        try {
            const updatedItem = await api.telemarketing.updateTaskListItem(taskListId, itemId, { status, callOutcome: outcome });
            set((state) => ({
                taskLists: state.taskLists.map((list) => {
                    if (list.id !== taskListId) return list;
                    return {
                        ...list,
                        items: list.items.map((item) => (item.id === itemId ? { ...item, ...updatedItem } : item)),
                    };
                }),
            }));
        } catch (error) {
            console.error('Failed to update telemarketing task item:', error);
        }
    },

    getTaskList: (teamKey, date) => get().taskLists.find((list) => list.teamKey === teamKey && list.date === date),

    getAppointmentsForTeamDate: (teamKey, date) =>
        get().appointments.filter((appointment) => appointment.teamKey === teamKey && appointment.date === date),

    getBookedSlots: (teamKey, date) =>
        new Set(
            get().appointments
                .filter((appointment) => appointment.teamKey === teamKey && appointment.date === date)
                .map((appointment) => appointment.timeSlot),
        ),

    getCallHistory: (entityType, entityId) =>
        get().callLogs
            .filter((log) => log.entityType === entityType && log.entityId === entityId)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
}));
