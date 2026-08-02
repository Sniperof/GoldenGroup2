import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./SystemSettings.tsx', import.meta.url), 'utf8');

test('system settings exposes the web-login device policy with its safe off-state', () => {
    assert.match(source, /web_login_allowed_team_slots/);
    assert.match(source, /الحاسوب مسموح دائماً/);
    assert.match(source, /إزالة جميع الاختيارات توقف التقييد/);
    assert.match(source, /دون استثناء لمدير النظام/);
});

test('web-login policy is hidden by default and toggled through the header gear', () => {
    assert.match(source, /useState\(false\).*showDeveloperSettings|showDeveloperSettings.*useState\(false\)/s);
    assert.match(source, /aria-label="تبديل إعدادات المطور"/);
    assert.match(source, /onClick=\{\(\) => setShowDeveloperSettings\(visible => !visible\)\}/);
    assert.match(source, /\{showDeveloperSettings && <motion\.div/);
});

test('web-login policy choices use role team slots rather than textual role names', () => {
    for (const slot of ['SUPERVISOR', 'TECHNICIAN', 'TRAINEE', 'TELEMARKETER']) {
        assert.match(source, new RegExp(`value: '${slot}'`));
    }
    assert.match(source, /api\.systemSettings\.update\('web_login_allowed_team_slots', webLoginSlots\)/);
});
