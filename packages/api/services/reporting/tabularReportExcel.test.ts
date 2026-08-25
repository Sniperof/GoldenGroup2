import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { findTabularReport } from './tabularReportCatalog.js';
import { buildTabularReportExcel } from './tabularReportExcel.js';

test('Excel export is a real readable XLSX with the canonical report columns', async () => {
  const definition = findTabularReport('work_files.geo_supervisors');
  assert.ok(definition);
  const buffer = await buildTabularReportExcel(definition, [{
    employeeName: 'مشرفة اختبار',
    geoUnitName: 'حي اختبار',
    leadCount: 3,
    salesFollowUpCount: 2,
    fopClosedDemoCount: 4,
    opClosedDemoCount: 5,
    lastVisitAt: '2026-08-25T08:30:00.000Z',
    lastVisitTechnicianName: 'فني اختبار',
  }], { scope: 'ASSIGNED', branchIds: [3], generatedAt: new Date('2026-08-25T10:00:00.000Z') });

  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('التقرير');
  assert.ok(worksheet);
  assert.equal(worksheet.getCell('A4').value, 'المشرفة');
  assert.equal(worksheet.getCell('A5').value, 'مشرفة اختبار');
  assert.equal(worksheet.getCell('C5').value, 3);
  assert.equal(worksheet.getCell('E4').value, 'زبائن FOP');
  assert.equal(worksheet.getCell('E5').value, 4);
  assert.equal(worksheet.getCell('F5').value, 5);
});
