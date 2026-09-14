export type ReportTemporalType = 'date' | 'datetime';

export function parseReportTemporalValue(value: unknown, type: ReportTemporalType): Date | null {
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

export function formatReportTemporalValue(value: unknown, type: ReportTemporalType): string | null {
  const date = parseReportTemporalValue(value, type);
  if (!date) return null;
  return type === 'date'
    ? date.toLocaleDateString('ar-SY')
    : date.toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' });
}
