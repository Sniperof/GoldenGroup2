import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    isVisitTimeConflict,
    selectVisitTimeValidationTimes,
} from './VisitTimePicker.js';

test('time validation freezes the pre-submit occupancy snapshot while saving', () => {
    const beforeSubmit = ['09:00'];
    const afterCommit = ['09:00', '10:30'];

    const validationTimes = selectVisitTimeValidationTimes(
        afterCommit,
        beforeSubmit,
        true,
    );

    assert.equal(isVisitTimeConflict('10:30', validationTimes), false);
    assert.equal(isVisitTimeConflict('09:00', validationTimes), true);
});

test('time validation resumes live occupancy after submitting ends', () => {
    const validationTimes = selectVisitTimeValidationTimes(
        ['09:00', '10:30'],
        ['09:00'],
        false,
    );

    assert.equal(isVisitTimeConflict('10:30', validationTimes), true);
});

test('both booking dialogs freeze their time picker while saving', () => {
    const outcomeModal = readFileSync(
        new URL('./OutcomeRecorderModal.tsx', import.meta.url),
        'utf8',
    );
    const schedulerModal = readFileSync(
        new URL('./AppointmentSchedulerModal.tsx', import.meta.url),
        'utf8',
    );

    assert.match(outcomeModal, /<VisitTimePicker[\s\S]*?submitting=\{saving\}/);
    assert.match(schedulerModal, /<VisitTimePicker[\s\S]*?submitting=\{saving\}/);
});

test('booking dialogs leave the editable state at the commit boundary', () => {
    const workspace = readFileSync(
        new URL('../../pages/TelemarketerWorkspace.tsx', import.meta.url),
        'utf8',
    );
    const inlineStart = workspace.indexOf('// ── Inline appointment booking');
    const inlineEnd = workspace.indexOf('// ── Normal flow for all other outcomes');
    const inlineBooking = workspace.slice(inlineStart, inlineEnd);
    const schedulerStart = workspace.indexOf('// ── Appointment save handler');
    const schedulerEnd = workspace.indexOf('// ── Manual close handler');
    const schedulerBooking = workspace.slice(schedulerStart, schedulerEnd);

    assert.ok(inlineStart >= 0 && inlineEnd > inlineStart);
    assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart);
    assert.ok(
        inlineBooking.indexOf('await addAppointment') <
        inlineBooking.indexOf('setIsOutcomeModalOpen(false)'),
    );
    assert.ok(
        inlineBooking.indexOf('setIsOutcomeModalOpen(false)') <
        inlineBooking.indexOf('await updateWorkspaceClient'),
    );
    assert.ok(
        schedulerBooking.indexOf('await addAppointment') <
        schedulerBooking.indexOf('setIsAppointmentModalOpen(false)'),
    );
    assert.ok(
        schedulerBooking.indexOf('setIsAppointmentModalOpen(false)') <
        schedulerBooking.indexOf('await updateWorkspaceClient'),
    );
});
