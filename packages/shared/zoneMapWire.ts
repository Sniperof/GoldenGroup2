import type { ZoneMapColumnKey, ZoneMapResponse, ZoneMapTaskItem } from './types.js';

// Compact transport for GET /api/planning/zone-map. A branch can have tens of
// thousands of open tasks; as objects they repeat every key and every per-type
// field (label, column, countsBy) on each row (~10 MB for 30k tasks). On the
// wire a task is a fixed-position tuple and per-type fields are sent once.
// The server encodes with toZoneMapWire; the web client decodes with
// fromZoneMapWire back to ZoneMapResponse, so nothing else changes.

export interface ZoneMapWireType {
    type: string;
    label: string;
    column: ZoneMapColumnKey;
    countsBy: 'client' | 'device';
}

// [taskId, typeIndex, clientId, clientName, geoUnitId, deviceId, deviceLabel,
//  statusIndex, dueDate, followUpDate, attemptCount, expectedAmount,
//  ownerHrUserIds, overdue (0|1)]
export type ZoneMapWireTask = [
    number, number, number, string, number | null, number | null, string | null,
    number, string | null, string | null, number, number | null, number[], 0 | 1,
];

export interface ZoneMapWireResponse extends Omit<ZoneMapResponse, 'tasks'> {
    wire: 1;
    taskTypes: ZoneMapWireType[];
    statuses: string[];
    tasks: ZoneMapWireTask[];
}

export function toZoneMapWire(data: ZoneMapResponse): ZoneMapWireResponse {
    const typeIndex = new Map<string, number>();
    const taskTypes: ZoneMapWireType[] = [];
    const statusIndex = new Map<string, number>();
    const statuses: string[] = [];
    const tasks = data.tasks.map((t): ZoneMapWireTask => {
        let ti = typeIndex.get(t.taskType);
        if (ti == null) {
            ti = taskTypes.length;
            typeIndex.set(t.taskType, ti);
            taskTypes.push({ type: t.taskType, label: t.taskLabel, column: t.column, countsBy: t.countsBy });
        }
        let si = statusIndex.get(t.status);
        if (si == null) {
            si = statuses.length;
            statusIndex.set(t.status, si);
            statuses.push(t.status);
        }
        return [
            t.taskId, ti, t.clientId, t.clientName, t.geoUnitId, t.deviceId, t.deviceLabel,
            si, t.dueDate, t.followUpDate, t.attemptCount, t.expectedAmount, t.ownerHrUserIds, t.overdue ? 1 : 0,
        ];
    });
    return { ...data, wire: 1, taskTypes, statuses, tasks };
}

export function fromZoneMapWire(wire: ZoneMapWireResponse): ZoneMapResponse {
    const { wire: _v, taskTypes, statuses, tasks, ...rest } = wire;
    return {
        ...rest,
        tasks: tasks.map((w): ZoneMapTaskItem => {
            const type = taskTypes[w[1]];
            return {
                taskId: w[0],
                taskType: type.type,
                taskLabel: type.label,
                column: type.column,
                countsBy: type.countsBy,
                clientId: w[2],
                clientName: w[3],
                geoUnitId: w[4],
                deviceId: w[5],
                deviceLabel: w[6],
                status: statuses[w[7]],
                dueDate: w[8],
                followUpDate: w[9],
                attemptCount: w[10],
                expectedAmount: w[11],
                ownerHrUserIds: w[12],
                overdue: w[13] === 1,
            };
        }),
    };
}
