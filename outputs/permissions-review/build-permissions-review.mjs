import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repoRoot = path.resolve("../..");
const outputDir = path.resolve(".");
const outputPath = path.join(outputDir, "permission_page_reorganization_review.xlsx");

const permissionCatalogPatterns = [
  /'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'/g,
];

const usagePatterns = [
  /requirePermission\(([^)]*)\)/g,
  /withPermission\(([^)]*)\)/g,
  /hasPermission\(([^)]*)\)/g,
  /hasAnyPermission\(([^)]*)\)/g,
  /authorize\([^)]*permission:\s*['"]([^'"]+)['"]/g,
  /permission:\s*['"]([^'"]+)['"]/g,
];

const actionLabels = {
  view_list: "عرض القائمة",
  view_detail: "عرض التفاصيل",
  view_eligible: "عرض المؤهلين",
  view_audit_logs: "عرض سجل التغييرات",
  view_history: "عرض السجل",
  view: "عرض",
  lookup: "استخدام في القوائم والحقول",
  create: "إنشاء",
  edit: "تعديل",
  delete: "حذف",
  manage: "إدارة",
  generate: "توليد",
  book: "حجز",
  schedule: "جدولة",
  change_status: "تغيير الحالة",
  change_stage: "تغيير المرحلة",
  record_decision: "تسجيل قرار",
  record_result: "تسجيل نتيجة",
  record_attendance: "تسجيل حضور",
  update_result: "تسجيل نتيجة",
  hire: "تعيين",
  appear: "الظهور",
  escalate: "تصعيد",
  archive: "أرشفة",
  start: "بدء",
  complete: "إتمام",
  conduct: "إجراء",
  review: "مراجعة",
  reject: "رفض",
  promote: "ترحيل",
  reopen_closed: "إعادة فتح",
  can_be_assigned: "قابل للإسناد",
  assign_sale_owner: "إسناد مالك المبيع",
  close: "إغلاق/اعتماد",
};

const sectionMap = {
  admin: ["إدارة النظام", "الأدوار والصلاحيات والإعدادات الإدارية"],
  users: ["إدارة النظام", "حسابات المستخدمين وفروعهم"],
  settings: ["إدارة النظام", "إعدادات النظام"],
  branches: ["الفروع والهيكل", "الفروع"],
  departments: ["الفروع والهيكل", "الأقسام"],
  reference_data: ["إدارة النظام", "القوائم المرجعية"],
  geo: ["الفروع والهيكل", "المناطق الجغرافية"],
  geo_units: ["الفروع والهيكل", "المناطق الجغرافية"],
  routes: ["التخطيط والمسارات", "خطوط السير وتوزيع المسارات"],
  planning: ["التخطيط والمسارات", "التخطيط وجدولة الفرق"],
  employees: ["الموظفون", "سجلات الموظفين"],
  jobs: ["التوظيف والتدريب", "التوظيف والتدريب"],
  candidates: ["التوظيف والتدريب", "الأسماء المرشحة"],
  clients: ["العملاء", "سجلات وملف العميل"],
  contracts: ["العقود والمبيعات", "العقود"],
  sales: ["العقود والمبيعات", "المبيعات"],
  devices: ["الأجهزة والمخزون", "الأجهزة"],
  device_models: ["الأجهزة والمخزون", "تعريفات الأجهزة"],
  spare_parts: ["الأجهزة والمخزون", "قطع الغيار"],
  catalog: ["الأجهزة والمخزون", "كتالوج الأجهزة والأسعار"],
  tasks: ["المهام والعمليات", "مهام العمليات"],
  open_tasks: ["المهام والعمليات", "المهام المفتوحة"],
  field_visits: ["المهام والعمليات", "الزيارات الميدانية"],
  marketing_visits: ["المهام والعمليات", "الزيارات التسويقية"],
  telemarketing: ["التسويق الهاتفي", "قوائم الاتصال والمواعيد"],
  telemarketer: ["التسويق الهاتفي", "إدارة المواعيد"],
  service_requests: ["طلبات الخدمة", "طلبات الخدمة والصيانة"],
};

