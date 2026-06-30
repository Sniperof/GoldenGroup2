import React, { useMemo } from 'react';
import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react';

// ─── Time helpers ────────────────────────────────────────────────────────────

/** Trim any value (HH:MM, HH:MM:SS, range "HH:MM-HH:MM") down to a bare HH:MM. */
export const normalizeVisitTime = (value: string | null | undefined): string =>
    String(value || '').slice(0, 5);

/**
 * The conflict rule mirrors the backend (visitBooking.ts:assertTeamSlotAvailable):
 * a team may not have two visits at the exact same HH:MM on the same date.
 * Any other minute is free — booking is fully flexible.
 */
export const isVisitTimeConflict = (
    value: string,
    bookedTimes: Array<string | null | undefined>,
): boolean => {
    const v = normalizeVisitTime(value);
    if (!v) return false;
    return bookedTimes.some(t => normalizeVisitTime(t) === v);
};

interface VisitTimePickerProps {
    value: string;
    onChange: (value: string) => void;
    /** HH:MM times already booked for the SAME team on the same date. */
    bookedTimes?: Array<string | null | undefined>;
    /** Optional soft working-hours bounds — passed straight to the input. */
    minTime?: string;
    maxTime?: string;
    /** Visual accent — matches the host modal (emerald by default). */
    accent?: 'emerald';
    label?: string;
    required?: boolean;
}

/**
 * Shared free-time picker for booking a marketing visit.
 *
 * Replaces the legacy hourly <Select> (getHourlyVisitSlots) used across the
 * outcome recorder and the standalone scheduler. The telemarketer may now pick
 * ANY time; the only restriction — enforced both here (live) and in the backend
 * (409 on save) — is that the chosen time is not already taken by the same team.
 */
export default function VisitTimePicker({
    value,
    onChange,
    bookedTimes = [],
    minTime,
    maxTime,
    label = 'وقت الزيارة',
    required = true,
}: VisitTimePickerProps) {
    const normalizedBooked = useMemo(() => {
        const set = new Set<string>();
        bookedTimes.forEach(t => {
            const n = normalizeVisitTime(t);
            if (n) set.add(n);
        });
        return Array.from(set).sort();
    }, [bookedTimes]);

    const current = normalizeVisitTime(value);
    const hasConflict = !!current && normalizedBooked.includes(current);

    return (
        <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-emerald-500" />
                {label} {required && <span className="text-red-500">*</span>}
            </label>

            <input
                type="time"
                step={300}
                min={minTime}
                max={maxTime}
                value={current}
                onChange={e => onChange(e.target.value)}
                dir="ltr"
                className={`w-full rounded-xl px-4 py-2.5 text-sm font-bold bg-slate-50 border focus:bg-white focus:outline-none focus:ring-2 transition-colors ${
                    hasConflict
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
                        : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20'
                }`}
            />

            {/* Booked-times awareness for the team */}
            {normalizedBooked.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs font-bold text-slate-400">
                        أوقات محجوزة لهذا الفريق اليوم — تجنّبها:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {normalizedBooked.map(t => {
                            const isClash = t === current;
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => onChange(t)}
                                    title="هذا الوقت محجوز — اضغط للاطلاع"
                                    className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md border transition-colors ${
                                        isClash
                                            ? 'bg-red-100 text-red-700 border-red-300'
                                            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                    }`}
                                >
                                    {t}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Live validity hint */}
            {current && (
                hasConflict ? (
                    <p className="flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        هذا الوقت محجوز للفريق — اختر وقتاً آخر.
                    </p>
                ) : (
                    <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        الوقت <span dir="ltr" className="font-mono">{current}</span> متاح.
                    </p>
                )
            )}
        </div>
    );
}
