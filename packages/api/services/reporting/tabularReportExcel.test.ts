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

test('geographic portfolio export preserves numeric counts and evaluation metadata', async () => {
  const definition = findTabularReport('performance.geographic_portfolio');
  assert.ok(definition);
  const buffer = await buildTabularReportExcel(definition, [{
    governorateName: 'دمشق', regionName: 'دمشق', subareaName: 'المزة',
    totalCustomers: 100, fopCustomers: 20, leadCustomers: 5, suggestedCustomers: 60, opCustomers: 15,
    challengerDevices: 9, aquanovaDevices: 1, safeLifeDevices: 0, otherDevices: 2,
    periodicDueTodayDevices: 3, overduePeriodicDevices: 4,
    areaEvaluation: 'جيدة', evaluationConfidence: 'متوسطة', evaluationCount: 7,
    latestEvaluationDate: '2026-08-29',
  }], { scope: 'BRANCH', branchIds: [3], generatedAt: new Date('2026-08-30T08:00:00.000Z') });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('التقرير');
  assert.ok(worksheet);
  assert.equal(worksheet.getCell('D4').value, 'إجمالي الزبائن');
  assert.equal(worksheet.getCell('D5').value, 100);
  assert.equal(worksheet.getCell('M5').value, 3);
  assert.equal(worksheet.getCell('N5').value, 4);
  assert.equal(worksheet.getCell('O5').value, 'جيدة');
  assert.equal(worksheet.getCell('Q5').value, 7);
  assert.ok(worksheet.getCell('R5').value instanceof Date);
});

test('sales follow-up export preserves the agreed Arabic columns and execution date', async () => {
  const definition = findTabularReport('performance.sales_follow_up_tasks');
  assert.ok(definition);
  const buffer = await buildTabularReportExcel(definition, [{
    supervisorName: 'مشرفة اختبار', technicianName: 'فني اختبار', customerName: 'زبون اختبار',
    governorateName: 'دمشق', regionName: 'دمشق', subareaName: 'المزة', neighborhoodName: 'الشيخ سعد',
    taskType: 'عرض جهاز', executedDate: '2026-08-30', resultNotes: 'تم تسجيل النتيجة',
  }], { scope: 'BRANCH', branchIds: [3], generatedAt: new Date('2026-08-30T08:00:00.000Z') });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('التقرير');
  assert.ok(worksheet);
  assert.equal(worksheet.getCell('A4').value, 'المشرفة');
  assert.equal(worksheet.getCell('H4').value, 'نوع المهمة');
  assert.equal(worksheet.getCell('H5').value, 'عرض جهاز');
  assert.ok(worksheet.getCell('I5').value instanceof Date);
  assert.equal(worksheet.getCell('J5').value, 'تم تسجيل النتيجة');
});
