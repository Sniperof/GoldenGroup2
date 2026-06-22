import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Phone, Loader2, PhoneMissed, Clock, Filter, MessageSquare, Edit3, Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { getOutcomeMeta, TelemarketingOutcomeCode } from '@golden-crm/shared';
import type { CustomerCallLog as CallLogEntry } from '@golden-crm/shared';
import MessageReplyOutcomeModal from './MessageReplyOutcomeModal';
import Select from '../ui/Select';
import Card from '../ui/Card';

interface Props {
    customerId: number;
    /** Bump to force refresh */
    refreshKey?: number;
    canEdit?: boolean;
}

// ── Filter types ──────────────────────────────────────────────────────────────

type ChannelFilter = 'all' | 'cellular_call' | 'cellular_text' | 'whatsapp_call' | 'whatsapp_text';
type StatusFilter = 'all' | 'completed' | 'pending';
type PeriodFilter = 'all' | 'today' | 'yesterday' | 'last_week' | 'last_month';
type OutcomeGroupFilter = 'all' | 'not_reached' | 'follow_up' | 'service_request' | 'reached' | 'booked';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateGroup(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        const now = new Date();
        const diffDays = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
        if (diffDays === 0) return 'اليوم';
        if (diffDays === 1) return 'أمس';
        if (diffDays < 7) return `منذ ${diffDays} أيام`;
        if (diffDays < 14) return 'منذ أسبوع';
        if (diffDays < 30) return 'منذ أسبوعين أو أكثر';
        const months = ['يناير','فبراير','مارس','أبريل','مايو','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];
        return `${months[d.getMonth()]} ${d.getFullYear()}`;
    } catch {
        return dateStr.split('T')[0];
    }
}

function formatTime(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    } catch { return ''; }
}

