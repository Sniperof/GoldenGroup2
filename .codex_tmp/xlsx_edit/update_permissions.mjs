import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "../../صلاحيات_النظام.xlsx";
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const all = workbook.worksheets.getItem("كل الصلاحيات");
const roles = workbook.worksheets.getItem("اختبار الأدوار");
const summary = workbook.worksheets.getItem("ملخص حسب الوحدة");

// Extend visually from the preceding row, then overwrite values.
all.getRange("A142:N142").copyTo(all.getRange("A143:N143"), "all");
all.getRange("A143:N143").values = [[
  142,
  null,
  "المهام والعمليات",
  "tasks",
  "periodic_maintenance",
  "create_manual",
  "إنشاء صيانة دورية يدوياً",
  "tasks.periodic.create_manual",
  "عام (كل الفروع) / الفرع",
  236,
  "✅",
  "Branch",
  "مضاف",
  "إضافة جديدة: إنشاء صيانة دورية يدوياً لجهاز ضمن نطاق الفرع. تُمنح مبدئياً للأدوار التي تملك tasks.create.",
]];
all.getRange("A143:N143").format.fill = "#C6EFCE";

roles.getRange("A134:T134").copyTo(roles.getRange("A135:T135"), "all");
roles.getRange("A135:T135").values = [[
  134,
  null,
  "tasks.periodic.create_manual",
  "المهام والعمليات",
  "create_manual",
  "مضاف",
  "✅",
  "BRANCH",
  "✅",
  "BRANCH",
  "❌",
  null,
  "إضافة جديدة: صلاحية إنشاء دورية يدوية. تُمنح من tasks.create وتخضع لفرع الجهاز.",
  "✅",
  "BRANCH",
  "✅",
  "BRANCH",
  "✅",
  "GLOBAL",
  "تشغيلي؛ subject = فرع الجهاز",
]];
roles.getRange("A135:T135").format.fill = "#C6EFCE";

// Summary sheet appears static; update tasks count and total.
summary.getRange("C4").values = [[12]];
summary.getRange("C23").values = [[142]];

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "كل الصلاحيات",
  range: "A138:N143",
  scale: 1,
  format: "png",
});
await fs.writeFile("permissions_preview.png", new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
