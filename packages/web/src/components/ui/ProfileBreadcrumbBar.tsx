// Full-width white breadcrumb bar sitting above a profile page's scroll area.
// Standardized styling shared across profile pages (client, device, …): the
// bar spans full width, its content is centered to max-w-[1600px], links are
// pill-hover buttons, and separators are subtle chevrons.
import { Fragment } from 'react';
import { ChevronLeft } from 'lucide-react';

export interface Breadcrumb {
  label: string;
  /** Makes the crumb a clickable link. Omit for the current (last) crumb. */
  onClick?: () => void;
}

export default function ProfileBreadcrumbBar({ items }: { items: Breadcrumb[] }) {
  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2.5 text-sm">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronLeft className="hidden h-4 w-4 text-slate-300 sm:block" />}
            {item.onClick ? (
              <button
                onClick={item.onClick}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-sky-600"
              >
                {item.label}
              </button>
            ) : (
              <span className="min-w-0 break-words font-bold text-slate-900">{item.label}</span>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