function dateKey(dateStr: string): string {
    return new Date(dateStr).toDateString();
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

function channelIcon(ch?: string): React.ReactNode {
    if (ch?.includes('whatsapp')) return <MessageSquare className="w-3 h-3" />;
    return <Phone className="w-3 h-3" />;
}

function maskedNumber(num?: string): string {
    if (!num) return '---';
    if (num.length <= 4) return num;
    return num.slice(0, -4).replace(/\d/g, '*') + num.slice(-4);
}

function matchesPeriod(dateStr: string, period: PeriodFilter): boolean {
    if (period === 'all') return true;
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    switch (period) {
        case 'today':      return diffDays === 0;
        case 'yesterday':  return diffDays === 1;
        case 'last_week':  return diffDays < 7;
        case 'last_month': return diffDays < 30;
    }
}

function outcomeGroupIcon(outcome: string, status?: string, channel?: string): React.ReactNode {
    if (status === 'pending') return <Clock className="w-3.5 h-3.5 text-amber-500" />;
    if (channel?.includes('text')) return <MessageSquare className="w-3.5 h-3.5 text-sky-500" />;
    const group = getOutcomeMeta(outcome).group;
    if (group === 'not_reached') return <PhoneMissed className="w-3.5 h-3.5 text-red-400" />;
    return <Phone className="w-3.5 h-3.5 text-emerald-500" />;
}

function borderColor(outcome: string, status?: string): string {
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

// ── Filter bar subcomponent ───────────────────────────────────────────────────

function FilterSelect<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
}) {
    return (
        <Select<T>
            value={value}
            onChange={onChange}
            ariaLabel={label}
            size="sm"
            options={options}
        />
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomerCallLog({ customerId, refreshKey, canEdit = true }: Props) {
    const [logs, setLogs] = useState<CallLogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [editLog, setEditLog] = useState<CallLogEntry | null>(null);

    // Filters
    const [channel, setChannel] = useState<ChannelFilter>('all');
    const [status, setStatus] = useState<StatusFilter>('all');
    const [period, setPeriod] = useState<PeriodFilter>('all');
    const [outcomeGroup, setOutcomeGroup] = useState<OutcomeGroupFilter>('all');
    const [caller, setCaller] = useState<string>('all');

    const callerOptions = useMemo(() => {
        const names = new Set<string>(
            logs.map(l => l.callerName).filter((name): name is string => Boolean(name)),
        );
        return [{ value: 'all', label: 'المتصل: الكل' }, ...Array.from(names).map(n => ({ value: n, label: n }))];
    }, [logs]);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.customerCalls.list(customerId);
            setLogs(data);
        } catch {
            setLogs([]);
        } finally {
            setLoading(false);
        }
    }, [customerId]);

    useEffect(() => { fetchLogs(); }, [fetchLogs, refreshKey]);

    // Client-side filtering
    const filtered = useMemo(() => {
        return logs.filter(log => {
            if (channel !== 'all' && log.communicationChannel !== channel) return false;
            if (status !== 'all' && log.status !== status) return false;
            if (!matchesPeriod(log.callDate, period)) return false;
            if (outcomeGroup !== 'all') {
                const g = getOutcomeMeta(log.outcome).group;
                if (outcomeGroup === 'not_reached' && g !== 'not_reached') return false;
                if (outcomeGroup === 'follow_up' && g !== 'follow_up') return false;
                if (outcomeGroup === 'service_request' && g !== 'service_request') return false;
                if (outcomeGroup === 'booked' && g !== 'booked') return false;
                if (outcomeGroup === 'reached' && (g === 'not_reached' || g === 'booked')) return false;
            }
            if (caller !== 'all' && log.callerName !== caller) return false;
            return true;
        });
    }, [logs, channel, status, period, outcomeGroup, caller]);

    // Group by date
    const grouped = useMemo(() => {
        const map = new Map<string, { label: string; entries: CallLogEntry[] }>();
        for (const log of filtered) {
            const key = dateKey(log.callDate);
            if (!map.has(key)) {
                map.set(key, { label: formatDateGroup(log.callDate), entries: [] });
            }
            map.get(key)!.entries.push(log);
        }
        return Array.from(map.values());
    }, [filtered]);

    return (
        <div className="space-y-5">
            {/* Filter bar */}
            <Card padding="sm" className="flex flex-wrap items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400 shrink-0" />

                <FilterSelect<ChannelFilter>
                    label="القناة"
                    value={channel}
                    onChange={setChannel}
                    options={[
                        { value: 'all', label: 'القناة: الكل' },
                        { value: 'cellular_call', label: 'مكالمة هاتفية' },
                        { value: 'cellular_text', label: 'رسالة نصية' },
                        { value: 'whatsapp_call', label: 'مكالمة واتساب' },
                        { value: 'whatsapp_text', label: 'رسالة واتساب' },
                    ]}
                />

                <FilterSelect<StatusFilter>
                    label="الحالة"
                    value={status}
                    onChange={setStatus}
                    options={[
                        { value: 'all', label: 'الحالة: الكل' },
                        { value: 'completed', label: 'مكتمل' },
                        { value: 'pending', label: 'منتظر رد' },
                    ]}
                />

                <FilterSelect<OutcomeGroupFilter>
                    label="النتيجة"
                    value={outcomeGroup}
                    onChange={setOutcomeGroup}
                    options={[
                        { value: 'all', label: 'النتيجة: الكل' },
                        { value: 'not_reached', label: 'لم يتم التواصل' },
                        { value: 'follow_up', label: 'متابعة لاحقاً' },
                        { value: 'service_request', label: 'طلب خدمة' },
                        { value: 'reached', label: 'تم التواصل' },
                        { value: 'booked', label: 'حجز موعد' },
                    ]}
                />

                <FilterSelect<PeriodFilter>
                    label="الفترة"
                    value={period}
                    onChange={setPeriod}
                    options={[
                        { value: 'all', label: 'الفترة: الكل' },
                        { value: 'today', label: 'اليوم' },
                        { value: 'yesterday', label: 'أمس' },
                        { value: 'last_week', label: 'آخر أسبوع' },
                        { value: 'last_month', label: 'آخر شهر' },
                    ]}
                />

                <Select
                    value={caller}
                    onChange={setCaller}
                    ariaLabel="المتصل"
                    size="sm"
                    options={callerOptions}
                />

                {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 mr-auto" />}
                {!loading && (
                    <span className="text-xs text-slate-400 font-bold mr-auto">
                        {filtered.length} سجل
                    </span>
                )}
            </Card>

            {/* Timeline */}
            {!loading && grouped.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                    <Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-bold text-sm">لا توجد سجلات مطابقة</p>
                </div>
            )}

            {grouped.map((group, gi) => (
                <Card key={gi} padding="none" className="overflow-hidden">
                    <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100">
                        <span className="text-xs font-black text-slate-500 uppercase tracking-wide">{group.label}</span>
                    </div>
                    <div className="divide-y divide-slate-50">
                        {group.entries.map(log => {
                            const meta = getOutcomeMeta(log.outcome);
                            const bc = borderColor(log.outcome, log.status);
                            return (
                                <div
                                    key={log.id}
                                    className={`flex items-start gap-3 px-5 py-4 border-r-4 ${bc} hover:bg-slate-50/70 transition-colors`}
                                >
                                    <div className="shrink-0 mt-0.5">
                                        {outcomeGroupIcon(log.outcome, log.status, log.communicationChannel)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <span className="font-bold text-sm text-slate-800">{meta.label}</span>
                                                {log.status === 'pending' && (
                                                    <span className="mr-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                                                        منتظر رد
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-slate-400 font-mono whitespace-nowrap shrink-0">
                                                {formatTime(log.callDate)}
                                            </span>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            {log.contactLabel && (
                                                <span className="text-xs bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded font-bold">
                                                    {log.contactLabel} ({maskedNumber(log.contactNumber)})
                                                </span>
                                            )}
                                            <span className="flex items-center gap-1 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                                                {channelIcon(log.communicationChannel)}
                                                {channelLabel(log.communicationChannel)}
                                            </span>
                                            <span className="text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded font-bold border border-violet-100">
                                                {sourceLabel(log.sourceType)}
                                            </span>
                                            {log.callerName && (
                                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">
                                                    {log.callerName}
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

                                        {/* Linked tasks — show when call covered multiple tasks */}
                                        {Array.isArray((log as any).linkedTasks) && (log as any).linkedTasks.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                                <span className="flex items-center gap-1 text-xs text-violet-600 font-bold">
                                                    <Layers className="w-3 h-3" />
                                                    {(log as any).linkedTasks.length} مهام:
                                                </span>
                                                {(log as any).linkedTasks.map((t: any) => (
                                                    <span key={t.taskId} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded font-bold">
                                                        {t.arabicLabel}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {log.notes && (
                                            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{log.notes}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            ))}
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
                        } catch (err) {
                            console.error('Failed to update log:', err);
                        }
                    }}
                />
            )}
        </div>
    );
}
