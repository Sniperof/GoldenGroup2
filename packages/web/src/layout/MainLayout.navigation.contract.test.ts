import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MainLayout.tsx', import.meta.url), 'utf8');

test('drawer exposes the approved eight-section information architecture', () => {
  const labels = [
    'الرئيسية',
    'المبيعات والزبائن',
    'الخدمة الميدانية',
    'الهدايا',
    'الأجهزة والمخزون',
    'الموارد البشرية',
    'التقارير',
    'الإدارة والإعدادات',
  ];

  for (const label of labels) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
  assert.match(source, /\.filter\(section => section\.items\.length > 0\)/);
  assert.match(source, /function groupDrawerItems/);
  assert.match(source, /border-r-2/);
  assert.match(source, /rounded-full ring-2 ring-white/);
});

test('drawer keeps precise route matching and restores collapsed sections on click', () => {
  assert.match(source, /path: '\/', label: 'لوحة المتابعة'.*exact: true/);
  assert.match(source, /path: '\/service-requests', label: 'طلبات الخدمة'.*exact: true/);
  assert.match(source, /path: '\/service-requests\/water-check', label: 'طلبات فحص المياه'.*exact: true/);
  assert.match(source, /if \(isCollapsed\)[\s\S]*setIsCollapsed\(false\)[\s\S]*add\(sectionId\)/);
  assert.match(source, /useEffect\([\s\S]*add\(activeSectionId\)/);
  assert.match(source, /sessionStorage\.setItem\(DRAWER_OPEN_SECTIONS_KEY/);
});

test('drawer retains permission gates while regrouping links', () => {
  for (const permission of [
    'tasks.my_customers.view',
    'field_visits.my_visits.view',
    'telemarketing.lists.view',
    'service_requests.view',
    'tasks.gifts.view',
    'installed_devices.view',
    'reports.',
    'admin.roles.view',
  ]) {
    assert.ok(source.includes(permission), `missing permission gate: ${permission}`);
  }
});
