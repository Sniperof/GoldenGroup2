// Visual badge for the outcome state of a single device-demo pre-offer.
//
// The five states map 1:1 with the SQL state machine in
// `packages/api/routes/customerPreOffers.ts` — keep them in sync.
//
// On "accepted" the chip contains a link to the signed contract. On
// "rejected" / "not_chosen" we surface the reason as a hover tooltip so
// planners can see *why* the offer didn't land without leaving the tab.

import { Link } from 'react-router-dom';
import { Check, Clock, X, Minus, AlertTriangle } from 'lucide-react';

export type PreOfferOutcomeState =
  | 'not_presented_yet'
  | 'needs_follow_up'
  | 'accepted'
  | 'not_chosen'
  | 'rejected';

interface Props {
  state: PreOfferOutcomeState;
  contractId?: number | null;
  contractNumber?: string | null;
  noClosingReason?: string | null;
  finalDecisionCode?: string | null;
}

const STYLES: Record<PreOfferOutcomeState, { cls: string; Icon: any; label: string }> = {
  not_presented_yet: {
    cls:   'bg-slate-100 text-slate-600 border border-slate-200',
    Icon:  Clock,
    label: 'لم تُعرض بعد',
  },
  needs_follow_up: {
    cls:   'bg-amber-50 text-amber-700 border border-amber-200',
    Icon:  AlertTriangle,
    label: 'بانتظار متابعة',
  },
  accepted: {
    cls:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
    Icon:  Check,
    label: 'مقبول',
  },
  not_chosen: {
    cls:   'bg-orange-50 text-orange-700 border border-orange-200',
    Icon:  Minus,
    label: 'لم يُختر',
  },
  rejected: {
    cls:   'bg-rose-50 text-rose-700 border border-rose-200',
    Icon:  X,
    label: 'مرفوض',
  },
};

export function OutcomeChip({
  state, contractId, contractNumber, noClosingReason, finalDecisionCode,
}: Props) {
  const s = STYLES[state];
  const Icon = s.Icon;

  // accepted → clickable link to the signed contract.
  if (state === 'accepted' && contractId) {
    return (
      <Link
        to={`/contracts/${contractId}`}
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold transition-opacity hover:opacity-80 ${s.cls}`}
        title="فتح العقد المرتبط"
      >
        <Icon className="w-3 h-3" />
        {s.label}
        {contractNumber && (
          <span className="rounded-lg bg-white/70 px-1.5 py-0.5 font-mono text-[10px] opacity-90">
            عقد #{contractNumber}
          </span>
        )}
      </Link>
    );
  }

  // not_chosen → mention the contract that was signed instead (if known).
  if (state === 'not_chosen' && contractNumber) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold ${s.cls}`}
        title={`وُقّع عقد على جهاز آخر (#${contractNumber})`}
      >
        <Icon className="w-3 h-3" />
        {s.label}
      </span>
    );
  }

  // rejected → tooltip with the closing reason or final_decision code.
  const tooltip = state === 'rejected'
    ? (noClosingReason || finalDecisionCode || 'لم يُسجّل سبب')
    : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold ${s.cls}`}
      title={tooltip}
    >
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

export default OutcomeChip;
