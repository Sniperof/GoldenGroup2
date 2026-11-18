// DEC-CT-14 / DEC-CT-15: printable contract rendering and freezing.
//
// Design choices:
//
//   - Templates live in code (packages/api/templates/contracts/*.v{N}.html)
//     and are version-tagged in the filename. The version is recorded in
//     contract_documents.template_version so future amendments keep
//     traceable provenance.
//
//   - We use a tiny mustache-subset substitution: {{var}}, {{#section}}...
//     {{/section}}, and raw HTML insertion for table rows. No external
//     dependency; the templates are short and we control them.
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
const __dirname = path.dirname(__filename);

import { sypInWords } from './arabicNumberWords.js';

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates', 'contracts');

function templatePath(key: string, version: string): string {
  return path.join(TEMPLATES_DIR, `${key}.${version}.html`);
}

// v3 (2026-11-18): the customer's contract wording merged into the full legal
// articles — sale type, branch address/phones, WhatsApp number, serial, USD
// equivalents, discount reason, accessories without price, service fees, down
// payment method/currency, late penalty, gift promises, undertakings, notes,
// branch-governorate courts and the PDF/app clause. Frozen copies keep the
// version they were rendered with (contract_documents.template_version).
export const ACTIVE_TEMPLATE_VERSION: Record<string, string> = {
  sale_definitive: 'v3',
  sale_temporary: 'v3',
  sale_free: 'v3',
  // ملحق تثبيت البيعة: يُجمَّد عند تسوية عقد التجربة. الأصل (عقد الحيازة
  // المؤقتة) يبقى بلا مساس؛ الملحق وحده يحمل البنود المالية المتفق عليها.
  sale_settlement_amendment: 'v1',
};

/** مفتاح قالب ملحق تثبيت البيعة (تسوية عقد التجربة). */
export const SETTLEMENT_AMENDMENT_TEMPLATE_KEY = 'sale_settlement_amendment';

export function templateKeyForContract(contract: { saleSubtype?: string | null; contractType?: string | null }): string | null {
  if (contract.contractType && contract.contractType !== 'sale_contract') return null;
  switch (contract.saleSubtype) {
    case 'definitive':
    case undefined:
    case null:
      return 'sale_definitive';
    case 'temporary':
      return 'sale_temporary';
    case 'free':
      return 'sale_free';
    default:
      return null;
  }
}

type Vars = Record<string, string | number | boolean | null | undefined>;

function applyVars(input: string, vars: Vars): string {
  return input.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_m, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return escapeHtml(String(v));
  });
}