const subModuleLabels = {
  roles: "الأدوار",
  roles_users: "إسناد الأدوار للمستخدمين",
  users: "المستخدمون",
  system_lists: "القوائم النظامية",
  emergency_action_types: "أنواع إجراءات الطوارئ",
  task_types: "أنواع المهام",
  branch_assignments: "فروع المستخدمين المسموحة",
  management: "الإدارة",
  system: "النظام",
  geography: "المناطق الجغرافية",
  geo_units: "الوحدات الجغرافية",
  routes: "خطوط السير",
  assignments: "توزيع المسارات",
  schedule: "جدولة الفرق",
  zone_study: "دراسة المناطق",
  vacancies: "الشواغر الوظيفية",
  applications: "طلبات التوظيف",
  interviews: "المقابلات",
  training: "الدورات التدريبية",
  candidates: "الأسماء المرشحة",
  name_lists: "لوائح الأسماء",
  employees: "الموظفون",
  contracts: "العقود",
  clients: "العملاء",
  contacts: "بيانات التواصل",
  contact_control: "ضبط التواصل",
  call_log: "سجل المكالمات",
  account_statement: "كشف الحساب",
  network: "شبكة العميل",
  visits: "الزيارات",
  devices: "أجهزة العميل",
  device_warranties: "كفالات الأجهزة",
  purchase_history: "سجل الشراء",
  parts_stock: "قطع الغيار لدى العميل",
  pre_offers: "العروض الأولية",
  device_models: "تعريفات الأجهزة",
  spare_parts: "تعريفات قطع الغيار",
  prices: "الأسعار",
  discounts: "الخصومات",
  department_availability: "أجهزة الأقسام",
  installed_devices: "الأجهزة المركبة",
  installed_device_possession: "حيازة الأجهزة",
  tasks: "المهام",
  results: "نتائج المهام",
  demo: "مهام عرض الجهاز",
  maintenance: "مهام الصيانة",
  collection: "مهام التحصيل",
  after_sales: "خدمات ما بعد البيع",
  gifts: "تسليم الهدايا",
  warranty: "خدمات الكفالة",
  delivery: "تسليم الجهاز",
  installation: "تركيب الجهاز",
  activation: "تشغيل الجهاز",
  supervisor_alerts: "تنبيهات المشرف",
  my_customers: "عملائي",
  my_visits: "زياراتي",
  targets: "الأهداف",
  lists: "قوائم الاتصال",
  calls: "المكالمات",
  appointments: "المواعيد",
  service_requests: "طلبات الخدمة والصيانة",
  lookups: "الاستخدام داخل العمليات",
  navigation: "ظهور القسم",
};

const actionOrder = [
  "nav",
  "lookup",
  "view",
  "view_list",
  "view_detail",
  "view_history",
  "view_audit_logs",
  "view_eligible",
  "create",
  "edit",
  "manage",
  "delete",
  "change_status",
  "change_stage",
  "record_decision",
  "record_result",
  "update_result",
  "schedule",
  "book",
  "generate",
  "archive",
];

