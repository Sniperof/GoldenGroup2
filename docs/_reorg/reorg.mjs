#!/usr/bin/env node
// docs/ reorganization — step A (moves + archive + deletes + link repair).
// Source of truth: docs/_reorg/phase-0-inventory.csv (approved 2026-09-28).
//
//   node docs/_reorg/reorg.mjs            → dry-run: writes docs/_reorg/dry-run-report.md, touches nothing else
//   node docs/_reorg/reorg.mjs --apply    → git mv / git rm + rewrite references (no commit)
//
// Rules:
//   delete            → git rm
//   merge             → untouched here (manual, step B)
//   anything else     → git mv when target differs from path
// References repaired: markdown links (relative), repo-rooted paths (docs/...), base-relative paths
// in text (relative to the file, docs/constitution/, or docs/), bare basenames of renamed files,
// plus a short list of explicit code patches. migrations/ are immutable → report only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(ROOT);
const P = path.posix;
const MEMORY_DIR = path.join(os.homedir(), '.claude/projects/C--Users-Obaid-OneDrive------------GoldenGroup2/memory');
const REORG_DIR = 'docs/_reorg/';

// ---------- inventory ----------
function parseCsv(s) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const [head, ...body] = parseCsv(fs.readFileSync(REORG_DIR + 'phase-0-inventory.csv', 'utf8').replace(/^﻿/, ''));
const inv = body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));

const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=off', ...a], { encoding: 'utf8', maxBuffer: 1e9 });
const tracked = git('ls-files').split('\n').filter(Boolean);
const oldSet = new Set(tracked);

const moves = new Map();   // old → new
const deletes = new Set();
const errors = [];
for (const r of inv) {
  if (!oldSet.has(r.path)) { errors.push(`inventory path not tracked: ${r.path}`); continue; }
  if (r.action === 'delete') deletes.add(r.path);
  else if (r.action !== 'merge' && r.target && r.target !== r.path) moves.set(r.path, r.target);
}
// validate targets
const newSet = new Set(tracked.filter(p => !moves.has(p) && !deletes.has(p)));
for (const [o, n] of moves) {
  if (newSet.has(n)) errors.push(`target collision: ${o} → ${n} (occupied)`);
  newSet.add(n);
}
const mapPath = p => (moves.has(p) ? moves.get(p) : p);

// directory map: an old dir whose every tracked file lands in one new dir
const dirMap = new Map();
{
  const byDir = new Map();
  for (const p of tracked) if (p.startsWith('docs/')) { const d = P.dirname(p); (byDir.get(d) ?? byDir.set(d, []).get(d)).push(p); }
  for (const [d, files] of byDir) {
    const dests = new Set(files.map(f => (deletes.has(f) ? null : P.dirname(mapPath(f)))).filter(Boolean));
    if (dests.size === 1) { const nd = [...dests][0]; if (nd !== d) dirMap.set(d, nd); }
  }
}

// renamed basenames that are unique among tracked docs → safe bare-token replacement
const renamedBase = new Map();
{
  const baseCount = new Map();
  for (const p of tracked) if (p.startsWith('docs/')) baseCount.set(P.basename(p), (baseCount.get(P.basename(p)) ?? 0) + 1);
  for (const [o, n] of moves) {
    const ob = P.basename(o), nb = P.basename(n);
    if (ob !== nb && baseCount.get(ob) === 1 && ob.toLowerCase() !== 'readme.md') renamedBase.set(ob, nb);
  }
}

const byBase = new Map();
for (const p of tracked) if (!p.startsWith(REORG_DIR) && !p.includes('node_modules/')) { const b = P.basename(p); (byBase.get(b) ?? byBase.set(b, []).get(b)).push(p); }

// ---------- reference rewriting ----------
const isText = p => /\.(md|mdx|txt|ts|tsx|mjs|cjs|js|json|sql|yml|yaml|example)$/i.test(p) || /(^|\/)(AGENTS|CLAUDE|README)\.md$/.test(p);
const REPORT_ONLY = p => p.startsWith('migrations/') || p.startsWith('.codex_tmp/') || p.startsWith('outputs/') || p.startsWith('scratch/');
const SKIP = p => p.startsWith(REORG_DIR) || p.includes('node_modules/') || p === 'pnpm-lock.yaml';

const CODE_PATCHES = [
  { file: 'scripts/audit-permissions.mjs', from: "path.join(root, 'docs', 'analysis')", to: "path.join(root, 'docs', 'engineering', 'audits')" },
];

