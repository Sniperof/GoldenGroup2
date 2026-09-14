import ExcelJS from 'exceljs';
import type { TabularReportDefinition } from './tabularReportCatalog.js';
import type { TabularReportColumn } from './tabularReportCatalog.js';
import type { ScopeMode } from './metricsCatalog.js';

interface ExcelReportMetadata {
  scope: ScopeMode;
  branchIds: number[];
  generatedAt: Date;
  exportedAt?: Date;
  columns?: TabularReportColumn[];
}

interface StreamingExcelReportMetadata extends ExcelReportMetadata {
  rowCount: number;
}

export function parseExcelReportTemporalValue(value: unknown, type: 'date' | 'datetime'): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (type === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
      return null;
    }
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function buildTabularReportExcel(
  definition: TabularReportDefinition,
  rows: object[],
  metadata: ExcelReportMetadata,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const columns = metadata.columns ?? definition.columns;
  workbook.creator = 'Golden CRM';
  workbook.created = metadata.generatedAt;
  workbook.modified = metadata.generatedAt;

  const worksheet = workbook.addWorksheet('التقرير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
    properties: { defaultRowHeight: 21 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  worksheet.mergeCells(1, 1, 1, columns.length);
  const title = worksheet.getCell(1, 1);
  title.value = definition.titleAr;
  title.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells(2, 1, 2, columns.length);
  const description = worksheet.getCell(2, 1);
  description.value = definition.descriptionAr;
  description.font = { name: 'Arial', size: 10, color: { argb: 'FF475569' } };
  description.alignment = { horizontal: 'right', vertical: 'middle' };

  worksheet.mergeCells(3, 1, 3, columns.length);
  const meta = worksheet.getCell(3, 1);
  const scopeLabel = metadata.scope === 'GLOBAL' ? 'كل الفروع' : metadata.scope === 'BRANCH' ? 'نطاق الفروع' : 'السجلات المسندة';
  const exportedAt = metadata.exportedAt ?? metadata.generatedAt;
  meta.value = `النطاق: ${scopeLabel} | وقت التوليد: ${metadata.generatedAt.toLocaleString('ar-SY')} | وقت التصدير: ${exportedAt.toLocaleString('ar-SY')} | عدد الصفوف: ${rows.length}`;
  meta.font = { name: 'Arial', size: 9, color: { argb: 'FF64748B' } };
  meta.alignment = { horizontal: 'right', vertical: 'middle' };

  const headerRow = worksheet.getRow(4);
  headerRow.values = columns.map(column => column.titleAr);
  headerRow.height = 28;
  headerRow.eachCell(cell => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F766E' } } };
  });

  for (const row of rows) {
    const excelRow = worksheet.addRow(columns.map(column => {
      const value = (row as Record<string, unknown>)[column.key];
      if (column.type === 'datetime') return parseExcelReportTemporalValue(value, 'datetime') ?? value ?? null;
      if (column.type === 'date') return parseExcelReportTemporalValue(value, 'date') ?? value ?? null;
      if (column.type === 'link' && typeof value === 'string') return { text: 'فتح الموقع', hyperlink: value };
      return value ?? null;
    }));
    excelRow.eachCell((cell, columnIndex) => {
      const column = columns[columnIndex - 1];
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = {
        horizontal: column.type === 'integer' || column.type === 'decimal' || column.type === 'link' ? 'center' : 'right',
        vertical: 'middle',
        wrapText: column.type === 'text',
      };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      if (column.type === 'integer') cell.numFmt = '#,##0';
      if (column.type === 'decimal') cell.numFmt = '#,##0.00';
      if (column.type === 'datetime') cell.numFmt = 'yyyy-mm-dd hh:mm';
      if (column.type === 'date') cell.numFmt = 'yyyy-mm-dd';
    });
  }

  columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width;
  });
  worksheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
  worksheet.pageSetup.printTitlesRow = '1:4';
  worksheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

export async function writeTabularReportExcelFile(
  definition: TabularReportDefinition,
  batches: AsyncIterable<object[]>,
  metadata: StreamingExcelReportMetadata,
  filename: string,
): Promise<void> {
  const columns = metadata.columns ?? definition.columns;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename, useStyles: true, useSharedStrings: false });
  const maxDataRowsPerSheet = 1_048_572;
  let sheetNumber = 0;
  let dataRowsInSheet = 0;
  let worksheet: ExcelJS.Worksheet;

  const createSheet = () => {
    sheetNumber += 1;
    const sheet = workbook.addWorksheet(sheetNumber === 1 ? 'التقرير' : `التقرير ${sheetNumber}`, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
      properties: { defaultRowHeight: 21 },
    });
    sheet.mergeCells(1, 1, 1, columns.length);
    const title = sheet.getCell(1, 1);
    title.value = definition.titleAr;
    title.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.mergeCells(2, 1, 2, columns.length);
    sheet.getCell(2, 1).value = definition.descriptionAr;
    sheet.mergeCells(3, 1, 3, columns.length);
    const exportedAt = metadata.exportedAt ?? metadata.generatedAt;
    sheet.getCell(3, 1).value = `وقت التوليد: ${metadata.generatedAt.toLocaleString('ar-SY')} | وقت التصدير: ${exportedAt.toLocaleString('ar-SY')} | عدد الصفوف: ${metadata.rowCount}`;
    const header = sheet.addRow(columns.map(column => column.titleAr));
    header.eachCell(cell => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    header.commit();
    columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
    dataRowsInSheet = 0;
    return sheet;
  };

  worksheet = createSheet();
  for await (const batch of batches) {
    for (const row of batch) {
      if (dataRowsInSheet >= maxDataRowsPerSheet) {
        worksheet.commit();
        worksheet = createSheet();
      }
      const excelRow = worksheet.addRow(columns.map(column => {
        const value = (row as Record<string, unknown>)[column.key];
        if (column.type === 'datetime') return parseExcelReportTemporalValue(value, 'datetime') ?? value ?? null;
        if (column.type === 'date') return parseExcelReportTemporalValue(value, 'date') ?? value ?? null;
        if (column.type === 'link' && typeof value === 'string') return { text: 'فتح الموقع', hyperlink: value };
        return value ?? null;
      }));
      excelRow.eachCell((cell, columnIndex) => {
        const column = columns[columnIndex - 1];
        cell.alignment = { horizontal: column.type === 'integer' || column.type === 'decimal' || column.type === 'link' ? 'center' : 'right', vertical: 'middle', wrapText: column.type === 'text' };
        if (column.type === 'integer') cell.numFmt = '#,##0';
        if (column.type === 'decimal') cell.numFmt = '#,##0.00';
        if (column.type === 'datetime') cell.numFmt = 'yyyy-mm-dd hh:mm';
        if (column.type === 'date') cell.numFmt = 'yyyy-mm-dd';
      });
      excelRow.commit();
      dataRowsInSheet += 1;
    }
  }
  worksheet.commit();
  await workbook.commit();
}
