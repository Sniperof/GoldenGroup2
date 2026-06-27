import React from 'react';
import { CheckCircle2, CheckCircle, History, Phone, MapPin, Layers, Star, Users } from 'lucide-react';
import ClientAvatar from '../ClientAvatar';

// ─── Display attributes computed by the workspace per customer ───────────────
export interface QueueCardAttrs {
    fullName: string;
    nickname?: string | null;
    entityType: 'client' | 'candidate';
    gender?: 'male' | 'female' | null;
    dataQuality?: 'correct' | 'incorrect' | 'needs_edit' | null;
    /** Raw classification (candidateStatus): FOP / OP / Lead / … */
    classification?: string | null;
    /** Raw rating: Committed / NotCommitted / Undefined */
    rating?: string | null;
    stationLabel?: string | null;
    taskCount: number;
}

export interface QueueCardStatus {
    booked: boolean;
    closed: boolean;
    contacted: boolean;
    manualClose: boolean;
    apptTime?: string | null;
    contactedCount: number;
}

interface Props {
    attrs: QueueCardAttrs;
    status: QueueCardStatus;
    isActive: boolean;
    otherTeamsCount: number;
    ownershipLabel?: string | null;
    onClick: () => void;
}

const CLASSIFICATION_CONFIG: Record<string, { label: string; cls: string }> = {
    FOP: { label: 'FOP', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    OP: { label: 'OP', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    LEAD: { label: 'LEAD', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** Normalises any raw classification/candidateStatus to FOP / OP / LEAD (or null). */
export function classificationKey(raw: string | null | undefined, entityType: 'client' | 'candidate'): keyof typeof CLASSIFICATION_CONFIG | null {
    const u = (raw ?? '').toUpperCase();
    if (u === 'FOP') return 'FOP';
    if (u === 'OP') return 'OP';
    // Everyone else — no segment yet, candidate, 'Suggested', null — is a lead.
    // (Every customer has a classification; lead is the baseline.)
    return 'LEAD';
}

/** Normalises rating to a committed / not-committed display, or null when undefined. */
export function ratingDisplay(raw: string | null | undefined): { label: string; committed: boolean } | null {
    if (raw === 'Committed') return { label: 'ملتزم', committed: true };
    if (raw === 'NotCommitted') return { label: 'غير ملتزم', committed: false };
    return null;
}

export default function CustomerQueueCard({ attrs, status, isActive, otherTeamsCount, ownershipLabel, onClick }: Props) {
    const { booked, closed, contacted, manualClose, apptTime, contactedCount } = status;

    // Leading edge accent encodes lifecycle stage; the avatar keeps its own
    // data-quality colour so the two signals don't fight.
    const edge = booked ? 'border-r-emerald-400'
        : closed ? 'border-r-slate-300'
        : contacted ? 'border-r-amber-300'
        : 'border-r-transparent';

    const classKey = classificationKey(attrs.classification, attrs.entityType);
    const classCfg = classKey ? CLASSIFICATION_CONFIG[classKey] : null;
    const rating = ratingDisplay(attrs.rating);

    const statusChip = booked ? (
        <span className="text-[11px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1 shrink-0">
            <CheckCircle2 className="w-3 h-3" /> محجوز{apptTime ? ` ${apptTime}` : ''}
        </span>
    ) : closed ? (
        <span className="text-[11px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 shrink-0">
            {manualClose ? 'مغلقة يدوياً' : 'مغلقة'}
        </span>
    ) : contacted ? (
        <span className="text-[11px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1 shrink-0">
            <History className="w-3 h-3" /> تم التواصل ({contactedCount})
        </span>
    ) : null;

    return (
        <button
            onClick={onClick}
            className={`w-full text-right p-2 rounded-xl border-2 border-l border-y transition-all flex items-center gap-2.5 outline-none ${edge} ${
                isActive
                    ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-500/10 shadow-sm'
                    : 'bg-white border-slate-100 hover:border-violet-200 hover:bg-slate-50 hover:shadow-sm'
            }`}
        >
            <div className="relative shrink-0">
                <ClientAvatar gender={attrs.gender ?? null} dataQuality={attrs.dataQuality ?? null} size="sm" />
                {/* entity-type hint strip */}
                <span className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-1 rounded-full ${attrs.entityType === 'client' ? 'bg-sky-500' : 'bg-amber-500'}`} />
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                {/* Line 1 — full name + status chip */}
                <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-bold text-slate-800 truncate">
                        {attrs.fullName}
                        {attrs.nickname && <span className="text-slate-400 font-medium"> ({attrs.nickname})</span>}
                    </p>
                    {statusChip}
                </div>

                {/* Line 2 — classification + rating */}
                {(classCfg || rating) && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {classCfg && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${classCfg.cls}`}>{classCfg.label}</span>
                        )}
                        {rating && (
                            <span className={`text-[10px] font-bold inline-flex items-center gap-0.5 ${rating.committed ? 'text-emerald-600' : 'text-amber-600'}`}>
                                <Star className="w-3 h-3" />{rating.label}
                            </span>
                        )}
                    </div>
                )}

                {/* Line 3 — station · tasks · cross-team / ownership */}
                <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500 font-bold">
                    {attrs.stationLabel && (
                        <span className="inline-flex items-center gap-0.5 min-w-0">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{attrs.stationLabel}</span>
                        </span>
                    )}
                    {attrs.taskCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-purple-600">
                            <Layers className="w-3 h-3" />{attrs.taskCount}
                        </span>
                    )}
                    {otherTeamsCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-cyan-600">
                            <Users className="w-3 h-3" />+{otherTeamsCount}
                        </span>
                    )}
                    {ownershipLabel && (
                        <span className="text-slate-400 truncate">{ownershipLabel}</span>
                    )}
                    {closed && <CheckCircle className="w-3.5 h-3.5 text-slate-300 mr-auto" />}
                </div>
            </div>

            {/* Call affordance — vertically centred for in-list (no status chip) rows */}
            {!statusChip && <Phone className="w-4 h-4 text-slate-300 shrink-0 self-center" />}
        </button>
    );
}
