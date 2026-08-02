import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppointmentAreaLabel, getAppointmentDisplayKey, getVisitExecutionStatusMeta } from './TeamAgendaPanel';

test('appointment display key remains stable when API time includes seconds', () => {
    const common = {
        entityId: 42,
        teamKey: 'team_2',
        date: '2026-08-03',
    };

    assert.equal(
        getAppointmentDisplayKey({ ...common, timeSlot: '09:30:00' }),
        getAppointmentDisplayKey({ ...common, timeSlot: '09:30' }),
    );
});

test('appointment display key distinguishes teams and visit dates', () => {
    const base = {
        entityId: 42,
        teamKey: 'team_2',
        date: '2026-08-03',
        timeSlot: '09:30',
    };

    assert.notEqual(
        getAppointmentDisplayKey(base),
        getAppointmentDisplayKey({ ...base, teamKey: 'team_3' }),
    );
    assert.notEqual(
        getAppointmentDisplayKey(base),
        getAppointmentDisplayKey({ ...base, date: '2026-08-04' }),
    );
});

test('visit execution labels distinguish booking from field completion', () => {
    assert.equal(getVisitExecutionStatusMeta('scheduled').label, 'بانتظار التنفيذ');
    assert.equal(getVisitExecutionStatusMeta('completed').label, 'تم تنفيذ الزيارة');
    assert.equal(getVisitExecutionStatusMeta('not_completed').label, 'تعذر إتمام الزيارة');
});

test('appointment area label uses the deepest two geographic levels', () => {
    assert.equal(getAppointmentAreaLabel({
        workLocationPath: ['دمشق', 'ريف دمشق', 'جرمانا', 'البلدية'],
    } as any), 'جرمانا، البلدية');
    assert.equal(getAppointmentAreaLabel({ workLocationName: 'المزة' } as any), 'المزة');
    assert.equal(getAppointmentAreaLabel({} as any), 'منطقة غير محددة');
});
