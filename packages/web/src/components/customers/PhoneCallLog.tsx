import React, { useEffect, useState, useCallback } from 'react';
import { Phone, Loader2, MessageSquare, PhoneMissed, Clock } from 'lucide-react';
import { api } from '../../lib/api';
import { getOutcomeMeta } from '@golden-crm/shared';
import type { CustomerCallLog } from '@golden-crm/shared';

interface Props {
    customerId: number;
    contactId: string;
    contactLabel: string;
    contactNumber: string;
    /** Bump this to force a refresh from the parent */
    refreshKey?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffDays = Math.floor(diffMs / 86_400_000);

        const timeStr = d.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });

        if (diffDays === 0) return `اليوم ${timeStr}`;
        if (diffDays === 1) return `أمس ${timeStr}`;
        if (diffDays < 7) return `منذ ${diffDays} أيام — ${timeStr}`;
        return d.toLocaleDateString('ar-SY', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ` ${timeStr}`;
    } catch {
        return dateStr;
    }
}

function channelLabel(ch?: string): string {
    switch (ch) {
        case 'cellular_call':  return 'مكالمة خلوية';
        case 'cellular_text':  return 'رسالة خلوية';
        case 'whatsapp_call':  return 'مكالمة واتساب';
        case 'whatsapp_text':  return 'رسالة واتساب';
        default:               return 'مكالمة';
    }
}

function answeredByLabel(ab?: string): string {
    switch (ab) {
        case 'customer': return 'ردّ: الزبون';
        case 'spouse':   return 'ردّ: الزوج/الزوجة';
        case 'child':    return 'ردّ: الولد/البنت';
        default:         return '';
    }
}

function OutcomeIcon({ outcome, status }: { outcome: string; status?: string }) {
    if (status === 'pending') return <Clock className="w-4 h-4 text-amber-500" />;
    const group = getOutcomeMeta(outcome).group;
    if (group === 'not_reached') return <PhoneMissed className="w-4 h-4 text-red-400" />;
    if (group === 'service_request') return <Phone className="w-4 h-4 text-indigo-500" />;
    if (group === 'booked') return <span className="text-sm">✅</span>;
    return <Phone className="w-4 h-4 text-emerald-500" />;
}

function groupBorderColor(outcome: string, status?: string): string {
    if (status === 'pending') return 'border-amber-400';
    const group = getOutcomeMeta(outcome).group;
    switch (group) {
        case 'not_reached':     return 'border-slate-300';
        case 'follow_up':       return 'border-amber-400';
        case 'service_request': return 'border-violet-400';
        case 'booked':          return 'border-emerald-500';
        default:                return 'border-sky-400';
    }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PhoneCallLog({ customerId, contactId, contactLabel, contactNumber, refreshKey }: Props) {
    const [logs, setLogs] = useState<CustomerCallLog[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await (api.customerCalls as any).listByContact(customerId, contactId);
            setLogs(data);
        } catch {
            setLogs([]);
        } finally {
            setLoading(false);
        }
    }, [customerId, contactId]);

    useEffect(() => { fetchLogs(); }, [fetchLogs, refreshKey]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <p className="text-xs text-slate-400 text-center py-4">
                لا يوجد سجل مكالمات لهذا الرقم بعد
            </p>
        );
    }

    return (
        <div className="space-y-3">
            {logs.map((log) => {
                const meta = getOutcomeMeta(log.outcome);
                const borderColor = groupBorderColor(log.outcome, log.status);
                const abLabel = answeredByLabel(log.answeredBy);
                const chLabel = channelLabel(log.communicationChannel);

                return (
                    <div
                        key={log.id}
                        className={`relative pr-5 border-r-2 ${borderColor} pl-2 group hover:bg-slate-50 rounded-l-xl py-2 transition-colors`}
                    >
                        <div className={`absolute top-3 -right-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 ${borderColor} flex items-center justify-center`}>
                        </div>

                        <div className="flex items-start justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                                <OutcomeIcon outcome={log.outcome} status={log.status} />
                                <span className="font-bold text-slate-800 text-sm">{meta.label}</span>
                                {log.status === 'pending' && (
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                                        منتظر رد
                                    </span>
                                )}
                            </div>
                            <span className="text-slate-400 font-mono text-[10px] bg-white border border-slate-100 px-2 py-0.5 rounded-md shadow-sm whitespace-nowrap">
                                {formatDate(log.callDate)}
                            </span>
                        </div>

                        {log.notes && (
                            <p className="text-xs text-slate-500 leading-relaxed mb-1">{log.notes}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {log.callerName && (
                                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                                    {log.callerName}
                                </span>
                            )}
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                                {chLabel}
                            </span>
                            {abLabel && (
                                <span className="text-[10px] bg-violet-50 text-violet-600 px-2 py-0.5 rounded font-bold border border-violet-100">
                                    {abLabel}
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