const bases = fileOld => [
  { name: 'file', dir: P.dirname(fileOld) },
  { name: 'constitution', dir: 'docs/constitution' },
  { name: 'docs', dir: 'docs' },
  { name: 'repo', dir: '.' },
];
const existsOld = p => oldSet.has(p) || dirMap.has(p) || [...oldSet].some(x => x.startsWith(p + '/'));
const norm = p => P.normalize(p).replace(/^\.\//, '');
const safeDecode = s => { try { return decodeURI(s); } catch { return s; } };
const encodeLike = (orig, s) => (/%20/.test(orig) ? s.replace(/ /g, '%20') : s);
const relFrom = (fromDir, to) => { let r = P.relative(fromDir, to); if (!r.startsWith('.')) r = r || '.'; return r; };

function rewriteContent(fileOld, text, stats) {
  const fileNew = mapPath(fileOld);
  const newDir = P.dirname(fileNew), oldDir = P.dirname(fileOld);
  const isDoc = fileOld.startsWith('docs/') && /\.mdx?$/.test(fileOld);
  const placeholders = [];
  const hold = s => { placeholders.push(s); return `\u0000${placeholders.length - 1}\u0000`; };

  // (a) markdown links — only in markdown docs
  if (/\.mdx?$/.test(fileOld)) {
    text = text.replace(/\]\((<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?)\)/g, (m, rawT, title) => {
      const angled = rawT.startsWith('<');
      const t = angled ? rawT.slice(1, -1) : rawT;
      if (/^(https?:|mailto:|#|\/|[A-Za-z]:[\\/])/i.test(t)) return m;
      const [pthLine, anchor] = t.split(/(?=#)/);
      const lm = pthLine.match(/^(.*?\.[A-Za-z0-9]+)(:\d+(?:-\d+)?)$/);   // file.ts:543
      const pth = lm ? lm[1] : pthLine, lineSuffix = lm ? lm[2] : '';
      const dec = safeDecode(pth);
      const abs = norm(P.join(oldDir, dec));
      // outside docs/ only links that point at a moved/deleted docs file are touched
      if (!fileOld.startsWith('docs/') && !moves.has(abs) && !deletes.has(abs) && !dirMap.has(abs.replace(/\/$/, ''))) return m;
      let target;
      if (moves.has(abs)) target = moves.get(abs);
      else if (deletes.has(abs)) { stats.linksToDeleted.push(`${fileOld} → ${t}`); return hold(m); }
      else if (dirMap.has(abs.replace(/\/$/, ''))) target = dirMap.get(abs.replace(/\/$/, '')) + (dec.endsWith('/') ? '/' : '');
      else if (existsOld(abs.replace(/\/$/, ''))) target = abs;
      else {
        // pre-existing broken link: repair only when the basename is unique in the repo
        const cands = byBase.get(P.basename(abs)) ?? [];
        if (cands.length === 1 && !deletes.has(cands[0])) { target = mapPath(cands[0]); stats.repaired.push(`${fileOld} → ${t}  ⇒  ${target}`); }
        else { stats.preBroken.push(`${fileOld} → ${t}`); return hold(m); }
      }
      let rel = relFrom(newDir, target.replace(/\/$/, '')) + (target.endsWith('/') ? '/' : '');
      if (dec.startsWith('./') && !rel.startsWith('.')) rel = './' + rel;
      rel = encodeLike(pth, rel) + lineSuffix + (anchor ?? '');
      if (angled || / /.test(rel)) rel = /%20/.test(pth) ? rel : `<${rel}>`;
      const out = `](${rel}${title})`;
      if (out !== m) stats.links++;
      return hold(out);
    });
  }

  // (b) repo-rooted paths, longest first (exact string)
  const rooted = [...moves.keys()].sort((a, b) => b.length - a.length);
  for (const o of rooted) {
    for (const variant of [o, o.replace(/ /g, '%20')]) {
      if (!text.includes(variant)) continue;
      const n = moves.get(o);
      const parts = text.split(variant);
      stats.rooted += parts.length - 1;
      text = parts.join(hold(variant.includes('%20') ? n.replace(/ /g, '%20') : n));
    }
  }
  for (const [od, nd] of [...dirMap].sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(od.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(?=[\\s`\'")\\]]|$)', 'g');
    text = text.replace(re, () => { stats.rooted++; return hold(nd + '/'); });
  }

  // (c) base-relative paths in doc prose/backticks: tokens with a slash ending in a known extension
  if (isDoc) {
    text = text.replace(/(?<![\w/.\-])((?:\.\.?\/)*(?:[\w\-&]+\/)+[\w\-. &]*?[\w\-]\.(?:md|csv|pdf|pptx|xlsx))(?![\w/])/g, (m) => {
      for (const b of bases(fileOld)) {
        const abs = norm(P.join(b.dir, m));
        if (!oldSet.has(abs)) continue;
        if (!moves.has(abs)) { if (b.name === 'file' && oldDir !== newDir) { const r = relFrom(newDir, abs); stats.relative++; return hold(r); } return m; }
        const n = moves.get(abs);
        let out;
        if (b.name === 'file') out = relFrom(newDir, n);
        else if (b.name === 'repo') out = n;
        else out = n.startsWith(b.dir + '/') ? n.slice(b.dir.length + 1) : n;
        stats.relative++;
        return hold(out);
      }
      return m;
    });
  }

  // (d) bare basenames of renamed files
  for (const [ob, nb] of renamedBase) {
    const re = new RegExp(`(?<![\\w\\-./])${ob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w\\-])`, 'g');
    text = text.replace(re, () => { stats.bare++; return hold(nb); });
  }

  // explicit code patches
  for (const cp of CODE_PATCHES) if (cp.file === fileOld && text.includes(cp.from)) { text = text.split(cp.from).join(cp.to); stats.patches++; }

  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[+i]);
}

// ---------- scan ----------
const report = { files: [], preBroken: [], linksToDeleted: [], reportOnly: [], memory: [], postBroken: [], repaired: [], newBroken: [] };
const writes = [];
for (const f of tracked) {
  if (SKIP(f) || !isText(f) || deletes.has(f)) continue;
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const stats = { links: 0, rooted: 0, relative: 0, bare: 0, patches: 0, preBroken: [], linksToDeleted: [], repaired: [] };
  const out = rewriteContent(f, text, stats);
  report.preBroken.push(...stats.preBroken); report.repaired.push(...stats.repaired);
  report.linksToDeleted.push(...stats.linksToDeleted);
  if (out === text) continue;
  const n = stats.links + stats.rooted + stats.relative + stats.bare + stats.patches;
  if (REPORT_ONLY(f)) { report.reportOnly.push(`${f} (${n})`); continue; }
  report.files.push({ file: f, to: mapPath(f), ...stats, total: n });
  writes.push({ from: f, to: mapPath(f), text: out });
}
// memory files (outside repo)
const memWrites = [];
if (!process.env.NO_MEMORY && fs.existsSync(MEMORY_DIR)) for (const m of fs.readdirSync(MEMORY_DIR)) {
  const fp = path.join(MEMORY_DIR, m); const text = fs.readFileSync(fp, 'utf8');
  const stats = { links: 0, rooted: 0, relative: 0, bare: 0, patches: 0, preBroken: [], linksToDeleted: [], repaired: [] };
  const out = rewriteContent('memory/' + m, text, stats);
  if (out !== text) { report.memory.push(`${m} (${stats.rooted + stats.bare})`); memWrites.push({ fp, text: out }); }
}

const preKeys = new Set([...report.preBroken, ...report.linksToDeleted]);
// post-check: every relative md link in rewritten/moved docs must resolve in the new tree
const newTree = new Set(newSet);
const newDirs = new Set([...newTree].flatMap(p => { const a = []; let d = P.dirname(p); while (d && d !== '.') { a.push(d); d = P.dirname(d); } return a; }));
const finalText = new Map(writes.map(w => [w.to, w.text]));
for (const p of newTree) {
  if (!/\.mdx?$/.test(p) || !p.startsWith('docs/') || p.startsWith(REORG_DIR)) continue;
  const oldP = [...moves].find(([, n]) => n === p)?.[0] ?? p;
  const text = finalText.get(p) ?? (fs.existsSync(oldP) ? fs.readFileSync(oldP, 'utf8') : '');
  for (const m of text.matchAll(/\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let t = m[1].startsWith('<') ? m[1].slice(1, -1) : m[1];
    if (/^(https?:|mailto:|#|\/)/i.test(t)) continue;
    const abs = norm(P.join(P.dirname(p), safeDecode(t.split('#')[0].replace(/:\d+(?:-\d+)?$/, '')))).replace(/\/$/, '');
    if (!newTree.has(abs) && !newDirs.has(abs)) { const key = `${oldP} → ${t}`; report.postBroken.push(`${p} → ${t}`); if (!preKeys.has(key)) report.newBroken.push(`${p} → ${t}`); }
  }
}
const preBrokenCount = report.preBroken.length;

// ---------- output ----------
const summary = {
  moves: moves.size, deletes: deletes.size, filesRewritten: writes.length, memoryFiles: memWrites.length,
  links: report.files.reduce((a, f) => a + f.links, 0), rooted: report.files.reduce((a, f) => a + f.rooted, 0),
  relative: report.files.reduce((a, f) => a + f.relative, 0), bare: report.files.reduce((a, f) => a + f.bare, 0),
  patches: report.files.reduce((a, f) => a + f.patches, 0), preBroken: preBrokenCount, postBroken: report.postBroken.length,
  linksToDeleted: report.linksToDeleted.length, repairedPreBroken: report.repaired.length, NEW_BROKEN: report.newBroken.length, errors: errors.length,
};
const byTop = {}; for (const [, n] of moves) { const k = n.split('/').slice(0, 3).join('/'); byTop[k] = (byTop[k] ?? 0) + 1; }
const md = [
  `# docs reorg — step A ${APPLY ? 'APPLY' : 'dry-run'} report`, '',
  `Generated ${new Date().toISOString()}`, '',
  '## Summary', '', '```json', JSON.stringify(summary, null, 2), '```', '',
  errors.length ? '## ❌ Errors\n\n' + errors.map(e => `- ${e}`).join('\n') + '\n' : '',
  '## Moves by destination', '', '| destination | files |', '|---|---|', ...Object.entries(byTop).sort().map(([k, v]) => `| \`${k}\` | ${v} |`), '',
  '## Deletes', '', ...[...deletes].map(d => `- \`${d}\``), '',
  '## Renamed basenames (bare-token replacement)', '', ...[...renamedBase].map(([o, n]) => `- \`${o}\` → \`${n}\``), '',
  '## Directory remaps', '', ...[...dirMap].map(([o, n]) => `- \`${o}/\` → \`${n}/\``), '',
  '## Files whose references change', '', '| file | links | rooted | relative | bare | patch |', '|---|---|---|---|---|---|',
  ...report.files.sort((a, b) => b.total - a.total).map(f => `| \`${f.file}\`${f.to !== f.file ? ` → \`${f.to}\`` : ''} | ${f.links} | ${f.rooted} | ${f.relative} | ${f.bare} | ${f.patches} |`), '',
  `## ❗ NEW broken links caused by the move (${report.newBroken.length}) — must be 0`, '', ...report.newBroken.map(x => `- ${x}`), '',
  `## Pre-broken links auto-repaired by unique basename (${report.repaired.length})`, '', ...report.repaired.map(x => `- ${x}`), '',
  `## Links still broken after the move (${report.postBroken.length}) — pre-existing`, '', ...report.postBroken.map(x => `- ${x}`), '',
  `## Links already broken BEFORE the move (${preBrokenCount}) — left untouched`, '', ...report.preBroken.map(x => `- ${x}`), '',
  `## Links pointing to deleted files (${report.linksToDeleted.length})`, '', ...report.linksToDeleted.map(x => `- ${x}`), '',
  '## Report-only (not modified: migrations / temp dirs)', '', ...report.reportOnly.map(x => `- \`${x}\``), '',
  '## Memory files to update (outside repo)', '', ...report.memory.map(x => `- ${x}`), '',
  '## Full move list', '', '| from | to |', '|---|---|', ...[...moves].map(([o, n]) => `| \`${o}\` | \`${n}\` |`), '',
].join('\n');
fs.writeFileSync(REORG_DIR + (APPLY ? 'apply-report.md' : 'dry-run-report.md'), md);
console.log(JSON.stringify(summary, null, 2));

if (!APPLY) process.exit(errors.length ? 1 : 0);
if (errors.length || report.newBroken.length) { console.error('refusing to apply: errors or new broken links'); process.exit(1); }

// ---------- apply ----------
for (const [o, n] of moves) { fs.mkdirSync(path.dirname(n), { recursive: true }); git('mv', o, n); }
for (const w of writes) fs.writeFileSync(w.to, w.text);
for (const d of deletes) git('rm', '-q', d);
for (const m of memWrites) fs.writeFileSync(m.fp, m.text);
// prune empty dirs under docs
const prune = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name)); if (d !== 'docs' && fs.readdirSync(d).length === 0) fs.rmdirSync(d); };
prune('docs');
git('add', '-A', 'docs', ...writes.map(w => w.to).filter(p => !p.startsWith('docs/')));
console.log('applied — review with: git status && git diff --cached --stat');
