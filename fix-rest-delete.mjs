import { readFileSync, writeFileSync } from 'fs';

const path = 'packages/api/routes/roles.ts';
let content = readFileSync(path, 'utf8');

// ── 1. Fix GET /roles: filter is_hidden for non-super-admins ─────────────────
// The current query does NOT filter is_hidden. We need to add it.
// Anchor: the conditions array + WHERE clause construction
const oldGetConditions = `    conditions.push('r.is_template = TRUE');
    if (!includeLegacy) {
      conditions.push(\`r.name NOT LIKE 'job_title_%'\`);
      conditions.push(\`r.name NOT LIKE 'DEV_%'\`);
    }`;

const newGetConditions = `    conditions.push('r.is_template = TRUE');
    if (!includeLegacy) {
      conditions.push(\`r.name NOT LIKE 'job_title_%'\`);
      conditions.push(\`r.name NOT LIKE 'DEV_%'\`);
    }
    // Hidden roles (e.g. SYSTEM_ADMIN) are only visible to super-admins
    if (!authContext.isSuperAdmin) {
      conditions.push('(r.is_hidden = FALSE OR r.is_hidden IS NULL)');
    }`;

if (!content.includes(oldGetConditions)) {
  console.error('GET CONDITIONS MARKER NOT FOUND');
  process.exit(1);
}
content = content.replace(oldGetConditions, newGetConditions);
console.log('GET /roles filter: OK');

// ── 2. Fix loadRoleForScope: include is_protected + is_hidden ─────────────────
const oldLoadRole = `  const { rows } = await pool.query(
    'SELECT id, name, is_system, is_template, branch_id FROM roles WHERE id = $1',
    [roleId]
  );`;

const newLoadRole = `  const { rows } = await pool.query(
    'SELECT id, name, is_system, is_protected, is_hidden, protected_reason, is_template, branch_id FROM roles WHERE id = $1',
    [roleId]
  );`;

if (!content.includes(oldLoadRole)) {
  console.error('LOAD ROLE MARKER NOT FOUND');
  process.exit(1);
}
content = content.replace(oldLoadRole, newLoadRole);
console.log('loadRoleForScope: OK');

// ── 3. Fix DELETE /roles/:id: add is_protected guard ─────────────────────────
// Anchor on the ASCII-only is_system check in the REST delete handler
const startMarker = '    if (role.is_system) return res.status(400).json(';
const endMarker   = '    if (!canWriteRole(authContext, role)) {\n      return res.status(403).json(';

const startIdx = content.indexOf(startMarker);
if (startIdx === -1) { console.error('REST DELETE START MARKER NOT FOUND'); process.exit(1); }
// Find end of the is_system line
const endOfLine = content.indexOf('\n', startIdx) + 1;

const newDeleteGuard = `    // Guard: system or explicitly protected roles cannot be deleted
    if (role.is_system || role.is_protected) {
      const reason = (role.protected_reason as string | null) ?? '';
      return res.status(400).json({
        error: reason
          ? \`لا يمكن حذف هذا الدور — \${reason}\`
          : 'لا يمكن حذف هذا الدور — دور نظامي أو محمي',
      });
    }
    `;

content = content.substring(0, startIdx) + newDeleteGuard + content.substring(endOfLine);
console.log('DELETE /roles/:id guard: OK');

writeFileSync(path, content, 'utf8');
console.log('All REST changes applied');
