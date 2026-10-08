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
// Responsive: below `md` the table auto-renders as a stacked label·value card
// list (labels derived from the Head cells), matching <SmartTable>'s mobile
// cards — no change needed at call sites. The desktop <table> is untouched.
// Rows whose cell count does not match the header (e.g. a colSpan empty-state
// row) render full-width without labels. Opt out with `mobileCards={false}`.
//
// For full top-level list pages (search/filter/paginate) use <SmartTable>.
// ────────────────────────────────────────────────────────────────────────────
import { Children, isValidElement } from 'react';
import type {
  ReactNode,
  ReactElement,
  Key,
  MouseEventHandler,
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

// ── Derive mobile cards from the composed <Head>/<Body> markup ──────────────
type MobileRow = { key: Key; onClick?: MouseEventHandler; cells: ReactNode[] };

function childArray(node: ReactNode): ReactElement[] {
  return Children.toArray(node).filter(isValidElement) as ReactElement[];
}

function deriveMobile(children: ReactNode): { labels: ReactNode[]; rows: MobileRow[] } {
  const top = childArray(children);
  const head = top.find((c) => c.type === Head);
  const body = top.find((c) => c.type === Body);
  if (!head || !body) return { labels: [], rows: [] };

  const headRow = childArray((head.props as { children?: ReactNode }).children).find((c) => c.type === Row);
  const labels = headRow
    ? childArray((headRow.props as { children?: ReactNode }).children)
        .filter((c) => c.type === Th)
        .map((th) => (th.props as { children?: ReactNode }).children ?? null)
    : [];

  const rows: MobileRow[] = childArray((body.props as { children?: ReactNode }).children)
    .filter((c) => c.type === Row)
    .map((rowEl, idx) => {
      const cells = childArray((rowEl.props as { children?: ReactNode }).children)
        .filter((c) => c.type === Td)
        .map((td) => (td.props as { children?: ReactNode }).children ?? null);
      const props = rowEl.props as { onClick?: MouseEventHandler };
      return { key: rowEl.key ?? idx, onClick: props.onClick, cells };
    });

  return { labels, rows };
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
  /** Render as a stacked card list below `md` (default true). Set false to keep
   *  the horizontally-scrolling table on mobile too. */
  mobileCards?: boolean;
}

function DataTable({
  children,
  card = false,
  minWidth,
  wrapperClassName = '',
  mobileCards = true,
  className = '',
  ...rest
}: DataTableProps) {
  const { labels, rows } = mobileCards ? deriveMobile(children) : { labels: [], rows: [] };
  const canCards = mobileCards && labels.length > 0 && rows.length > 0;

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
  const desktopTable = card ? (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">{scroll}</div>
  ) : (
    scroll
  );

  if (!canCards) return desktopTable;

  return (
    <>
      <div className="hidden md:block">{desktopTable}</div>
      {/* ── Mobile card list (< md) — label·value, derived from the header ── */}
      <div className="md:hidden space-y-2.5">
        {rows.map((r) => {
          const mapLabels = r.cells.length === labels.length;
          return (
            <div
              key={String(r.key)}
              onClick={r.onClick}
              className={cx(
                'rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-colors',
                r.onClick && 'cursor-pointer active:bg-sky-50',
              )}
            >
              <dl className="space-y-1.5">
                {r.cells.map((cell, i) => {
                  const label = mapLabels ? labels[i] : null;
                  const hasLabel = label != null && label !== '';
                  return (
                    <div key={i} className={hasLabel ? 'flex items-start justify-between gap-3' : ''}>
                      {hasLabel && <dt className="shrink-0 pt-0.5 text-xs font-medium text-slate-400">{label}</dt>}
                      <dd className="min-w-0 text-start text-sm text-slate-700">{cell}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Head({ children, className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cx('bg-slate-50 border-b border-slate-200 shadow-[0_1px_0_0_#e2e8f0]', className)} {...rest}>
      {children}
    </thead>
  );
}

function Body({ children, className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  // Match <SmartTable>'s row rhythm so embedded tables read as the same system:
  // subtle zebra striping on even body rows + sky hover. Scoped to direct <tr>
  // children (header rows live in <thead>, untouched).
  return (
    <tbody
      className={cx(
        'divide-y divide-slate-100',
        '[&>tr]:transition-colors [&>tr:nth-child(even)]:bg-slate-50/50 [&>tr:hover]:bg-sky-50',
        className,
      )}
      {...rest}
    >
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
  // Hover tint is applied by <Body> ([&>tr:hover]) so every body row matches
  // SmartTable; here we only add the pointer affordance for clickable rows.
  return (
    <tr
      onClick={onClick}
      className={cx(
        'transition-colors',
        clickable && 'cursor-pointer',
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
