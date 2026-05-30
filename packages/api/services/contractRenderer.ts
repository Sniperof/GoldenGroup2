// DEC-CT-14 / DEC-CT-15: printable contract rendering and freezing.
//
// Design choices:
//
//   - Templates live in code (packages/api/templates/contracts/*.v{N}.html)
//     and are version-tagged in the filename. The version is recorded in
//     contract_documents.template_version so future amendments keep
//     traceable provenance.
//
//   - We use a tiny mustache-subset substitution: {{var}}, {{#section}}…
//     {{/section}}, and raw HTML insertion for table rows. No external
//     dependency — the templates are short and we control them.
//
//   - PDF generation is out of scope for the first release. The frozen
//     artifact is the HTML + its SHA-256. PDF can be derived on demand
//     by any browser/print-to-PDF without changing the legal canon.
//
//   - For draft contracts we render but do NOT freeze, and we inject a
//     "مسودة غير معتمدة" watermark. The route enforces this; the renderer
//     just accepts a `draftWatermark: boolean` flag.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates', 'contracts');

// Resolve a (templateKey, version) pair to the on-disk template path.
// templateKey examples: 'sale_definitive', 'sale_gift', 'sale_temporary'.
function templatePath(key: string, version: string): string {
  return path.join(TEMPLATES_DIR, `${key}.${version}.html`);
}

/** Currently-active version for each template. Bump when the template changes. */
export const ACTIVE_TEMPLATE_VERSION: Record<string, string> = {
  sale_definitive: 'v1',
  // Add other sale types when their templates land.
};

/**
 * Decide which template applies for a given contract.
 * Today only sale_definitive is implemented; gift/temporary will follow.
 */
export function templateKeyForContract(contract: { saleSubtype?: string | null; contractType?: string | null }): string | null {
  if (contract.contractType && contract.contractType !== 'sale_contract') return null; // DEC-CT-02: maintenance moved out
  switch (contract.saleSubtype) {
    case 'definitive':
    case undefined:
    case null:
      return 'sale_definitive';
    case 'temporary':
    case 'free':
      return null; // not yet implemented — caller should surface a friendly error
    default:
      return null;
  }
}

// ─── Tiny mustache-subset renderer ────────────────────────────────────────

type Vars = Record<string, string | number | boolean | null | undefined>;

/** Replace {{key}} with the value (HTML-escaped). Unknown keys are blanked. */
function applyVars(input: string, vars: Vars): string {
  return input.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_m, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return escapeHtml(String(v));
  });
}

/**
 * Resolve {{#section}}…{{/section}} blocks.
 * The block is kept verbatim when the section flag is truthy, removed otherwise.
 * Note: must run *before* applyVars so {{var}} inside a kept section is rendered.
 */
function applySections(input: string, sections: Record<string, boolean>): string {
  return input.replace(
    /{{#([a-zA-Z][a-zA-Z0-9_]*)}}([\s\S]*?){{\/\1}}/g,
    (_m, name, body) => (sections[name] ? body : ''),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Public rendering API ─────────────────────────────────────────────────

export interface RenderContractInput {
  contract: any;                       // contract row + joined details
  installments?: Array<{ installmentNumber: number; dueDate: string; amountSyp: number }>;
  draftWatermark?: boolean;
}

export interface RenderContractResult {
  templateKey: string;
  templateVersion: string;
  html: string;
  contentHash: string; // SHA-256 hex of html
}

export function renderContract(input: RenderContractInput): RenderContractResult {
  const { contract, installments = [], draftWatermark = false } = input;

  const key = templateKeyForContract(contract);
  if (!key) {
    throw new Error(`لا يوجد قالب متاح لنوع العقد هذا (saleSubtype=${contract.saleSubtype})`);
  }
  const version = ACTIVE_TEMPLATE_VERSION[key];
  const file = templatePath(key, version);

  if (!fs.existsSync(file)) {
    throw new Error(`قالب العقد غير موجود على القرص: ${file}`);
  }
  let html = fs.readFileSync(file, 'utf8');

  // Render installment table rows. Kept as raw HTML — we control the data.
  const installmentsRows = installments
    .map(i => `<tr><td>${i.installmentNumber}</td><td>${escapeHtml(String(i.dueDate))}</td><td>${escapeHtml(String(i.amountSyp))} ل.س</td></tr>`)
    .join('');

  const sections = {
    draftWatermark,
    installmentsSection: installments.length > 0,
    periodicVisitsSection: Number(contract.warrantyVisits) > 0,
  };
  html = applySections(html, sections);

  const vars: Vars = {
    contractNumber:           contract.contractNumber ?? '',
    contractDate:             contract.contractDate ?? '',
    customerName:             contract.customerName ?? '',
    buyerMotherName:          contract.buyerMotherName ?? '',
    closingEmployeeName:      contract.closingEmployeeName ?? '— لم يُعتمد بعد —',
    deviceModelName:          contract.deviceModelName ?? '',
    serialNumber:             contract.serialNumber ?? '',
    installationAddressText:  contract.installationAddressText ?? '',
    basePrice:                contract.basePrice ?? '',
    finalPrice:               contract.finalPrice ?? '',
    paymentType:              contract.paymentType === 'cash' ? 'دفعة واحدة' : 'أقساط',
    warrantyVisits:           contract.warrantyVisits ?? '',
    installmentsRows,          // pre-escaped HTML block
  };

  // installmentsRows is raw HTML and must not pass through applyVars (which escapes).
  // Substitute it first by a unique placeholder swap so applyVars leaves it alone.
  const ROWS_TOKEN = '\x00INSTALLMENT_ROWS_PLACEHOLDER\x00';
  html = html.replace('{{installmentsRows}}', ROWS_TOKEN);
  html = applyVars(html, vars);
  html = html.replace(ROWS_TOKEN, installmentsRows);

  const contentHash = crypto.createHash('sha256').update(html, 'utf8').digest('hex');

  return { templateKey: key, templateVersion: version, html, contentHash };
}
