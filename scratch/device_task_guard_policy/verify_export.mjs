import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const input = await FileBlob.load("../../outputs/device_task_guard_policy/device_task_guard_policy.xlsx");
const workbook = await SpreadsheetFile.importXlsx(input);
const overview = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 2000 });
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan",
  maxChars: 2000,
});
const preview = await workbook.render({ sheetName: "00 ملخص", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile("../../outputs/device_task_guard_policy/reimport_preview.png", new Uint8Array(await preview.arrayBuffer()));
await fs.writeFile("../../outputs/device_task_guard_policy/reimport_verification.txt", `${overview.ndjson}\n\n${errors.ndjson}\n`);
