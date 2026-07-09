import React from 'react';
import { CheckCircle, History, Phone, MapPin, Layers, Star, Users, Calendar } from '../ui/icons';
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
    FOP: { label: 'FOP', cls: 'text-emerald-600' },
    OP: { label: 'OP', cls: 'text-sky-600' },
    LEAD: { label: 'LEAD', cls: 'text-slate-400' },
};

/** Normalises any raw classification/candidateStatus to FOP / OP / LEAD (or null). */
export function classificationKey(raw: string | null | undefined, entityType: 'client' | 'candidate'): 'FOP' | 'OP' | 'LEAD' | null {
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

    // Leading status rail encodes lifecycle stage; the avatar keeps its own
    // data-quality colour so the two signals don't fight.
    const rail = booked ? 'bg-emerald-400'
        : closed ? 'bg-slate-300'
        : contacted ? 'bg-amber-400'
        : 'bg-transparent';

    const classKey = classificationKey(attrs.classification, attrs.entityType);
    const classCfg = classKey ? CLASSIFICATION_CONFIG[classKey] : null;
    const rating = ratingDisplay(attrs.rating);

    const statusChip = booked ? (
        <span className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 shrink-0">
            <Calendar className="w-3.5 h-3.5" />{apptTime || 'محجوز'}
        </span>
    ) : contacted ? (
        <span className="text-xs font-bold text-amber-600 inline-flex items-center gap-1 shrink-0">
            <History className="w-3.5 h-3.5" />{contactedCount}×
        </span>
    ) : closed ? (
        <span className="text-xs font-bold text-slate-400 inline-flex items-center gap-1 shrink-0">
            <CheckCircle className="w-3.5 h-3.5" />
        </span>
    ) : null;

    const statusWord = booked ? 'محجوز' : contacted ? 'تم التواصل' : closed ? (manualClose ? 'مغلقة يدوياً' : 'مغلقة') : null;

    return (
        <button
            onClick={onClick}
            className={`no-pill w-full text-right p-2 rounded-md border transition-colors flex items-center gap-2.5 outline-none ${
                isActive
                    ? 'bg-sky-50 border-sky-400'
                    : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
            }`}
        >
            <div className={`w-1 self-stretch rounded-full shrink-0 ${rail}`} />
            <div className="relative shrink-0">
                <ClientAvatar gender={attrs.gender ?? null} dataQuality={attrs.dataQuality ?? null} size="sm" />
                {/* entity-type hint strip */}
                <span className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-5 h-1 rounded-full ${attrs.entityType === 'client' ? 'bg-sky-500' : 'bg-amber-500'}`} />
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                {/* Line 1 — full name + status chip */}
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-800 truncate">
                        {attrs.fullName}
                        {attrs.nickname && <span className="text-slate-400 font-medium"> ({attrs.nickname})</span>}
                    </p>
                    {statusChip}
                </div>

                {/* Meta — classification · status · location · indicators (one line) */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs font-bold text-slate-500">
                    {classCfg && <span className={`text-[10px] tracking-wide ${classCfg.cls}`}>{classCfg.label}</span>}
                    {statusWord && (<><span className="text-slate-300">·</span><span>{statusWord}</span></>)}
                    {attrs.stationLabel && (
                        <>
                            <span className="text-slate-300">·</span>
                            <span className="inline-flex items-center gap-0.5 min-w-0">
                                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="truncate">{attrs.stationLabel}</span>
                            </span>
                        </>
                    )}
                    {rating && (
                        <span className={`inline-flex items-center gap-0.5 ${rating.committed ? 'text-emerald-600' : 'text-amber-600'}`}>
                            <Star className="w-3 h-3" />{rating.label}
                        </span>
                    )}
                    {attrs.taskCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-purple-600">
                            <Layers className="w-3 h-3" />{attrs.taskCount}
                        </span>
                    )}
                    {otherTeamsCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-teal-600">
                            <Users className="w-3 h-3" />+{otherTeamsCount}
                        </span>
                    )}
                    {ownershipLabel && <span className="text-slate-400 truncate">{ownershipLabel}</span>}
                </div>
            </div>

            {/* Call affordance — vertically centred for in-list (no status chip) rows */}
            {!statusChip && <Phone className="w-4 h-4 text-slate-300 shrink-0 self-center" />}
        </button>
    );
}
