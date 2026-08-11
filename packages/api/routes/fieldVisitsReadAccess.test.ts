import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routeSource = readFileSync(new URL('./fieldVisits.ts', import.meta.url), 'utf8');

for (const route of ['pullable-tasks', 'referral-sheet', 'survey']) {
  test(`${route} inherits the parent visit read capability and subject guard`, () => {
    const declaration = (
      `router.get('/:id/${route}', `
      + `requirePermission('field_visits.view', 'field_visits.my_visits.view')`
    );
    const routeStart = routeSource.indexOf(declaration);
    assert.notEqual(routeStart, -1, `missing capability declaration for ${route}`);

    const nextRoute = routeSource.indexOf('\nrouter.', routeStart + declaration.length);
    const handlerSource = routeSource.slice(
      routeStart,
      nextRoute === -1 ? routeSource.length : nextRoute,
    );
    assert.match(handlerSource, /canReadFieldVisitWorkspace/);
  });
}
