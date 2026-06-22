// Shared layout shell for DeviceProfilePage sections.
// Anchors each section so the side jump-links can scroll to them.

import { ReactNode } from 'react';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SectionShell({ id, title, subtitle, actions, children }: Props) {
  return (
    <section
      id={id}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm scroll-mt-24"
    >
      <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-50">
        <div>
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

export default SectionShell;
