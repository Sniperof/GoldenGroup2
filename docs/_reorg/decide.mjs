// usage: node docs/_reorg/decide.mjs '<json array of {path, ...fields}>'  — patches rows of phase-0-inventory.csv
import fs from 'node:fs';
const F = 'docs/_reorg/phase-0-inventory.csv';
function parseCsv(s) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const [head, ...body] = parseCsv(fs.readFileSync(F, 'utf8').replace(/^\uFEFF/, ''));
const rows = body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
for (const p of JSON.parse(process.argv[2])) {
  const r = rows.find(x => x.path === p.path); if (!r) throw new Error('no row ' + p.path);
  Object.assign(r, p);
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
fs.writeFileSync(F, '\uFEFF' + [head.join(','), ...rows.map(r => head.map(k => esc(r[k])).join(','))].join('\r\n'));
console.log('updated', JSON.parse(process.argv[2]).length);
