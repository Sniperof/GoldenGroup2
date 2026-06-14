import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['migrations', 'packages/api', 'packages/web/src'];
const codeExtensions = new Set(['.ts', '.tsx', '.sql']);
const outputDir = path.join(root, 'docs', 'analysis');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return codeExtensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function csv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function addUsage(map, permission, usage) {
  if (!permission || !permission.includes('.')) return;
  map.set(permission, [...(map.get(permission) ?? []), usage]);
}

const files = scanRoots.flatMap((dir) => walk(path.join(root, dir)));
const catalogs = new Map();
const usages = new Map();
const endpoints = [];

// Supports both migration tuples with an explicit numeric id and tuples without one.
const catalogTuple = /\(\s*(?:\d+\s*,\s*)?'([a-z0-9_.-]+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(?:ARRAY\[([^\]]*)\]|'\{([^}]*)\}')/g;
const callPatterns = [
  { kind: 'backend_guard', mode: 'list', regex: /requirePermission\(([^)]*)\)/g },
  { kind: 'frontend_check', mode: 'direct', regex: /(?:hasPermission|getPermissionScope|canAccessAdminSurface|can)\(\s*['"]([a-z0-9_.-]+)['"]\s*\)/g },
  { kind: 'frontend_check', mode: 'list', regex: /hasAnyPermission\(([^)]*)\)/g },
  { kind: 'frontend_check', mode: 'direct', regex: /<PermissionGate\s+permission=['"]([a-z0-9_.-]+)['"]/g },
  { kind: 'frontend_check', mode: 'list', regex: /<PermissionGate\s+anyOf=\{\[([^\]]*)\]\}/g },
  { kind: 'backend_authorize', mode: 'direct', regex: /permission\s*:\s*'([a-z0-9_.-]+)'/g },
];

for (const file of files) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const rel = relative(file);

  if (rel.startsWith('migrations/')) {
    for (const match of sourceText.matchAll(catalogTuple)) {
      const [raw, key, module, subModule, action, displayName, displayOrder, arrayScopes, braceScopes] = match;
      const scopes = (arrayScopes ?? braceScopes ?? '')
        .split(',')
        .map((item) => item.replaceAll("'", '').trim())
        .filter(Boolean);
      const definitions = catalogs.get(key)?.definitions ?? [];
      definitions.push({ file: rel, line: lineNumber(sourceText, match.index), raw });
      catalogs.set(key, {
        key,
        module,
        subModule,
        action,
        displayName,
        displayOrder: Number(displayOrder),
        scopes,
        definitions,
      });
    }
  }

  for (const pattern of callPatterns) {
    for (const match of sourceText.matchAll(pattern.regex)) {
      const captured = match[1] ?? '';
      const keys = pattern.mode === 'direct'
        ? [captured]
        : [...captured.matchAll(/['"]([a-z0-9_.-]+)['"]/g)].map((item) => item[1]);

      for (const key of keys) {
        addUsage(usages, key, {
          kind: rel === 'packages/web/src/layout/MainLayout.tsx' ? 'sidebar' : pattern.kind,
          file: rel,
          line: lineNumber(sourceText, match.index),
          expression: match[0].replace(/\s+/g, ' ').slice(0, 220),
        });
      }
    }
  }

  if (rel.startsWith('packages/api/routes/')) {
    const routePattern = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*requirePermission\(([^)]*)\)/g;
    for (const match of sourceText.matchAll(routePattern)) {
      endpoints.push({
        method: match[1].toUpperCase(),
        route: match[2],
        permissions: [...match[3].matchAll(/'([a-z0-9_.-]+)'/g)].map((item) => item[1]),
        file: rel,
        line: lineNumber(sourceText, match.index),
      });
    }
  }
}

const allKeys = [...new Set([...catalogs.keys(), ...usages.keys()])].sort();
const inventory = allKeys.map((key) => {
  const catalog = catalogs.get(key);
  const keyUsages = usages.get(key) ?? [];
  return {
    key,
    catalog,
    keyUsages,
    backend: keyUsages.filter((usage) => usage.kind.startsWith('backend')),
    frontend: keyUsages.filter((usage) => usage.kind === 'frontend_check'),
    sidebar: keyUsages.filter((usage) => usage.kind === 'sidebar'),
  };
});

const undefinedUsages = inventory.filter((item) => !item.catalog && item.keyUsages.length > 0);
const unusedCatalog = inventory.filter((item) => item.catalog && item.keyUsages.length === 0);
const duplicateDefinitions = inventory.filter((item) => (item.catalog?.definitions.length ?? 0) > 1);
const frontendOnly = inventory.filter((item) => item.catalog && item.frontend.length > 0 && item.backend.length === 0);
const backendOnly = inventory.filter((item) => item.catalog && item.backend.length > 0 && item.frontend.length === 0 && item.sidebar.length === 0);
const multiPermissionEndpoints = endpoints.filter((endpoint) => endpoint.permissions.length > 1);

fs.mkdirSync(outputDir, { recursive: true });

const inventoryCsv = [
  ['permission', 'defined', 'module', 'sub_module', 'action', 'allowed_scopes', 'definition_count', 'backend_uses', 'frontend_uses', 'sidebar_uses', 'files'],
  ...inventory.map((item) => [
    item.key,
    item.catalog ? 'yes' : 'no',
    item.catalog?.module ?? '',
    item.catalog?.subModule ?? '',
    item.catalog?.action ?? '',
    item.catalog?.scopes.join('|') ?? '',
    item.catalog?.definitions.length ?? 0,
    item.backend.length,
    item.frontend.length,
    item.sidebar.length,
    [...new Set(item.keyUsages.map((usage) => usage.file))].join('|'),
  ]),
].map((row) => row.map(csv).join(',')).join('\n');

const endpointCsv = [
  ['method', 'route', 'permissions', 'file', 'line'],
  ...endpoints.map((endpoint) => [endpoint.method, endpoint.route, endpoint.permissions.join('|'), endpoint.file, endpoint.line]),
].map((row) => row.map(csv).join(',')).join('\n');

fs.writeFileSync(path.join(outputDir, 'permission-inventory.csv'), `${inventoryCsv}\n`);
fs.writeFileSync(path.join(outputDir, 'permission-endpoints.csv'), `${endpointCsv}\n`);

function listItems(items, formatter) {
  return items.length === 0 ? '- None found.' : items.map((item) => `- ${formatter(item)}`).join('\n');
}

const locations = (items) => items.slice(0, 4).map((item) => `\`${item.file}:${item.line}\``).join(', ');
const report = `# Permission System Inventory

> Generated by \`node scripts/audit-permissions.mjs\`.
> This is a static inventory of code and migrations. It does not change runtime behavior.

## Summary

| Metric | Count |
|---|---:|
| Permissions defined in migrations | ${catalogs.size} |
| Permission keys used in code | ${usages.size} |
| Used keys with no visible definition | ${undefinedUsages.length} |
| Defined keys with no visible usage | ${unusedCatalog.length} |
| Keys defined more than once | ${duplicateDefinitions.length} |
| Frontend-only permission checks | ${frontendOnly.length} |
| Backend-only permission checks | ${backendOnly.length} |
| Endpoints accepting alternative permissions | ${multiPermissionEndpoints.length} |

## Used But Not Defined

${listItems(undefinedUsages, (item) => `\`${item.key}\` - ${locations(item.keyUsages)}`)}

## Duplicate Definitions

${listItems(duplicateDefinitions, (item) => `\`${item.key}\` - ${locations(item.catalog.definitions)}`)}

## Defined With No Visible Usage

${listItems(unusedCatalog, (item) => `\`${item.key}\` - ${item.catalog.displayName}`)}

## Frontend Checks Without Matching Backend Checks

> Review candidates only. Some permissions intentionally control page visibility.

${listItems(frontendOnly, (item) => `\`${item.key}\` - ${locations(item.frontend.concat(item.sidebar))}`)}

## Backend Checks Without Visible Frontend Checks

> These can be valid for internal actions or UIs that rely on a 403 response.

${listItems(backendOnly, (item) => `\`${item.key}\` - ${locations(item.backend)}`)}

## Endpoints With Alternative Permissions

${listItems(multiPermissionEndpoints, (endpoint) => `\`${endpoint.method} ${endpoint.route}\` - ${endpoint.permissions.map((permission) => `\`${permission}\``).join(' or ')} - \`${endpoint.file}:${endpoint.line}\``)}

## Detail Files

- \`docs/analysis/permission-inventory.csv\`: each permission, definition, and detected usage.
- \`docs/analysis/permission-endpoints.csv\`: protected endpoints and their permissions.

## Inventory Limits

- The scan detects direct string patterns; dynamically composed permission keys may not appear.
- Alternative permissions are recorded for review, not automatically classified as incorrect.
- Live database state may differ when migrations have not all been applied.
`;

fs.writeFileSync(path.join(outputDir, 'permission-inventory.md'), report);

console.log(JSON.stringify({
  catalogPermissions: catalogs.size,
  usedPermissionKeys: usages.size,
  undefinedUsages: undefinedUsages.length,
  unusedCatalog: unusedCatalog.length,
  duplicateDefinitions: duplicateDefinitions.length,
  frontendOnly: frontendOnly.length,
  backendOnly: backendOnly.length,
  multiPermissionEndpoints: multiPermissionEndpoints.length,
  report: 'docs/analysis/permission-inventory.md',
}, null, 2));
