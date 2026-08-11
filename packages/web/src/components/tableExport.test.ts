import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsv, collectAllPages } from './tableExport';

test('buildCsv preserves Arabic and escapes delimiters, quotes, and line breaks', () => {
    const csv = buildCsv(
        [
            { label: 'الاسم', getValue: (row: { name: string; note: string }) => row.name },
            { label: 'الملاحظة', getValue: (row: { name: string; note: string }) => row.note },
        ],
        [{ name: 'سعاد، دمشق', note: 'قالت "نعم"\nغداً' }],
    );

    assert.ok(csv.startsWith('\uFEFF'));
    assert.equal(
        csv,
        '\uFEFF"الاسم","الملاحظة"\r\n"سعاد، دمشق","قالت ""نعم""\nغداً"',
    );
});

test('buildCsv neutralizes spreadsheet formulas but preserves numeric negatives', () => {
    const csv = buildCsv(
        [
            { label: 'نص', getValue: (row: { text: string; number: number }) => row.text },
            { label: 'رقم', getValue: (row: { text: string; number: number }) => row.number },
        ],
        [{ text: '=HYPERLINK("https://example.invalid")', number: -12 }],
    );

    assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
    assert.match(csv, /,"-12"$/);
});

test('collectAllPages gathers the complete server result in stable page order', async () => {
    const calls: Array<[number, number]> = [];
    const rows = await collectAllPages(async (page, limit) => {
        calls.push([page, limit]);
        const all = [1, 2, 3, 4, 5];
        const start = (page - 1) * limit;
        return { items: all.slice(start, start + limit), total: all.length };
    }, { pageSize: 2 });

    assert.deepEqual(rows, [1, 2, 3, 4, 5]);
    assert.deepEqual(calls, [[1, 2], [2, 2], [3, 2]]);
});

test('collectAllPages refuses silently truncated or oversized exports', async () => {
    await assert.rejects(
        collectAllPages(async () => ({ items: [1], total: 51 }), { maxRows: 50 }),
        /protected limit/,
    );
    await assert.rejects(
        collectAllPages(async (page) => ({ items: page === 1 ? [1] : [], total: 2 })),
        /incomplete export/,
    );
});
