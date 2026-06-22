import React, { useEffect, useState, useCallback } from 'react';
import { Phone, Loader2, MessageSquare, PhoneMissed, Clock, Edit3 } from 'lucide-react';
import { api } from '../../lib/api';
import { getOutcomeMeta } from '@golden-crm/shared';
import type { CustomerCallLog } from '@golden-crm/shared';
import MessageReplyOutcomeModal from './MessageReplyOutcomeModal';
import Button from '../ui/Button';

interface Props {
    customerId: number;
    contactId: string;
    contactLabel: string;
    contactNumber: string;
    /** Bump this to force a refresh from the parent */
    refreshKey?: number;
    /** Max entries to show; omit for unlimited */
    limit?: number;
    /** Called when a log is updated (to refresh parent) */
    onLogUpdated?: () => void;
    canEdit?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffDays = Math.max(0, Math.floor(diffMs / 86_400_000));

        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const timeStr = `${h}:${m}`;

        if (diffDays === 0) return `اليوم ${timeStr}`;
        if (diffDays === 1) return `أمس ${timeStr}`;
        if (diffDays < 7) return `منذ ${diffDays} أيام — ${timeStr}`;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}-${month}-${year} ${timeStr}`;
    } catch {
        return dateStr;
    }
}

function channelLabel(ch?: string): string {
    switch (ch) {
        case 'cellular_call':  return 'مكالمة هاتفية';
        case 'cellular_text':  return 'رسالة نصية';
        case 'whatsapp_call':  return 'مكالمة واتساب';
        case 'whatsapp_text':  return 'رسالة واتساب';
        default:               return 'مكالمة';
    }
}

function sourceLabel(sourceType?: string): string {
    switch (sourceType) {
        case 'telemarketing_task': return 'ضمن مهمة';
        case 'direct_call': return 'اتصال حر';
        default: return sourceType ? `مصدر: ${sourceType}` : 'مصدر غير محدد';
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

function OutcomeIcon({ outcome, status, channel }: { outcome: string; status?: string; channel?: string }) {
    const isTextChannel = channel?.includes('text');
    if (status === 'pending') return <Clock className="w-4 h-4 text-amber-500" />;
    if (isTextChannel) return <MessageSquare className="w-4 h-4 text-sky-500" />;
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

export default function PhoneCallLog({ customerId, contactId, contactLabel, contactNumber, refreshKey, limit, onLogUpdated, canEdit = true }: Props) {
    const [logs, setLogs] = useState<CustomerCallLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [editLog, setEditLog] = useState<CustomerCallLog | null>(null);

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

    const displayLogs = limit ? logs.slice(0, limit) : logs;
    const hasMore = limit && logs.length > limit;

    return (
        <div className="space-y-3">
            {displayLogs.map((log) => {
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
                                <OutcomeIcon outcome={log.outcome} status={log.status} channel={log.communicationChannel} />
                                <span className="font-bold text-slate-800 text-sm">{meta.label}</span>
                                {log.status === 'pending' && (
                                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                                        منتظر رد
                                    </span>
                                )}
                            </div>
                            <span className="text-slate-400 font-mono text-xs bg-white border border-slate-100 px-2 py-0.5 rounded-lg shadow-sm whitespace-nowrap">
                                {formatDate(log.callDate)}
                            </span>
                        </div>

                        {log.notes && (
                            <p className="text-xs text-slate-500 leading-relaxed mb-1">{log.notes}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {log.callerName && (
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                                    {log.callerName}
                                </span>
                            )}
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                                {chLabel}
                            </span>
                            <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded font-bold border border-violet-100">
                                {sourceLabel(log.sourceType)}
                            </span>
                            {abLabel && (
                                <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded font-bold border border-violet-100">
                                    {abLabel}
                                </span>
                            )}
                            {canEdit && log.status === 'pending' && log.communicationChannel?.includes('text') && (
                                <button
                                    onClick={() => setEditLog(log)}
                                    className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded font-bold border border-amber-100 hover:bg-amber-100 transition-colors flex items-center gap-1"
                                >
                                    <Edit3 className="w-3 h-3" /> تعديل النتيجة
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
            {hasMore && (
                <Button
                    variant="ghost"
                    size="sm"
                    fullWidth
                    onClick={() => window.dispatchEvent(new CustomEvent('switchToCallLogTab'))}
                >
                    عرض الكل ({logs.length}) →
                </Button>
            )}
            {editLog && (
                <MessageReplyOutcomeModal
                    isOpen={true}
                    onClose={() => setEditLog(null)}
                    logId={editLog.id}
                    onSave={async (outcome, notes) => {
                        try {
                            await api.customerCalls.update(editLog.id, {
                                outcome,
                                notes: notes || null,
                                status: 'completed',
                            });
                            setEditLog(null);
                            fetchLogs();
                            onLogUpdated?.();
                        } catch (err) {
                            console.error('Failed to update log:', err);
                        }
                    }}
                />
            )}
        </div>
    );
}
