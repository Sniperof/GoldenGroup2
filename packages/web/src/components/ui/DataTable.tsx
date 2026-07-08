// ────────────────────────────────────────────────────────────────────────────
// <DataTable> — Golden Group lightweight table primitive.
//
// The canonical table LOOK, shared with <SmartTable>, but with NONE of its
// chrome (no title, search, filter bar, pagination, sorting, selection). Use
// it for embedded / secondary tables — inside modals, detail sections, small
// sub-lists — where a full SmartTable would be overkill and where hand-rolled
// <table> markup has drifted into inconsistent styling.
//
// Composable so it drops into existing markup by tag-swap (no re-modelling of
// cells into column defs), which keeps migrations "design-only":
//
//   <DataTable>
//     <DataTable.Head>
//       <DataTable.Row>
//         <DataTable.Th>الاسم</DataTable.Th>
//         <DataTable.Th align="end">المبلغ</DataTable.Th>
//       </DataTable.Row>
//     </DataTable.Head>
//     <DataTable.Body>
//       {rows.map(r => (
//         <DataTable.Row key={r.id} onClick={() => open(r)}>
//           <DataTable.Td>{r.name}</DataTable.Td>
//           <DataTable.Td align="end">{r.amount}</DataTable.Td>
//         </DataTable.Row>
//       ))}
//     </DataTable.Body>
//   </DataTable>
//
// For full top-level list pages (search/filter/paginate) use <SmartTable>.
// ────────────────────────────────────────────────────────────────────────────
import type {
  ReactNode,
  ThHTMLAttributes,
  TdHTMLAttributes,
  HTMLAttributes,
} from 'react';

type Align = 'start' | 'center' | 'end';

const alignCls: Record<Align, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export interface DataTableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  /** Wrap in the brand card shell (rounded border + white bg). Default false —
   *  most embedded tables already sit inside their own card/section. */
  card?: boolean;
  /** Min width (px) before horizontal scroll kicks in. */
  minWidth?: number;
  /** Extra classes on the scroll wrapper. */
  wrapperClassName?: string;
}

function DataTable({
  children,
  card = false,
  minWidth,
  wrapperClassName = '',
  className = '',
  ...rest
}: DataTableProps) {
  const scroll = (
    <div className={cx('overflow-x-auto', wrapperClassName)}>
      <table
        className={cx('w-full border-collapse', className)}
        style={minWidth ? { minWidth } : undefined}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
  if (!card) return scroll;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {scroll}
    </div>
  );
}

function Head({ children, className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cx('bg-slate-50 border-b border-slate-200', className)} {...rest}>
      {children}
    </thead>
  );
}

function Body({ children, className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cx('divide-y divide-slate-100', className)} {...rest}>
      {children}
    </tbody>
  );
}

interface RowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Adds hover highlight + pointer; usually paired with onClick. */
  interactive?: boolean;
}

function Row({ children, interactive, onClick, className = '', ...rest }: RowProps) {
  const clickable = interactive || Boolean(onClick);
  return (
    <tr
      onClick={onClick}
      className={cx(
        'transition-colors',
        clickable && 'cursor-pointer hover:bg-slate-50',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: Align;
}

function Th({ children, align = 'start', className = '', ...rest }: ThProps) {
  return (
    <th
      className={cx(
        'px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap',
        alignCls[align],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

interface TdProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: Align;
}

function Td({ children, align = 'start', className = '', ...rest }: TdProps) {
  return (
    <td
      className={cx('px-4 py-3 text-sm text-slate-700', alignCls[align], className)}
      {...rest}
    >
      {children}
    </td>
  );
}

DataTable.Head = Head;
DataTable.Body = Body;
DataTable.Row = Row;
DataTable.Th = Th;
DataTable.Td = Td;

export default DataTable;
