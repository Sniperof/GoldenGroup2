export interface PagedExportResult<T> {
    items: T[];
    total: number;
}

export interface CollectAllPagesOptions {
    pageSize?: number;
    maxRows?: number;
}

export async function collectAllPages<T>(
    loadPage: (page: number, limit: number) => Promise<PagedExportResult<T>>,
    options: CollectAllPagesOptions = {},
): Promise<T[]> {
    const pageSize = options.pageSize ?? 100;
    const maxRows = options.maxRows ?? 50_000;
    const first = await loadPage(1, pageSize);

    if (first.total > maxRows) {
        throw new Error(`Export exceeds the protected limit of ${maxRows} rows.`);
    }

    const rows = [...first.items];
    for (let page = 2; rows.length < first.total; page += 1) {
        const result = await loadPage(page, pageSize);
        if (result.items.length === 0) {
            throw new Error('The server returned an incomplete export result.');
        }
        rows.push(...result.items);
    }

    return rows.slice(0, first.total);
}

function normalizeExportValue(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalizeExportValue).join(' | ');
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function protectSpreadsheetFormula(value: unknown, normalized: string): string {
    if (typeof value !== 'string') return normalized;
    return /^[=+\-@\t\r]/.test(normalized) ? `'${normalized}` : normalized;
}

function quoteCsvCell(value: unknown): string {
    const normalized = normalizeExportValue(value);
    const safe = protectSpreadsheetFormula(value, normalized);
    return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsv<T>(
    columns: Array<{ label: string; getValue: (row: T) => unknown }>,
    rows: T[],
): string {
    const header = columns.map(column => quoteCsvCell(column.label)).join(',');
    const body = rows.map(row => columns.map(column => quoteCsvCell(column.getValue(row))).join(','));
    return `\uFEFF${[header, ...body].join('\r\n')}`;
}

export function downloadCsv(csv: string, requestedName: string): void {
    const safeName = requestedName
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .trim() || 'report';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
