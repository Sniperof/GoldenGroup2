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

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates', 'contracts');

function templatePath(key: string, version: string): string {
  return path.join(TEMPLATES_DIR, `${key}.${version}.html`);
}

export const ACTIVE_TEMPLATE_VERSION: Record<string, string> = {
  sale_definitive: 'v2',
  sale_temporary: 'v1',
  sale_free: 'v1',
};

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

export interface RenderContractInput {
  contract: any;
  client?: any | null;
  lineItems?: any[];
  paymentEntries?: any[];
  discount?: any | null;
  installments?: Array<{ installmentNumber: number; dueDate: string; amountSyp: number; remainingBalance?: number; status?: string }>;
  draftWatermark?: boolean;
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
  };
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

  const installmentsRows = installments
    .map((i) => `<tr><td>${i.installmentNumber}</td><td>${escapeHtml(String(i.dueDate))}</td><td>${escapeHtml(String(i.amountSyp))} ل.س</td></tr>`)
    .join('');

  const sections = {
    draftWatermark,
    installmentsSection: installments.length > 0,
    periodicVisitsSection: Number(contract.warrantyVisits) > 0,
    discountSection: Math.max(Number(contract.basePrice || 0) - Number(contract.finalPrice || 0), 0) > 0,
  };
  html = applySections(html, sections);

  const vars = buildSaleDefinitiveVars(input, installmentsRows);

  const rowsToken = '\x00INSTALLMENT_ROWS_PLACEHOLDER\x00';
  html = html.replace('{{installmentsRows}}', rowsToken);
  html = applyVars(html, vars);
  html = html.replace(rowsToken, installmentsRows);

  const contentHash = crypto.createHash('sha256').update(html, 'utf8').digest('hex');

  return { templateKey: key, templateVersion: version, html, contentHash };
}