async function walkFiles(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (["node_modules", ".git", "dist", "build", "outputs"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, out);
    else if (/\.(ts|tsx|js|jsx|sql)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function extractQuotedPermissionLike(text) {
  const keys = new Set();
  for (const pattern of permissionCatalogPatterns) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (key.includes(".") && !key.includes("..") && !key.startsWith("public.")) keys.add(key);
    }
  }
  return keys;
}

function extractUsage(text) {
  const keys = new Set();
  for (const pattern of usagePatterns) {
    for (const match of text.matchAll(pattern)) {
      const chunk = match[1] ?? "";
      for (const quoted of chunk.matchAll(/['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]/g)) {
        keys.add(quoted[1]);
      }
      if (match[1] && /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(match[1])) {
        keys.add(match[1]);
      }
    }
  }
  return keys;
}

function keyParts(key) {
  const parts = key.split(".");
  const module = parts[0];
  const action = parts.at(-1);
  const sub = parts.length > 2 ? parts.slice(1, -1).join("_") : module;
  return { module, subModule: sub, action };
}

function proposedLabels(key) {
  const { module, subModule, action } = keyParts(key);
  const [section, defaultGroup] = sectionMap[module] ?? ["أخرى / تحتاج تصنيف", "صلاحيات غير مصنفة"];
  const group = subModuleLabels[subModule] ?? defaultGroup;
  const actionLabel = actionLabels[action] ?? action.replaceAll("_", " ");
  const name = `${actionLabel} - ${group}`;
  const detail = `تمنح المستخدم إمكانية: ${actionLabel} ضمن ${group}. المفتاح الداخلي يبقى كما هو: ${key}`;
  return { section, group, actionLabel, name, detail };
}

function statusFor(key, used) {
  if (key.startsWith("referral_sheets.")) return "قديمة / معزولة من العرض";
  if (!used) return "تحتاج مراجعة استخدام";
  if (key.includes(".manage") || key.startsWith("admin.") || key.includes(".delete")) return "حساسة";
  return "نشطة";
}

const files = await walkFiles(repoRoot);
const catalogKeys = new Set();
const usedKeys = new Set();
for (const file of files) {
  const text = await fs.readFile(file, "utf8");
  if (file.includes(`${path.sep}migrations${path.sep}`) && text.includes("permissions")) {
    for (const key of extractQuotedPermissionLike(text)) catalogKeys.add(key);
  }
  for (const key of extractUsage(text)) usedKeys.add(key);
}

const allKeys = Array.from(new Set([...catalogKeys, ...usedKeys]))
  .filter((key) => !key.startsWith("public.") && !key.startsWith("role_permission"))
  .sort((a, b) => {
    const pa = keyParts(a);
    const pb = keyParts(b);
    const la = proposedLabels(a);
    const lb = proposedLabels(b);
    const sectionCmp = la.section.localeCompare(lb.section, "ar");
    if (sectionCmp) return sectionCmp;
    const groupCmp = la.group.localeCompare(lb.group, "ar");
    if (groupCmp) return groupCmp;
    return (actionOrder.indexOf(pa.action) - actionOrder.indexOf(pb.action)) || a.localeCompare(b);
  });

const rows = allKeys.map((key, index) => {
  const labels = proposedLabels(key);
  const inCatalog = catalogKeys.has(key);
  const used = usedKeys.has(key);
  return {
    index: index + 1,
    section: labels.section,
    group: labels.group,
    proposedName: labels.name,
    proposedDetail: labels.detail,
    key,
    action: labels.actionLabel,
    status: statusFor(key, used),
    inCatalog: inCatalog ? "نعم" : "غير موجود في الكتالوج",
    usedInCode: used ? "نعم" : "لا يظهر في فحص الكود",
    approval: "",
    notes: "",
  };
});

const sectionSummary = Array.from(
  rows.reduce((map, row) => {
    const current = map.get(row.section) ?? { section: row.section, total: 0, active: 0, sensitive: 0, review: 0, legacy: 0 };
    current.total += 1;
    if (row.status === "نشطة") current.active += 1;
    if (row.status === "حساسة") current.sensitive += 1;
    if (row.status === "تحتاج مراجعة استخدام") current.review += 1;
    if (row.status.startsWith("قديمة")) current.legacy += 1;
    map.set(row.section, current);
    return map;
  }, new Map()).values(),
).sort((a, b) => a.section.localeCompare(b.section, "ar"));

const reviewRows = rows.filter((row) => row.status !== "نشطة");

const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: "Codex" });

function styleHeader(range) {
  range.format.fill = "#1F2937";
  range.format.font = { bold: true, color: "#FFFFFF" };
  range.format.wrapText = true;
}

function styleTable(sheet, range, tableName) {
  const table = sheet.tables.add(range, true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  return table;
}

const summary = workbook.worksheets.add("ملخص");
summary.showGridLines = false;
summary.getRange("A1:H1").merge();
summary.getRange("A1").values = [["مسودة تنظيم صفحة الصلاحيات"]];
summary.getRange("A1").format = {
  fill: "#0F172A",
  font: { bold: true, color: "#FFFFFF", size: 16 },
};
summary.getRange("A1:A2").format.rowHeight = 30;
summary.getRange("A2:H2").merge();
summary.getRange("A2").values = [["هذا الملف للموافقة على ترتيب العرض فقط. لا يقترح حذف مفاتيح أو تغيير منطق الصلاحيات قبل موافقة منفصلة."]];
summary.getRange("A2").format = { fill: "#E0F2FE", font: { color: "#0F172A" }, wrapText: true };
summary.getRange("A4:E4").values = [["المؤشر", "القيمة", "الملاحظة", "", ""]];
styleHeader(summary.getRange("A4:E4"));
summary.getRange("A5:C9").values = [
  ["إجمالي الصلاحيات في المسودة", rows.length, "يشمل مفاتيح الكتالوج ومفاتيح مستخدمة في الكود"],
  ["نشطة", rows.filter((r) => r.status === "نشطة").length, "تظهر مستخدمة وليست مصنفة كحساسة"],
  ["حساسة", rows.filter((r) => r.status === "حساسة").length, "إدارة أو حذف أو صلاحيات إدارية"],
  ["تحتاج مراجعة استخدام", rows.filter((r) => r.status === "تحتاج مراجعة استخدام").length, "موجودة في الكتالوج ولا تظهر في فحص الكود الثابت"],
  ["قديمة / معزولة", rows.filter((r) => r.status.startsWith("قديمة")).length, "مثال: referral_sheets"],
];
summary.getRange("A11:E11").values = [["القسم المقترح", "إجمالي", "نشطة", "حساسة", "تحتاج مراجعة"]];
styleHeader(summary.getRange("A11:E11"));
summary.getRangeByIndexes(11, 0, sectionSummary.length, 5).values = sectionSummary.map((s) => [s.section, s.total, s.active, s.sensitive, s.review + s.legacy]);
summary.getRange("A4:E20").format.borders = { preset: "inside", style: "thin", color: "#CBD5E1" };
summary.getRange("A:A").format.columnWidth = 28;
summary.getRange("B:B").format.columnWidth = 12;
summary.getRange("C:C").format.columnWidth = 48;
summary.getRange("D:E").format.columnWidth = 12;
summary.getRange("A1:E23").format.wrapText = true;
summary.freezePanes.freezeRows(4);

const mapSheet = workbook.worksheets.add("خريطة الصلاحيات");
mapSheet.showGridLines = false;
const headers = [
  "#",
  "القسم المقترح",
  "المجموعة المقترحة",
  "اسم الصلاحية المقترح",
  "التفصيل تحت الاسم",
  "المفتاح الداخلي",
  "نوع الإجراء",
  "الحالة",
  "في الكتالوج",
  "مستخدم في الكود",
  "قرار الموافقة",
  "ملاحظات",
];
mapSheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
styleHeader(mapSheet.getRangeByIndexes(0, 0, 1, headers.length));
mapSheet.getRangeByIndexes(1, 0, rows.length, headers.length).values = rows.map((row) => [
  row.index,
  row.section,
  row.group,
  row.proposedName,
  row.proposedDetail,
  row.key,
  row.action,
  row.status,
  row.inCatalog,
  row.usedInCode,
  row.approval,
  row.notes,
]);
styleTable(mapSheet, `A1:L${rows.length + 1}`, "PermissionMap");
mapSheet.getRange(`K2:K${rows.length + 1}`).dataValidation = {
  rule: { type: "list", values: ["موافق", "تعديل الاسم", "تغيير المجموعة", "رفض", "يحتاج نقاش"] },
};
mapSheet.getRange(`A1:L${rows.length + 1}`).format.wrapText = true;
mapSheet.getRange("A:A").format.columnWidth = 6;
mapSheet.getRange("B:B").format.columnWidth = 22;
mapSheet.getRange("C:C").format.columnWidth = 26;
mapSheet.getRange("D:D").format.columnWidth = 34;
mapSheet.getRange("E:E").format.columnWidth = 58;
mapSheet.getRange("F:F").format.columnWidth = 34;
mapSheet.getRange("G:J").format.columnWidth = 16;
mapSheet.getRange("K:L").format.columnWidth = 22;
mapSheet.freezePanes.freezeRows(1);
mapSheet.freezePanes.freezeColumns(3);

const review = workbook.worksheets.add("تحتاج مراجعة");
review.showGridLines = false;
review.getRange("A1:H1").values = [[
  "القسم",
  "المجموعة",
  "الاسم المقترح",
  "المفتاح الداخلي",
  "الحالة",
  "سبب الظهور هنا",
  "قرار الموافقة",
  "ملاحظات",
]];
styleHeader(review.getRange("A1:H1"));
review.getRangeByIndexes(1, 0, reviewRows.length, 8).values = reviewRows.map((row) => [
  row.section,
  row.group,
  row.proposedName,
  row.key,
  row.status,
  row.status === "حساسة"
    ? "صلاحية إدارية/حذف/إدارة؛ يفضل إبقاؤها واضحة ومنفصلة"
    : row.status.startsWith("قديمة")
      ? "صلاحية قديمة معزولة من العرض الحالي"
      : "لم تظهر في فحص الاستخدام الثابت داخل الكود",
  "",
  "",
]);
styleTable(review, `A1:H${reviewRows.length + 1}`, "ReviewPermissions");
review.getRange(`G2:G${reviewRows.length + 1}`).dataValidation = {
  rule: { type: "list", values: ["موافق", "إخفاء من الصفحة", "إبقاء في قسم مراجعة", "يحتاج تدقيق"] },
};
review.getRange("A:H").format.autofitColumns();
review.getRange("C:C").format.columnWidth = 34;
review.getRange("D:D").format.columnWidth = 34;
review.getRange("F:F").format.columnWidth = 48;
review.getRange("A:H").format.wrapText = true;
review.freezePanes.freezeRows(1);

const guidance = workbook.worksheets.add("تعليمات الموافقة");
guidance.showGridLines = false;
guidance.getRange("A1:F1").merge();
guidance.getRange("A1").values = [["طريقة مراجعة الملف"]];
guidance.getRange("A1").format = { fill: "#0F172A", font: { bold: true, color: "#FFFFFF", size: 15 } };
guidance.getRange("A3:B9").values = [
  ["1", "راجع ورقة خريطة الصلاحيات حسب القسم والمجموعة."],
  ["2", "استخدم عمود قرار الموافقة لتحديد: موافق، تعديل الاسم، تغيير المجموعة، رفض، يحتاج نقاش."],
  ["3", "أي تعديل مطلوب على الاسم أو المجموعة يوضع في عمود ملاحظات."],
  ["4", "ورقة تحتاج مراجعة لا تعني حذف الصلاحية؛ فقط تعني أنها تحتاج قرار عرض."],
  ["5", "بعد الموافقة، التنفيذ سيكون على الواجهة فقط مع بقاء المفاتيح الداخلية كما هي."],
  ["6", "أي حذف أو دمج فعلي للصلاحيات يحتاج مشروع أمان منفصل وموافقات واختبارات."],
  ["7", "الفحص الحالي ثابت من الكود والمigrations، وليس بديلًا عن تدقيق قاعدة بيانات staging."],
];
guidance.getRange("A3:B9").format = { wrapText: true };
guidance.getRange("A:A").format.columnWidth = 8;
guidance.getRange("B:B").format.columnWidth = 90;

const inspect = await workbook.inspect({
  kind: "table",
  sheetId: "ملخص",
  range: "A1:E23",
  maxChars: 5000,
  tableMaxRows: 25,
  tableMaxCols: 5,
});
console.log(inspect.ndjson);

const previewRanges = {
  "ملخص": "A1:H23",
  "خريطة الصلاحيات": "A1:L28",
  "تحتاج مراجعة": "A1:H28",
  "تعليمات الموافقة": "A1:B10",
};

for (const [sheetName, range] of Object.entries(previewRanges)) {
  const preview = await workbook.render({ sheetName, range, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(outputDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(outputPath);
