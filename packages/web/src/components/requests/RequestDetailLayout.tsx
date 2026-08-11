// ============================================================
// RequestDetailLayout — unified request detail skeleton (contract §8)
// docs/constitution/request-section-contract.md
//
// Visual model: the water-check detail page — gradient hero (mono ref, type
// chip, flag chips, info tiles), ownership bar, decision bar, then the tab
// nav: «نظرة عامة | الربط | (ألواح النوع) | سجل الأحداث». Every request type
// renders this same shell and only fills the declared slots.
//
// Contract regions map onto the shell as:
//   1. header + ownership + decision (fixed, above the tabs)
//   2. submitted data     → tab «نظرة عامة»
//   3. linkage            → tab «الربط»
//      declared type tabs → between linkage and audit (e.g. «الأعطال»)
//   5. audit  + 6. notes  → tab «سجل الأحداث»
// ============================================================
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, Hash } from 'lucide-react';
import { RequestStatusBadge } from './RequestsListView';

export interface RequestDetailFlags {
  duplicate?: boolean;
  reviewRequired?: boolean;
  escalated?: boolean;
  archived?: boolean;
}

export interface RequestDetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface RequestDetailLayoutProps {
  backPath?: string;
  backLabel?: string;
  /** The public ref (rendered mono, LTR). */
  refNumber: string;
  /** Type chip beside the ref (e.g. «طلب فحص المياه»). */
  typeLabel?: string | null;
  createdAt?: string | null;
  status: string;
  requestType?: string | null;
  flags?: RequestDetailFlags;
  /** Extra chips beside the status badge (reopen count…). */
  headerBadges?: ReactNode;
  /** Info tiles strip under the hero header (channel, priority, branch…). */
  infoTiles?: { label: string; value: ReactNode }[];
  /** Warning/result banners directly under the hero. */
  banners?: ReactNode;
  reviewerName?: string | null;
  reviewerId?: number | null;
  /** Claim / take-over / escalate buttons (review family). */
  ownershipActions?: ReactNode;
  /** Region 4 — terminal decisions bar (decide family). Hidden when empty. */
  decision?: ReactNode;
  /** Tab «نظرة عامة» — the immutable submitted snapshot. */
  submittedData: ReactNode;
  /** Tab «الربط» — snapshot vs. suggested internal records. */
  linkage?: ReactNode;
  /** Declared type tabs, between linkage and audit (e.g. الأعطال). */
  extraTabs?: RequestDetailTab[];
  /** Tab «سجل الأحداث». */
  audit: ReactNode;
  /** Internal notes — rendered at the top of the audit tab (a note becomes
   *  an audit entry, so they live together). */
  notes?: ReactNode;
  /** Controlled tab (optional): pass both to drive the nav from the page. */
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  /** Modals and other overlay nodes. */
  overlays?: ReactNode;
}

export default function RequestDetailLayout(props: RequestDetailLayoutProps) {
  const navigate = useNavigate();
  const flags = props.flags ?? {};
  const [internalTab, setInternalTab] = useState('overview');
  const activeTab = props.activeTab ?? internalTab;
  const setTab = (tabId: string) => {
    props.onTabChange?.(tabId);
    if (props.activeTab === undefined) setInternalTab(tabId);
  };

  const tabs: RequestDetailTab[] = [
    { id: 'overview', label: 'نظرة عامة', content: props.submittedData },
    ...(props.linkage ? [{ id: 'linkage', label: 'الربط', content: props.linkage }] : []),
    ...(props.extraTabs ?? []),
    {
      id: 'audit',
      label: 'سجل الأحداث',
      content: (
        <div className="space-y-3">
          {props.notes && (
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-bold text-slate-700">ملاحظة داخلية</h3>
              {props.notes}
            </div>
          )}
          {props.audit}
        </div>
      ),
    },
  ];
  const current = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6" dir="rtl">
      <button
        onClick={() => (props.backPath ? navigate(props.backPath) : navigate(-1))}
        className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 mb-3"
      >
        <ArrowRight className="h-4 w-4" /> {props.backLabel ?? 'رجوع للقائمة'}
      </button>

      {/* Region 1 — hero header (water-check visual model) */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-sky-50/70 to-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
              <Hash className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-black text-slate-800">
                <span dir="ltr" className="font-mono">{props.refNumber}</span>
                {props.typeLabel && (
                  <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
                    {props.typeLabel}
                  </span>
                )}
              </h1>
              {props.createdAt && (
                <div className="mt-1 text-xs text-slate-400">
                  أُنشئ {new Date(props.createdAt).toLocaleString('ar-SY')}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {props.headerBadges}
            <RequestStatusBadge status={props.status} requestType={props.requestType} />
            {flags.duplicate && (
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">مُكَرَّر</span>
            )}
            {flags.reviewRequired && (
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-700">يحتاج مراجعة</span>
            )}
            {flags.archived && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">مُؤرشَف</span>
            )}
            {flags.escalated && (
              <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">مُصعَّد</span>
            )}
          </div>
        </div>
        {props.infoTiles && props.infoTiles.length > 0 && (
          <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
            {props.infoTiles.map((tile) => (
              <div key={tile.label} className="bg-white px-5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</div>
                <div className="mt-0.5 text-sm font-bold text-slate-700">{tile.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {props.banners}

      {/* One workflow surface: ownership and decisions belong to the same step. */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 md:px-5">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <Clock className="h-4 w-4" />
            </span>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">مسؤول المراجعة</div>
              {props.reviewerId != null ? (
                <span className="font-semibold text-slate-800">{props.reviewerName ?? `المستخدم #${props.reviewerId}`}</span>
              ) : (
                <span className="font-semibold text-amber-700">غير مُستلَم — يجب تولّي الطلب أولاً</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">{props.ownershipActions}</div>
        </div>
        {props.decision && (
          <div className="border-t border-sky-100 bg-sky-50/60 px-4 py-3.5 md:px-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sky-700">إجراءات الطلب</div>
            {props.decision}
          </div>
        )}
      </section>

      {/* Tabs and content are one continuous detail workspace. */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5 md:px-4">
        <nav className="flex flex-wrap gap-1" aria-label="أقسام تفاصيل الطلب">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                current.id === t.id
                  ? 'bg-white text-sky-700 shadow-sm ring-1 ring-slate-100'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'
              }`}
              aria-current={current.id === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        </div>
        <div className="bg-slate-50/35 p-4 md:p-5">{current.content}</div>
      </section>

      {props.overlays}
    </div>
  );
}
