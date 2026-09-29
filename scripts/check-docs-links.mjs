#!/usr/bin/env node
// Check that relative links in the active docs resolve.
//
//   node scripts/check-docs-links.mjs            → broken file links fail (exit 1); broken anchors are warnings
//   node scripts/check-docs-links.mjs --strict   → broken anchors fail too
//   node scripts/check-docs-links.mjs --all      → also scan docs/archive/ (history; informational)
//
// Active docs = every *.md under docs/ except docs/archive/ and docs/_reorg/.
// A link "resolves" when its target file/directory exists; for *.md targets with a
// #fragment, the fragment must match a heading slug (GitHub rules, incl. -1/-2 suffixes).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STRICT = process.argv.includes('--strict');
const ALL = process.argv.includes('--all');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);
const P = path.posix;

const files = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-co', '--exclude-standard', 'docs'], { encoding: 'utf8' })
  .split('\n')
  .filter(f => f.endsWith('.md') && !f.startsWith('docs/_reorg/') && (ALL || !f.startsWith('docs/archive/')));

const slugCache = new Map();
function headingSlugs(file) {
  if (slugCache.has(file)) return slugCache.get(file);
  const seen = new Map();
  const slugs = new Set();
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    const m = !inFence && line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = m[1].toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n ? `${base}-${n}` : base);
  }
  slugCache.set(file, slugs);
  return slugs;
}

const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const broken = [], anchors = [];
let checked = 0;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');   // ignore fenced code
  for (const m of text.matchAll(/\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = m[1].startsWith('<') ? m[1].slice(1, -1) : m[1];
    if (/^(https?:|mailto:|tel:|data:)/i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw)) continue;
    checked++;
    const [pathPart, fragment] = raw.split('#');
    const target = pathPart
      ? P.normalize(P.join(P.dirname(file), safeDecode(pathPart.replace(/:\d+(?:-\d+)?$/, '')))).replace(/\/$/, '')
      : file;
    if (!fs.existsSync(target)) { broken.push(`${file} → ${raw}`); continue; }
    if (fragment && target.endsWith('.md') && !/^L\d+/.test(fragment) && !headingSlugs(target).has(safeDecode(fragment).toLowerCase())) {
      anchors.push(`${file} → ${raw}`);
    }
  }
}

const print = (title, list) => { if (list.length) console.log(`\n${title} (${list.length}):\n` + list.map(x => `  ${x}`).join('\n')); };
print('❌ Broken links', broken);
print(STRICT ? '❌ Broken anchors' : '⚠️  Broken anchors (warning; --strict to fail)', anchors);
console.log(`\nchecked ${checked} links in ${files.length} files${ALL ? ' (incl. archive)' : ''}: ${broken.length} broken, ${anchors.length} bad anchors`);
process.exit(broken.length || (STRICT && anchors.length) ? 1 : 0);
