import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getOutcomeSaveErrorMessage } from './outcomeSaveError.js';

test('save errors retain a useful message and have a localized fallback', () => {
    assert.equal(
        getOutcomeSaveErrorMessage(new Error('هذا الموعد محجوز مسبقاً للفريق في نفس الوقت.')),
        'هذا الموعد محجوز مسبقاً للفريق في نفس الوقت.',
    );
    assert.equal(
        getOutcomeSaveErrorMessage({ status: 500 }),
        'تعذر حفظ نتيجة التواصل. تحقق من البيانات وحاول مجدداً.',
    );
});

test('the outcome modal catches rejected saves and renders an in-context alert', () => {
    const modal = readFileSync(
        new URL('./OutcomeRecorderModal.tsx', import.meta.url),
        'utf8',
    );

    assert.match(modal, /catch \(error\) \{\s*setSaveError\(getOutcomeSaveErrorMessage\(error\)\);/);
    assert.match(modal, /role="alert"/);
    assert.match(modal, /aria-live="assertive"/);
});

test('shared modal consumers reject failures instead of swallowing them', () => {
    const workspace = readFileSync(
        new URL('../../pages/TelemarketerWorkspace.tsx', import.meta.url),
        'utf8',
    );
    const clientProfile = readFileSync(
        new URL('../../pages/ClientProfile.tsx', import.meta.url),
        'utf8',
    );
    const bookingStart = workspace.indexOf('// Filter out tasks with no linked openTaskId');
    const bookingEnd = workspace.indexOf('// The visit is committed.');
    const bookingFailurePath = workspace.slice(bookingStart, bookingEnd);

    assert.ok(bookingStart >= 0 && bookingEnd > bookingStart);
    assert.match(bookingFailurePath, /catch \(err: any\) \{\s*throw new Error\(/);
    assert.doesNotMatch(bookingFailurePath, /setCallLogSaveError/);
    assert.match(clientProfile, /catch \(err: any\) \{[\s\S]*?throw err instanceof Error/);
});
