
import fs from 'node:fs';
import { Pool } from 'pg';
import { buildCustomerOwnershipSql, buildCustomerOwnershipSelectColumns } from './services/customerOwnership.ts';

const envText = fs.readFileSync('/opt/golden-crm/apps/staging/.env', 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  if (process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^['\"]|['\"]$/g, '');
  }
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = `
SELECT ot.id, ot.status AS "taskStatus", ot.branch_id AS "taskBranchId",
       c.name AS "clientName",
       c.branch_id AS "clientBranchId",
       b.name AS "taskBranchName",
       cb.name AS "clientBranchName",
       COALESCE(creator.name, creator.username, '') AS "createdByName",
       ${buildCustomerOwnershipSelectColumns()},
       ot.created_at AS "createdAt"
FROM open_tasks ot
JOIN clients c ON c.id = ot.client_id
LEFT JOIN branches b ON b.id = ot.branch_id
LEFT JOIN branches cb ON cb.id = c.branch_id
LEFT JOIN hr_users creator ON creator.id = ot.created_by
${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'cb.name' })}
WHERE ot.id IN (2,3,4)
ORDER BY ot.id;
`;
  const { rows } = await pool.query(sql);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
