// ────────────────────────────────────────────────────────────────────────────
// <PageHeader> — Golden Group unified page title block.
//
// The single, app-wide pattern for a page's main title + secondary subtitle,
// modeled on the "سجلات الأسماء المقترحة" (CandidatesEntry) layout:
//
//   • Title    — text-2xl font-bold text-slate-800
//   • Subtitle — text-sm text-slate-500 (optional)
//   • Actions  — right-aligned slot (buttons, filters…)
//   • children — extra content under the subtitle (e.g. BranchScopeIndicator)
//
// Responsive: stacks vertically on mobile, title-left / actions-right on md+.
//
// Usage:
//   <PageHeader
//     title="سجلات الأسماء المقترحة"
//     subtitle="فلترة، تدقيق، وتوجيه الأسماء الجديدة"
//     icon={<Users className="w-6 h-6 text-sky-600" />}
//     actions={<Button>إضافة اسم</Button>}
//   >
//     <BranchScopeIndicator />
//   </PageHeader>
// ────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** Main title (h1). */
  title: ReactNode;
  /** Optional secondary line under the title. */
  subtitle?: ReactNode;
  /** Optional icon / badge rendered to the side of the title block. */
  icon?: ReactNode;
  /** Optional right-aligned slot for buttons / controls. */
  actions?: ReactNode;
  /** Extra content rendered under the subtitle (badges, scope indicators…). */
  children?: ReactNode;
  /** Extra classes on the outer wrapper. */
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={[
        'flex flex-col md:flex-row gap-4 items-start md:items-center justify-between',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          {subtitle && (
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          )}
          {children && <div className="mt-2">{children}</div>}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap gap-2 items-center shrink-0">{actions}</div>
      )}
    </div>
  );
}