function applySections(input: string, sections: Record<string, boolean>): string {
  // Repeat until stable: a kept outer section returns its body untouched, so
  // nested sections (e.g. usdLinkedSection inside installmentsSection) need
  // another pass — a single pass printed them literally.
  let out = input;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(
      /{{#([a-zA-Z][a-zA-Z0-9_]*)}}([\s\S]*?){{\/\1}}/g,
      (_m, name, body) => (sections[name] ? body : ''),
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RenderContractInput {
  contract: any;
  client?: any | null;
  lineItems?: any[];
  paymentEntries?: any[];
  discount?: any | null;
  installments?: Array<{ installmentNumber: number; dueDate: string; amountSyp: number; remainingBalance?: number; status?: string; amountUsd?: number | string | null }>;
  /** Gift promises of the contract (v3 «وعود الهدايا»). */
  gifts?: Array<{ giftName?: string | null; quantity?: number | string | null; conditionLabel?: string | null; beneficiaryType?: string | null; beneficiaryName?: string | null }>;
  draftWatermark?: boolean;
  /**
   * Render a specific template instead of the one derived from saleSubtype.
   * The settlement amendment needs this because it is rendered against a
   * contract whose subtype has already flipped to `definitive`.
   */
  templateKey?: string;
}

export interface RenderContractResult {
  templateKey: string;
  templateVersion: string;
  html: string;
  contentHash: string;
}

function formatDate(dateLike: unknown): string {
  if (!dateLike) return '';
  const s = String(dateLike);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function formatMoney(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

function paymentTypeLabel(paymentType: unknown): string {
  switch (paymentType) {
    case 'cash':
      return 'نقدي';
    case 'installment':
      return 'تقسيط';
    default:
      return String(paymentType ?? '');
  }
}

function paymentMethodLabel(method: unknown): string {
  switch (method) {
    case 'cash':
      return 'نقدي';
    case 'bank':
      return 'حوالة بنكية';
    case 'transfer':
      return 'تحويل';
    case 'barter':
      return 'مقايضة';
    default:
      return String(method ?? '');
  }
}

function contactTypeLabel(type: unknown): string {
  switch (type) {
    case 'mobile':
      return 'موبايل';
    case 'landline':
      return 'هاتف ثابت';
    case 'other':
      return 'آخر';
    default:
      return 'رقم';
  }
}

function buildCustomerContactRows(client: any | null | undefined): string {
  const contacts = Array.isArray(client?.contacts) ? client.contacts : [];
  if (!contacts.length) {
    return client?.mobile ? `- موبايل: ${client.mobile}` : '';
  }
  return contacts
    .map((entry: any) => {
      const label = entry?.label?.trim() || contactTypeLabel(entry?.type);
      const number = [entry?.areaCode, entry?.number].filter(Boolean).join(' ');
      return `- ${label}: ${number}`;
    })
    .join('\n');
}

function buildContractItemsSummary(lineItems: any[] = []): string {
  if (!lineItems.length) return 'لا توجد بنود إضافية مثبتة على هذا العقد.';
  return lineItems
    .map((item) => {
      const description = item?.description || item?.itemType || 'بند';
      const quantity = Number(item?.quantity || 0);
      return `- ${description}${quantity > 0 ? ` (الكمية: ${quantity})` : ''}`;
    })
    .join('\n');
}

function buildIncludedComponentsText(lineItems: any[] = []): string {
  if (!lineItems.length) return '- الجهاز الأساسي وفق البيانات المثبتة في هذا العقد.';
  return lineItems
    .map((item) => {
      const description = item?.description || item?.itemType || 'بند';
      const installedText = item?.isInstalled === false ? 'غير مركب' : 'مركب/مشمول';
      return `- ${description} — ${installedText}`;
    })
    .join('\n');
}

function buildInstallmentsSummaryText(installments: any[] = []): string {
  if (!installments.length) return 'لا توجد أقساط على هذا العقد.';
  return installments
    .map((inst) => `- القسط ${inst.installmentNumber}: ${formatMoney(inst.amountSyp)} ل.س بتاريخ ${formatDate(inst.dueDate)}`)
    .join('\n');
}

// USD link (migr 493) — wording approved by the owner (D9). The rounding unit
// (fx_collection_rounding_unit) is passed in by the loader as fxRoundingUnit.
function buildUsdLinkText(contract: any): string {
  const rate = Number(contract?.usdRateSnapshot);
  if (!(rate > 0)) return '';
  const unit = Number(contract?.fxRoundingUnit);
  const rounding = unit > 0 ? `، ويُقرَّب المبلغ المستحق لأقرب ${formatMoney(unit)} ل.س` : '';
  return `قيمة كل قسط محددة بالدولار الأمريكي كما في جدول الاستحقاقات، على أساس سعر صرف قدره ${formatMoney(rate)} ل.س للدولار الواحد، وتُسدَّد الأقساط بالليرة السورية بما يعادل المتبقي منها بالدولار وفق سعر الصرف المعتمد لدى الشركة يوم الدفع${rounding}.`;
}

function buildPaymentClauseText(contract: any, installments: any[] = []): string {
  const downPayment = Number(contract?.downPayment || 0);
  const remainingBalance = Number(contract?.remainingBalance || 0);
  if ((contract?.paymentType ?? '') === 'cash' || (remainingBalance <= 0 && downPayment > 0)) {
    return `تم سداد كامل قيمة العقد نقداً بمبلغ ${formatMoney(contract?.finalPrice)} ل.س عند توقيع هذا العقد.`;
  }
  if (downPayment > 0 && remainingBalance > 0 && installments.length > 0) {
    return `دفع الفريق الثاني مبلغاً أولياً قدره ${formatMoney(downPayment)} ل.س، وبقي مبلغ ${formatMoney(remainingBalance)} ل.س يسدد على أقساط وفق الجدول الملحق.`;
  }
  if (remainingBalance > 0 && installments.length > 0) {
    return `بقي مبلغ ${formatMoney(remainingBalance)} ل.س يسدد على أقساط وفق الجدول الملحق بهذا العقد.`;
  }
  return `طريقة السداد المعتمدة: ${paymentTypeLabel(contract?.paymentType)}.`;
}

// ── v3 helpers (customer wording, 2026-11-18) ───────────────────────────────

/** Late penalty per day of delay, in SYP — owner decision: fixed in the contract. */
export const LATE_PENALTY_PER_DAY_SYP = 1000;

const SALE_TYPE_LABELS: Record<string, string> = { direct: 'بيع مباشر', tradein: 'استبدال', retention: 'احتفاظ' };

function saleTypeText(contract: any): string {
  const type = SALE_TYPE_LABELS[String(contract?.saleType ?? '')] ?? String(contract?.saleType ?? '');
  const rawSource = String(contract?.saleSource ?? '').trim();
  const source = rawSource === 'device_demo_task' ? 'مهمة عرض جهاز' : rawSource;
  return source ? `${type} — المصدر: ${source}` : type;
}

function contractKindLabel(subtype: unknown): string {
  if (subtype === 'temporary') return 'مؤقت';
  if (subtype === 'free') return 'هدية';
  return 'قطعي';
}

function contactNumber(entry: any): string {
  return [entry?.areaCode, entry?.number].filter(Boolean).join(' ').trim();
}

/** Primary mobile (WhatsApp flag) + the other numbers, from clients.contacts. */
function buildCustomerPhones(client: any): { primary: string; whatsapp: string; others: string } {
  const contacts = (Array.isArray(client?.contacts) ? client.contacts : [])
    .filter((c: any) => contactNumber(c) && c?.status !== 'invalid');
  const primary = contacts.find((c: any) => c?.isPrimary) ?? contacts.find((c: any) => c?.type === 'mobile') ?? null;
  const primaryNumber = primary ? contactNumber(primary) : String(client?.mobile ?? '');
  const others = contacts
    .filter((c: any) => c !== primary && contactNumber(c) !== primaryNumber)
    .map((c: any) => `${contactNumber(c)} (${c?.label?.trim() || contactTypeLabel(c?.type)})`);
  return {
    primary: primaryNumber,
    whatsapp: primary?.hasWhatsApp ? ' (يدعم واتساب)' : '',
    others: others.length ? others.join(' — ') : 'لا يوجد',
  };
}

const BRANCH_CONTACT_LABELS: Record<string, string> = {
  mobile: 'موبايل', phone: 'هاتف', email: 'بريد إلكتروني', website: 'الموقع',
};
const BRANCH_CONTACT_ORDER = ['mobile', 'phone', 'email', 'website'];

/**
 * The branch's own contact means (Branches page → contact_info:
 * [{ type, value, label, department }]). A customer contract shows the
 * customer-service contacts; when the branch has none tagged so, all of them.
 */
function buildBranchPhones(contract: any): string {
  const all = (Array.isArray(contract?.branchContacts) ? contract.branchContacts : [])
    .filter((e: any) => String(e?.value ?? '').trim() || contactNumber(e));
  const service = all.filter((e: any) => e?.department === 'customer_service');
  const picked = (service.length ? service : all)
    .slice()
    .sort((a: any, b: any) => BRANCH_CONTACT_ORDER.indexOf(a?.type) - BRANCH_CONTACT_ORDER.indexOf(b?.type));
  return picked
    .map((e: any) => {
      const label = String(e?.label ?? '').trim() || BRANCH_CONTACT_LABELS[String(e?.type)] || 'تواصل';
      return `${label}: ${String(e?.value ?? '').trim() || contactNumber(e)}`;
    })
    .join(' — ');
}

/**
 * Detailed installation address. When none was entered and the installation
 * place is the customer's own registered area, the customer's detailed
 * address is used (and said so); otherwise the gap is printed explicitly.
 */
function installationDetailText(contract: any, client: any): string {
  const own = String(contract?.installationAddressText ?? '').trim();
  if (own) return own;
  const installGeo = Number(contract?.installationGeoUnitId) || null;
  const clientGeo = Number(client?.neighborhood) || Number(client?.district) || null;
  const clientDetail = String(client?.detailedAddress ?? '').trim();
  if (installGeo && clientGeo && installGeo === clientGeo && clientDetail) {
    return `${clientDetail} (عنوان الزبون المسجل)`;
  }
  return 'لم يُدخَل';
}

/** Branch address: governorate → area → sub-area → neighbourhood (location) + detailed address. */
function buildBranchAddress(contract: any): string {
  const geo = Array.isArray(contract?.branchGeoPath) ? contract.branchGeoPath : [];
  const parts = [...geo, String(contract?.branchAddress ?? '').trim()].filter(Boolean);
  return parts.length ? parts.join(' — ') : '—';
}

/** Rate for the USD equivalents: the contract snapshot, else the rate on the contract date. */
function contractUsdRate(contract: any): number | null {
  const snap = Number(contract?.usdRateSnapshot);
  if (snap > 0) return snap;
  const day = Number(contract?.contractDateRate);
  return day > 0 ? day : null;
}

function usdText(amountSyp: number, rate: number | null): string {
  if (!rate || !(amountSyp > 0)) return '';
  return `ما يعادل ${(amountSyp / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} دولار أمريكي بسعر صرف ${formatMoney(rate)} ل.س للدولار`;
}

const PAYMENT_METHOD_TEXT: Record<string, string> = {
  cash: 'نقداً', usd_cash: 'نقداً', sham_cash: 'حوالة شام كاش', syriatel_cash: 'حوالة سيرياتيل كاش',
  mtn_cash: 'حوالة MTN كاش', alharam: 'حوالة الهرم', bank_transfer: 'حوالة بنكية', barter: 'مقايضة',
};

/** Signing (down) payment: net SYP received at signing + how it was paid. */
function buildDownPayment(paymentEntries: any[], rate: number | null) {
  const signing = paymentEntries.filter((e: any) => e?.installmentId == null);
  const net = signing.reduce((s: number, e: any) => s + (e?.entryType === 'refund' ? -1 : 1) * Number(e?.amountSyp || 0), 0);
  const lines = signing
    .filter((e: any) => e?.entryType !== 'refund')
    .map((e: any) => {
      const method = PAYMENT_METHOD_TEXT[String(e?.method)] ?? String(e?.method ?? '');
      if (e?.method === 'barter') return `${method}: ${e?.barterName ?? ''} بقيمة ${formatMoney(e?.barterValueSyp ?? e?.amountSyp)} ل.س`;
      if (String(e?.currency ?? '').toUpperCase() === 'USD') {
        return `${method} بالدولار: ${Number(e?.amountValue || 0).toLocaleString('en-US')} دولار بسعر صرف ${formatMoney(e?.exchangeRate)} ل.س = ${formatMoney(e?.amountSyp)} ل.س`;
      }
      return `${method} بالليرة السورية: ${formatMoney(e?.amountSyp)} ل.س`;
    });
  const paidInSyp = signing.some((e: any) => String(e?.currency ?? 'SYP').toUpperCase() !== 'USD' && e?.method !== 'barter');
  return {
    amount: Math.max(0, net),
    methodText: lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- لا توجد دفعة أولى',
    // «بما يعادل (دولار) في حال الدفع كان بالليرة السورية»
    usdText: paidInSyp ? usdText(Math.max(0, net), rate) : '',
  };
}

// ── v3 payment article: summary table + down-payment detail table ──────────
// Owner request 2026-11-18: first the contract value (SYP + USD), then the
// down payment as the customer actually paid it, then what remains; and the
// down payment broken down one row per payment, clearly.

function usdCell(amountSyp: number, rate: number | null): string {
  if (!rate) return '';
  return `${(amountSyp / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** Signing (down-payment) entries actually received (refunds excluded). */
function signingEntries(paymentEntries: any[]): any[] {
  return paymentEntries.filter((e: any) => e?.installmentId == null && e?.entryType !== 'refund');
}

export function buildPaymentSummaryRowsHtml(input: RenderContractInput): string {
  const { contract, paymentEntries = [], installments = [] } = input;
  const rate = contractUsdRate(contract);
  const finalPrice = Number(contract?.finalPrice || 0);
  const down = buildDownPayment(paymentEntries, rate);
  const installmentsTotal = installments.reduce((s: number, i: any) => s + Number(i?.amountSyp || 0), 0);
  const remaining = installments.length ? installmentsTotal : Math.max(0, finalPrice - down.amount);
  const usdLinked = installments.some((i: any) => i?.amountUsd != null);
  const remainingUsd = usdLinked && rate
    ? `${installments.reduce((s: number, i: any) => s + Number(i?.amountUsd || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
    : usdCell(remaining, rate);
  const row = (label: string, syp: number, usd: string, strong = false) => {
    const cls = strong ? ' class="strong"' : '';
    return `<tr${cls}><td>${escapeHtml(label)}</td><td>${escapeHtml(formatMoney(syp))} ل.س<div class="words">فقط ${escapeHtml(sypInWords(syp))}</div></td>${
      rate ? `<td dir="ltr">${escapeHtml(usd)}</td>` : ''
    }</tr>`;
  };
  return [
    row('قيمة العقد الإجمالية', finalPrice, usdCell(finalPrice, rate), true),
    row('الدفعة الأولى (المقبوضة عند التوقيع)', down.amount, usdCell(down.amount, rate)),
    row(installments.length ? 'المبلغ الباقي (يُسدَّد بالأقساط أدناه)' : 'المبلغ الباقي', remaining, remainingUsd, true),
  ].join('');
}

/**
 * «موضوع البيع» price table — money only, one row per amount (device price,
 * discount, price after discount, each service fee, total). The device's
 * identity lives in its own table so no row carries an empty money cell.
 */
export function buildPriceRowsHtml(input: RenderContractInput): string {
  const { contract, lineItems = [], discount } = input;
  const rate = contractUsdRate(contract);
  const basePrice = Number(contract?.basePrice || 0);
  const deviceLines = lineItems.filter((i: any) => i?.itemType === 'device');
  const deviceTotal = deviceLines.reduce((s: number, i: any) => s + Number(i?.totalPrice || 0), 0);
  const devicePrice = deviceLines.length ? deviceTotal : basePrice;
  const discountAmount = deviceLines.length ? Math.max(0, basePrice - deviceTotal) : 0;
  const listPrice = devicePrice + discountAmount;
  const row = (label: string, syp: number, opts: { strong?: boolean; minus?: boolean } = {}) => {
    const sign = opts.minus ? '− ' : '';
    return `<tr${opts.strong ? ' class="strong"' : ''}><td>${escapeHtml(label)}</td><td>${sign}${escapeHtml(formatMoney(syp))} ل.س<div class="words">فقط ${escapeHtml(sypInWords(syp))}</div></td>${
      rate ? `<td dir="ltr">${sign}${escapeHtml(usdCell(syp, rate))}</td>` : ''
    }</tr>`;
  };
  const rows = [row('سعر المنتج بتاريخ هذا العقد', listPrice)];
  if (discountAmount > 0) {
    rows.push(row(`حسم — السبب: ${discount?.label || 'حسم معتمد على الجهاز'}`, discountAmount, { minus: true }));
    rows.push(row('سعر المنتج بعد الحسم', devicePrice));
  }
  for (const fee of lineItems.filter((i: any) => i?.itemType === 'service_fee')) {
    const desc = String(fee?.description ?? '').trim();
    // The description often already says «رسوم خدمة» — don't print it twice.
    const label = !desc ? 'رسوم خدمة' : desc.includes('رسوم') ? desc : `رسوم خدمة — ${desc}`;
    rows.push(row(label, Number(fee?.totalPrice || 0)));
  }
  rows.push(row('القيمة الإجمالية النهائية للعقد', Number(contract?.finalPrice || 0), { strong: true }));
  return rows.join('');
}

export function buildDownPaymentRowsHtml(input: RenderContractInput): string {
  const { contract, paymentEntries = [] } = input;
  const rate = contractUsdRate(contract);
  const rows = signingEntries(paymentEntries).map((e: any, idx: number) => {
    const method = PAYMENT_METHOD_TEXT[String(e?.method)] ?? String(e?.method ?? '');
    const isUsd = String(e?.currency ?? '').toUpperCase() === 'USD' && e?.method !== 'barter';
    const syp = Number(e?.amountSyp || 0);
    let paid: string;
    if (e?.method === 'barter') paid = `${e?.barterName ?? 'مقايضة'}`;
    else if (isUsd) paid = `${Number(e?.amountValue || 0).toLocaleString('en-US')} $ (بسعر ${formatMoney(e?.exchangeRate)} ل.س)`;
    else paid = `${formatMoney(syp)} ل.س`;
    const usd = isUsd ? `${Number(e?.amountValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $` : usdCell(syp, rate);
    const ref = e?.referenceNumber ? ` — رقم ${e.referenceNumber}` : '';
    return `<tr><td>${idx + 1}</td><td>${escapeHtml(method + ref)}</td><td>${escapeHtml(paid)}</td><td>${escapeHtml(formatMoney(syp))} ل.س</td>${
      rate ? `<td dir="ltr">${escapeHtml(usd)}</td>` : ''
    }</tr>`;
  });
  return rows.join('');
}

/** «لمدة …» / «كل …»: شهر، شهرين، 3–10 أشهر، 11+ شهراً. */
function monthsPhrase(n: number): string {
  if (n === 1) return 'شهر';
  if (n === 2) return 'شهرين';
  if (!Number.isInteger(n) || (n >= 3 && n <= 10)) return `${n} أشهر`;
  return `${n} شهراً`;
}

function buildGiftsText(gifts: RenderContractInput['gifts'] = []): string {
  return (gifts ?? [])
    .filter((g) => g && (g.giftName || g.conditionLabel))
    .map((g) => {
      const qty = Number(g?.quantity) > 1 ? ` × ${Number(g?.quantity)}` : '';
      const who = g?.beneficiaryType && g.beneficiaryType !== 'contract_customer'
        ? ` (لصالح الوسيط${g?.beneficiaryName ? `: ${g.beneficiaryName}` : ''})`
        : '';
      const condition = g?.conditionLabel ? ` — الشرط: ${g.conditionLabel}` : '';
      return `- ${g?.giftName || 'هدية'}${qty}${who}${condition}`;
    })
    .join('\n');
}

function buildDraftNoticeText(contract: any, draftWatermark: boolean): string {
  if (draftWatermark || contract?.status === 'draft' || contract?.status === 'discarded') {
    return 'تنبيه: هذه النسخة مسودة غير معتمدة، ولا تمثل عقداً نافذاً من جهة الشركة ما لم يعتمدها موظف الإغلاق المختص.';
  }
  return '';
}

function buildSaleDefinitiveVars(input: RenderContractInput, installmentsRows: string): Vars {
  const { contract, client, lineItems = [], paymentEntries = [], installments = [], discount, draftWatermark = false } = input;
  const remainingBalance = Number(contract?.remainingBalance ?? installments.reduce((sum, inst) => sum + Number(inst?.remainingBalance || 0), 0));
  const firstCollectionEntry = paymentEntries.find((entry: any) => entry?.entryType !== 'refund');
  const discountLabel = discount?.label || '';
  const discountAmount = Math.max(Number(contract?.basePrice || 0) - Number(contract?.finalPrice || 0), 0);
  const clientGeoPath = Array.isArray(client?.geoPath) ? client.geoPath : [];
  const installationGeoPath = Array.isArray(contract?.installationGeoPath) ? contract.installationGeoPath : [];

  return {
    contractNumber: contract.contractNumber ?? '',
    contractDate: formatDate(contract.contractDate),
    customerName: contract.customerName ?? '',
    buyerMotherName: contract.buyerMotherName ?? client?.motherName ?? '',
    closingEmployeeName: contract.closingEmployeeName ?? '— لم يعتمد بعد —',
    deviceModelName: contract.deviceModelName ?? '',
    serialNumber: contract.serialNumber ?? '',
    installationAddressText: contract.installationAddressText ?? '',
    basePrice: formatMoney(contract.basePrice),
    finalPrice: formatMoney(contract.finalPrice),
    paymentType: contract.paymentType === 'cash' ? 'دفعة واحدة' : 'أقساط',
    warrantyVisits: contract.warrantyVisits ?? '',
    installmentsRows,

    contract_title:
      contract?.saleSubtype === 'temporary'
        ? 'عقد حيازة مؤقتة'
        : contract?.saleSubtype === 'free'
          ? 'عقد تمليك بلا مقابل'
          : 'عقد بيع قطعي',
    contract_number: contract.contractNumber ?? '',
    contract_date: formatDate(contract.contractDate),
    company_name: 'شركة غولدن غروب',
    company_representative_name: contract.closingEmployeeName ?? '— لم يعتمد بعد —',
    company_representative_title: contract.closingEmployeeTitle ?? '',
    draft_notice_text: buildDraftNoticeText(contract, draftWatermark),
    customer_full_name: client?.name || contract.customerName || '',
    customer_mother_name: contract.buyerMotherName ?? client?.motherName ?? '',
    customer_birth_date: formatDate(contract.buyerBirthDate ?? client?.birthDate),
    customer_national_id_number: client?.nationalId ?? '',
    customer_registry_record: contract.buyerNationalIdRegistry ?? client?.nationalIdRegistry ?? '',
    customer_id_issued_by: contract.buyerNationalIdIssuedBy ?? client?.nationalIdIssuedBy ?? '',
    customer_id_issue_date: formatDate(contract.buyerNationalIdIssueDate ?? client?.nationalIdIssueDate),
    customer_id_box: contract.buyerNationalIdBox ?? client?.nationalIdBox ?? '',
    customer_governorate: clientGeoPath[0] ?? '',
    customer_area: clientGeoPath[1] ?? '',
    customer_sub_area: clientGeoPath[2] ?? '',
    customer_neighborhood: clientGeoPath[3] ?? '',
    customer_detailed_address: client?.detailedAddress ?? '',
    customer_contact_rows: buildCustomerContactRows(client),
    device_name: contract.deviceModelName ?? '',
    device_quantity: '1',
    device_base_price_number: formatMoney(contract.basePrice),
    device_base_price_words: formatMoney(contract.basePrice),
    device_discount_label: discountLabel,
    device_discount_amount_number: formatMoney(discountAmount),
    device_discount_amount_words: formatMoney(discountAmount),
    device_final_price_number: formatMoney(contract.finalPrice),
    device_final_price_words: formatMoney(contract.finalPrice),
    contract_items_summary: buildContractItemsSummary(lineItems),
    final_price_number: formatMoney(contract.finalPrice),
    final_price_words: formatMoney(contract.finalPrice),
    payment_clause_text: buildPaymentClauseText(contract, installments),
    included_components_text: buildIncludedComponentsText(lineItems),
    includes_delivery_once: contract.deliveryDate ? 'مشمول' : 'بحسب بنود العقد',
    includes_installation_once: contract.installationDate || contract.installationAddressText ? 'مشمول' : 'بحسب بنود العقد',
    warranty_months_label: contract.warrantyMonths ? `${contract.warrantyMonths} شهر` : '',
    periodic_visits_count: contract.warrantyVisits ?? '',
    periodic_visits_interval_text: contract.warrantyVisits ? 'وفق الخطة الدورية المعتمدة' : '',
    periodic_visits_duration_text: contract.warrantyMonths ? `${contract.warrantyMonths} شهر` : '',
    payment_type_label: paymentTypeLabel(contract.paymentType),
    down_payment_number: formatMoney(contract.downPayment),
    down_payment_words: formatMoney(contract.downPayment),
    remaining_balance_number: formatMoney(remainingBalance),
    remaining_balance_words: formatMoney(remainingBalance),
    installments_summary_text: buildInstallmentsSummaryText(installments),
    installments_table: installmentsRows,
    usd_rate_snapshot: Number(contract?.usdRateSnapshot) > 0 ? formatMoney(contract.usdRateSnapshot) : '',
    usd_link_text: buildUsdLinkText(contract),
    late_penalty_text: 'تطبق وفق السياسة المعتمدة والنص القانوني النهائي المعتمد لدى الشركة.',
    late_penalty_amount: '',
    jurisdiction_text: 'تعتبر المحاكم المختصة المحددة في الصيغة القانونية المعتمدة هي المرجع في أي نزاع ناشئ عن هذا العقد.',
    copies_count_text: 'حرر هذا العقد بالعدد المعتمد من النسخ الأصلية، واحتفظ كل طرف بنسخته وفق الأصول.',
    no_manual_edit_text: 'لا يجوز الشطب أو التعديل اليدوي على النسخة المعتمدة بعد تجميدها إلا وفق إجراء رسمي معتمد.',
    company_signature_name: contract.closingEmployeeName ?? '— لم يعتمد بعد —',
    company_signature_title: contract.closingEmployeeTitle ?? '',
    customer_signature_name: client?.name || contract.customerName || '',
    contract_approval_name: contract.closingEmployeeName ?? '',
    print_date: formatDate(new Date().toISOString()),
    payment_entry_method_label: paymentMethodLabel(firstCollectionEntry?.method),
    branch_name: contract.branchName ?? '',
    installation_governorate: installationGeoPath[0] ?? '',
    installation_area: installationGeoPath[1] ?? '',
    installation_sub_area: installationGeoPath[2] ?? '',
    installation_neighborhood: installationGeoPath[3] ?? '',
    ...buildV3Vars(input),
  };
}

function buildV3Vars(input: RenderContractInput): Vars {
  const { contract, client, lineItems = [], paymentEntries = [], installments = [], gifts = [], discount } = input;
  const rate = contractUsdRate(contract);
  const phones = buildCustomerPhones(client);
  const finalPrice = Number(contract?.finalPrice || 0);
  const basePrice = Number(contract?.basePrice || 0);

  // base_price = the device's catalogue price; the device line carries the
  // discounted price; other lines are accessories / service fees.
  const deviceLines = lineItems.filter((i: any) => i?.itemType === 'device');
  const deviceLineTotal = deviceLines.reduce((s: number, i: any) => s + Number(i?.totalPrice || 0), 0);
  const devicePrice = deviceLines.length ? deviceLineTotal : basePrice;
  const discountAmount = deviceLines.length ? Math.max(0, basePrice - deviceLineTotal) : 0;
  const accessories = lineItems.filter((i: any) => i?.itemType === 'accessory');
  const fees = lineItems.filter((i: any) => i?.itemType === 'service_fee');

  const down = buildDownPayment(paymentEntries, rate);
  const installmentsTotal = installments.reduce((s: number, i: any) => s + Number(i?.amountSyp || 0), 0);
  const remainingAtSigning = installments.length ? installmentsTotal : Math.max(0, finalPrice - down.amount);
  const usdLinked = installments.some((i: any) => i?.amountUsd != null);
  const remainingUsd = usdLinked
    ? installments.reduce((s: number, i: any) => s + Number(i?.amountUsd || 0), 0)
    : null;

  const months = Number(contract?.warrantyMonths) || 0;
  const visits = Number(contract?.warrantyVisits) || 0;
  const intervalMonths = months && visits ? Math.round((months / visits) * 10) / 10 : 0;
  const governorate = (Array.isArray(contract?.branchGeoPath) && contract.branchGeoPath[0]) || contract?.branchName || '';
  const branchPhones = buildBranchPhones(contract);
  const notes = String(contract?.invoiceNotes ?? '').trim();

  return {
    contract_kind_label: contractKindLabel(contract?.saleSubtype),
    sale_type_text: saleTypeText(contract),
    branch_address_text: buildBranchAddress(contract),
    company_branch_name: contract?.branchName ? `شركة غولدن غروب — فرع ${contract.branchName}` : 'شركة غولدن غروب',
    branch_phones_text: branchPhones || '—',
    customer_primary_mobile: phones.primary || '—',
    customer_whatsapp_note: phones.whatsapp,
    customer_other_numbers: phones.others,
    device_serial_number: contract?.serialNumber || '—',
    device_price_number: formatMoney(devicePrice + discountAmount),
    device_price_words: sypInWords(devicePrice + discountAmount),
    device_price_usd_text: usdText(devicePrice + discountAmount, rate),
    discount_reason: discount?.label || 'حسم معتمد على الجهاز',
    discount_amount_number: formatMoney(discountAmount),
    discount_amount_words: sypInWords(discountAmount),
    device_after_discount_number: formatMoney(devicePrice),
    device_after_discount_words: sypInWords(devicePrice),
    accessories_text: accessories
      .map((i: any) => `- ${i?.description || 'ملحق'}${Number(i?.quantity) > 1 ? ` (الكمية: ${Number(i.quantity)})` : ''}`)
      .join('\n'),
    service_fees_text: fees
      .map((i: any) => `- ${i?.description || 'رسوم خدمة'}: ${formatMoney(i?.totalPrice)} ل.س`)
      .join('\n'),
    total_price_number: formatMoney(finalPrice),
    total_price_words: sypInWords(finalPrice),
    total_price_usd_text: usdText(finalPrice, rate),
    down_payment_amount_number: formatMoney(down.amount),
    down_payment_amount_words: sypInWords(down.amount),
    down_payment_method_text: down.methodText,
    down_payment_usd_text: down.usdText,
    remaining_at_signing_number: formatMoney(remainingAtSigning),
    remaining_at_signing_words: sypInWords(remainingAtSigning),
    remaining_at_signing_usd_text: remainingUsd != null
      ? `${remainingUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} دولار أمريكي (مجموع الأقساط بالدولار)`
      : usdText(remainingAtSigning, rate),
    warranty_months_text: months ? monthsPhrase(months) : 'حسب تعريف الجهاز',
    installation_address_line: (Array.isArray(contract?.installationGeoPath) ? contract.installationGeoPath : [])
      .filter(Boolean).join(' — ') || '—',
    installation_detail_text: installationDetailText(contract, client),
    periodic_interval_text: intervalMonths ? `كل ${monthsPhrase(intervalMonths)}` : '',
    periodic_visits_total: visits ? String(visits) : '',
    usd_rate_text: rate ? formatMoney(rate) : '',
    // USD cells of the «موضوع البيع» table.
    device_price_usd: usdCell(devicePrice + discountAmount, rate),
    discount_amount_usd: discountAmount > 0 ? `− ${usdCell(discountAmount, rate)}` : '',
    device_after_discount_usd: usdCell(devicePrice, rate),
    total_price_usd: usdCell(finalPrice, rate),
    customer_address_line: [
      ...(Array.isArray(client?.geoPath) ? client.geoPath : []),
    ].filter(Boolean).join(' — ') || '—',
    late_penalty_per_day: `${formatMoney(LATE_PENALTY_PER_DAY_SYP)} ل.س`,
    late_penalty_per_day_words: sypInWords(LATE_PENALTY_PER_DAY_SYP),
    gifts_text: buildGiftsText(gifts),
    invoice_notes_text: notes || 'لا يوجد',
    courts_governorate: governorate,
    app_contact_text: 'يمكنك التواصل بشكل مباشر مع الإدارة العامة أو الفرع عن طريق تطبيق غولدن غروب.',
  };
}

export function renderContract(input: RenderContractInput): RenderContractResult {
  const { contract, installments = [], draftWatermark = false } = input;

  const key = input.templateKey ?? templateKeyForContract(contract);
  if (!key || !ACTIVE_TEMPLATE_VERSION[key]) {
    throw new Error(`لا يوجد قالب متاح لنوع العقد هذا (saleSubtype=${contract.saleSubtype})`);
  }
  const version = ACTIVE_TEMPLATE_VERSION[key];
  const file = templatePath(key, version);

  if (!fs.existsSync(file)) {
    throw new Error(`قالب العقد غير موجود على القرص: ${file}`);
  }
  let html = fs.readFileSync(file, 'utf8');

  // USD link (migr 493): an extra USD cell only when the contract carries a
  // rate snapshot — legacy contracts render byte-identical to before.
  const usdLinked = Number(contract?.usdRateSnapshot) > 0 && installments.some((i) => i.amountUsd != null);
  const installmentsRows = installments
    .map((i) => `<tr><td>${i.installmentNumber}</td><td>${escapeHtml(formatDate(i.dueDate))}</td><td>${escapeHtml(formatMoney(i.amountSyp))} ل.س</td>${
      usdLinked ? `<td dir="ltr">${i.amountUsd != null ? escapeHtml(Number(i.amountUsd).toFixed(2)) : ''} $</td>` : ''
    }</tr>`)
    .join('');

  const sections = {
    draftWatermark,
    installmentsSection: installments.length > 0,
    usdLinkedSection: usdLinked && installments.length > 0,
    periodicVisitsSection: Number(contract.warrantyVisits) > 0,
    discountSection: Math.max(Number(contract.basePrice || 0) - Number(contract.finalPrice || 0), 0) > 0,
    // v3 sections — each clause prints only when it has content.
    v3DiscountSection: (() => {
      const lines = (input.lineItems ?? []).filter((i: any) => i?.itemType === 'device');
      if (!lines.length) return false;
      const deviceTotal = lines.reduce((s: number, i: any) => s + Number(i?.totalPrice || 0), 0);
      return Number(contract.basePrice || 0) - deviceTotal > 0;
    })(),
    accessoriesSection: (input.lineItems ?? []).some((i: any) => i?.itemType === 'accessory'),
    serviceFeesSection: (input.lineItems ?? []).some((i: any) => i?.itemType === 'service_fee'),
    giftsSection: buildGiftsText(input.gifts).length > 0,
    usdPriceSection: contractUsdRate(contract) != null,
    downPaymentDetailSection: signingEntries(input.paymentEntries ?? []).length > 0,
    // «بدون كفالة» chosen explicitly (0) vs a period / legacy unknown (null).
    noWarrantySection: contract.warrantyMonths !== null && contract.warrantyMonths !== undefined && Number(contract.warrantyMonths) === 0,
    warrantySection: !(contract.warrantyMonths !== null && contract.warrantyMonths !== undefined && Number(contract.warrantyMonths) === 0),
    branchPhonesSection: buildBranchPhones(contract).length > 0,
  };
  html = applySections(html, sections);

  const vars = buildSaleDefinitiveVars(input, installmentsRows);

  // Pre-built (already escaped) HTML fragments are swapped in after the
  // variable pass so applyVars never escapes their markup.
  const rawFragments: Record<string, string> = {
    installmentsRows,
    paymentSummaryRows: buildPaymentSummaryRowsHtml(input),
    priceRows: buildPriceRowsHtml(input),
    downPaymentRows: buildDownPaymentRowsHtml(input),
  };
  const tokenFor = (name: string) => `\x00RAW_${name}\x00`;
  for (const name of Object.keys(rawFragments)) html = html.split(`{{${name}}}`).join(tokenFor(name));
  html = applyVars(html, vars);
  for (const [name, fragment] of Object.entries(rawFragments)) html = html.split(tokenFor(name)).join(fragment);

  const contentHash = crypto.createHash('sha256').update(html, 'utf8').digest('hex');

  return { templateKey: key, templateVersion: version, html, contentHash };
}
