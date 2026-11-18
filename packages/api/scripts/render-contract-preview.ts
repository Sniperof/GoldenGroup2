// Dev preview: render a contract's legal copy to an HTML file WITHOUT freezing
// it (the printable route freezes an approved contract on first read).
//   tsx packages/api/scripts/render-contract-preview.ts <contractId> <outFile> [--as-branch <branchId>]
// --as-branch renders the same contract as if it belonged to another branch
// (handy to preview a branch's address / contacts / courts).
import fs from 'node:fs';
import pool from '../db.js';
import { loadContractForRender } from '../routes/contractDocuments.js';
import { renderContract } from '../services/contractRenderer.js';

const args = process.argv.slice(2);
const [idArg, outFile] = args;
const asBranchIdx = args.indexOf('--as-branch');
const asBranch = asBranchIdx >= 0 ? Number(args[asBranchIdx + 1]) : null;
const contractId = Number(idArg);
if (!Number.isInteger(contractId) || !outFile) {
  console.error('usage: render-contract-preview.ts <contractId> <outFile> [--as-branch <branchId>]');
  process.exit(1);
}
const bundle = await loadContractForRender(pool, contractId);
if (!bundle) { console.error('contract not found'); process.exit(1); }

if (asBranch) {
  const { rows } = await pool.query(
    `SELECT name, detailed_address, contact_info, location_geo_id FROM branches WHERE id = $1`, [asBranch],
  );
  const b = rows[0];
  if (b) {
    const { rows: geo } = await pool.query(
      `WITH RECURSIVE p AS (SELECT id, name, parent_id, 1 d FROM geo_units WHERE id = $1
         UNION ALL SELECT g.id, g.name, g.parent_id, p.d + 1 FROM geo_units g JOIN p ON g.id = p.parent_id)
       SELECT name FROM p ORDER BY d DESC`, [b.location_geo_id],
    );
    Object.assign(bundle.contract, {
      branchName: b.name,
      branchAddress: b.detailed_address,
      branchContacts: Array.isArray(b.contact_info) ? b.contact_info : [],
      branchGeoPath: geo.map((r: any) => r.name),
    });
  }
}

const { html, templateKey, templateVersion } = renderContract({
  contract: bundle.contract,
  client: bundle.client,
  lineItems: bundle.lineItems,
  paymentEntries: bundle.paymentEntries,
  discount: bundle.discount,
  installments: bundle.installments,
  gifts: bundle.gifts,
  draftWatermark: bundle.contract.status === 'draft',
});
fs.writeFileSync(outFile, html, 'utf8');
console.log(`${templateKey}.${templateVersion} → ${outFile}`);
await pool.end();
