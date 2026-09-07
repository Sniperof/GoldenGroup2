import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTabularReport } from './tabularReportCatalog.js';
import { buildTabularReportExcel, parseExcelReportTemporalValue, writeTabularReportExcelFile } from './tabularReportExcel.js';

test('Excel report dates accept ISO values persisted by PostgreSQL snapshots', () => {
  const value = parseExcelReportTemporalValue('2026-08-31T00:00:00.000Z', 'date');
  assert.ok(value);
  assert.equal(value.getFullYear(), 2026);
  assert.equal(value.getMonth(), 7);
  assert.equal(value.getDate(), 31);
  assert.equal(parseExcelReportTemporalValue('not-a-date', 'date'), null);
});

test('streaming Excel writer consumes bounded batches and creates a readable workbook', async () => {
  const definition = findTabularReport('work_files.names_file');
  assert.ok(definition);
  const filename = join(tmpdir(), `golden-report-test-${randomUUID()}.xlsx`);
  async function* batches() {
    yield [{ sourceType: 'اقتراح مباشر', candidateName: 'الأول', candidateAddedDate: '2026-09-01' }];
    yield [{ sourceType: 'لائحة أسماء', candidateName: 'الثاني', candidateAddedDate: '2026-09-01' }];
  }
  try {
    await writeTabularReportExcelFile(definition, batches(), {
      scope: 'BRANCH', branchIds: [1], generatedAt: new Date('2026-09-01T08:00:00Z'), rowCount: 2,
    }, filename);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(filename) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('التقرير');
    assert.ok(sheet);
    assert.equal(sheet.getCell('A5').value, 'اقتراح مباشر');
    assert.equal(sheet.getCell('A6').value, 'لائحة أسماء');
  } finally { await unlink(filename).catch(() => undefined); }
});

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

test('names file export preserves one candidate row and Arabic source terminology', async () => {
  const definition = findTabularReport('work_files.names_file');
  assert.ok(definition);
  const buffer = await buildTabularReportExcel(definition, [{
    sourceType: 'لائحة أسماء', referralSheetNumber: 77, candidateAddedDate: '2026-08-31',
    referralSheetDate: '2026-08-30', mediatorVisitDate: '2026-08-30', accompanyingTechnician: 'فني اختبار',
    mediatorName: 'وسيط اختبار', mediatorType: 'زبون', mediatorAddress: 'المزة', mediatorContactNumber: '0999000000',
    giftPromiseStatus: 'موعود', candidateName: 'اسم اختبار', candidateStatus: 'مقترح',
    candidateOutcome: 'ما زال اسماً مقترحاً', duplicateStatus: 'غير مكرر', governorateName: 'دمشق',
    regionName: 'دمشق', subareaName: 'المزة', neighborhoodName: 'الشيخ سعد', detailedAddress: 'عنوان اختبار',
    primaryContactNumber: '0999111111', additionalContactNumbers: '0999222222', occupation: 'تاجر', candidateNotes: 'ملاحظة',
  }], { scope: 'BRANCH', branchIds: [3], generatedAt: new Date('2026-08-31T08:00:00.000Z') });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('التقرير');
  assert.ok(worksheet);
  assert.equal(worksheet.getCell('A4').value, 'مصدر الاسم');
  assert.equal(worksheet.getCell('A5').value, 'لائحة أسماء');
  assert.equal(worksheet.getCell('B5').value, 77);
  assert.ok(worksheet.getCell('C5').value instanceof Date);
  assert.equal(worksheet.getCell('L4').value, 'الاسم المقترح');
  assert.equal(worksheet.getCell('L5').value, 'اسم اختبار');
});

test('service dues export preserves the financial snapshot columns and values', async () => {
  const definition = findTabularReport('service.dues');
  assert.ok(definition);
  const buffer = await buildTabularReportExcel(definition, [{
    governorateName: 'طرطوس', regionName: 'منطقة طرطوس', subareaName: 'مدينة طرطوس', neighborhoodName: 'حي اختبار',
    customerName: 'زبون اختبار', receivableSource: 'عقد C-1', sourceEventDate: '2026-08-10', dueDate: '2026-09-01',
    contractFinalValue: 120000, agreedPaymentType: 'تقسيط', installmentDueAmount: 30000,
    contractCollectedTotal: 100000, contractRemainingBalance: 20000,
    lastPaymentDate: '2026-08-20', lastPaymentAmount: 10000, lastPaymentMethod: 'شام كاش', collectionOwnerName: 'موظف تحصيل',
    sellerName: 'بائع', saleCloserName: 'موظف إغلاق البيع', latestCollectionResult: 'تم التسديد جزئياً',
    latestCollectedAmount: 10000,
  }], { scope: 'BRANCH', branchIds: [1002], generatedAt: new Date('2026-09-02T08:00:00.000Z') });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('التقرير');
  assert.ok(worksheet);
  assert.equal(worksheet.getCell('H4').value, 'تاريخ الاستحقاق');
  assert.ok(worksheet.getCell('H5').value instanceof Date);
  assert.equal(worksheet.getCell('I4').value, 'قيمة العقد');
  assert.equal(worksheet.getCell('I5').value, 120000);
  assert.equal(worksheet.getCell('J4').value, 'نظام السداد المتفق عليه');
  assert.equal(worksheet.getCell('M4').value, 'طريقة آخر دفعة');
  assert.equal(worksheet.getCell('M5').value, 'شام كاش');
  assert.equal(worksheet.getCell('P5').value, 30000);
});
