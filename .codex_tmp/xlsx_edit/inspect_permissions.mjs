import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workbookPath = "../../صلاحيات_النظام.xlsx";
const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const sheets = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 8000,
  tableMaxRows: 6,
  tableMaxCols: 10,
});
console.log(sheets.ndjson);

for (const range of [
  "كل الصلاحيات!A1:N1",
  "كل الصلاحيات!A136:N142",
  "اختبار الأدوار!A1:T1",
  "اختبار الأدوار!A128:T134",
]) {
  const out = await workbook.inspect({
    kind: "region",
    range,
    maxChars: 6000,
    tableMaxRows: 10,
    tableMaxCols: 22,
  });
  console.log(`RANGE ${range}`);
  console.log(out.ndjson);
}
