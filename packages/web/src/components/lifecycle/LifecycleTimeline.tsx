// The lifecycle timeline shared by the client and the device profiles: one
// vertical timeline, newest first, grouped by year and month, with category
// chips to filter. Each profile loads its own events (derived on the server),
// resolves their links and decision titles, and supplies its categories and
// summary; this component only lays them out.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronLeft, Route, type LucideIcon } from '../ui/icons';

export type LifecycleTone = { icon: string; chipOn: string; pill: string };

export interface LifecycleCategoryMeta {
    label: string;
    icon: LucideIcon;
    tone: LifecycleTone;
}

export interface TimelineEvent {
    key: string;
    category: string;
    kind: string;
    /** ISO timestamp, or YYYY-MM-DD when dateOnly. */
    at: string;
    dateOnly: boolean;
    reliable: boolean;
    /** Final wording (a task outcome already carries its decision label). */
    title: string;
    detail: string | null;
    actor: string | null;
    href: string | null;
}

// Lines rendered at once; the rest behind «عرض المزيد» (a big account has ~900).
const PAGE = 150;

type Row = { lead: TimelineEvent; events: TimelineEvent[] };
type Month = { key: string; rows: Row[]; count: number };

function toDate(event: TimelineEvent) {
    return new Date(event.dateOnly ? `${event.at}T12:00:00` : event.at);
}

// Arabic words, Latin digits — like the rest of the system's tables.
const LOCALE = 'ar-SY-u-nu-latn';

function formatDayNumber(event: TimelineEvent) {
    return String(toDate(event).getDate());
}

function formatWeekday(event: TimelineEvent) {
    try {
        return toDate(event).toLocaleDateString(LOCALE, { weekday: 'short' });
    } catch {
        return '';
    }
}

function formatDay(event: TimelineEvent) {
    try {
        return toDate(event).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
    } catch {
        return event.at.slice(0, 10);
    }
}

function formatTime(event: TimelineEvent) {
    if (event.dateOnly) return null;
    try {
        return toDate(event).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch {
        return null;
    }
}

export function formatLifecycleDate(value: string | null) {
    if (!value) return '—';
    try {
        return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(LOCALE, { dateStyle: 'medium' });
    } catch {
        return value;
    }
}

function monthLabel(key: string) {
    try {
        return new Date(`${key}-15T12:00:00`).toLocaleDateString(LOCALE, { month: 'long' });
    } catch {
        return key;
    }
}

// Within a month, consecutive events that read the same (12 periodic visits
// «نُفّذت») fold into one row that expands.
function buildMonths(events: TimelineEvent[]): Month[] {
    const months: Month[] = [];
    for (const e of events) {
        const key = e.at.slice(0, 7);
        let month = months[months.length - 1];
        if (month?.key !== key) {
            month = { key, rows: [], count: 0 };
            months.push(month);
        }
        month.count += 1;
        const last = month.rows[month.rows.length - 1];
        if (last && last.lead.kind === e.kind && last.lead.title === e.title && last.lead.reliable === e.reliable) {
            last.events.push(e);
        } else {
            month.rows.push({ lead: e, events: [e] });
        }
    }
    return months;
}

export function LifecycleStat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
    return (
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                <div className="truncate text-sm font-black text-slate-800">{value}</div>
            </div>
        </div>
    );
}

function EventLine({ event, nested = false }: { event: TimelineEvent; nested?: boolean }) {
    const time = formatTime(event);
    // Inside a folded group the title is the group's: each line is its date.
    const title = nested
        ? <span className="text-xs font-semibold text-slate-700">{formatDay(event)}{time ? ` · ${time}` : ''}</span>
        : <span className="text-sm font-bold text-slate-800">{event.title}</span>;
    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {event.href ? (
                    <Link to={event.href} className="group inline-flex items-center gap-1 hover:text-sky-700">
                        <span className="group-hover:underline">{title}</span>
                        <ChevronLeft className="h-4 w-4 text-slate-300 group-hover:text-sky-600" />
                    </Link>
                ) : title}
                {!event.reliable && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> تاريخ غير موثوق
                    </span>
                )}
            </div>
            {(event.detail || event.actor) && (
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                    {event.detail && <span>{event.detail}</span>}
                    {event.actor && <span className="text-slate-400">بواسطة {event.actor}</span>}
                </div>
            )}
        </div>
    );
}

function TimelineRow({
    row, categories, kindOverrides,
}: {
    row: Row;
    categories: Record<string, LifecycleCategoryMeta>;
    kindOverrides: Record<string, { icon: LucideIcon; tone: string }>;
}) {
    const [open, setOpen] = useState(false);
    const e = row.lead;
    const meta = categories[e.category];
    const override = kindOverrides[e.kind];
    const Icon = override?.icon ?? meta.icon;
    const many = row.events.length > 1;
    const time = formatTime(e);

    return (
        <li className="relative flex gap-3 pb-4 last:pb-0">
            {/* Day column — the month is in the section header */}
            <div className="w-12 shrink-0 pt-0.5 text-center leading-tight">
                <div className="text-lg font-black text-slate-700">{formatDayNumber(e)}</div>
                <div className="text-[10px] font-semibold text-slate-400">{formatWeekday(e)}</div>
                {time && !many && <div className="text-[10px] text-slate-400" dir="ltr">{time}</div>}
            </div>
            {/* Marker on the rail */}
            <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${override?.tone ?? meta.tone.icon}`}>
                <Icon className="h-4 w-4" />
            </span>
            {/* Content */}
            <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-2">
                    {many ? (
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-slate-800">{e.title}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">×{row.events.length}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(v => !v)}
                                className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
                            >
                                {open ? 'إخفاء التفاصيل' : `عرض ${row.events.length} أحداث`}
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                            </button>
                        </div>
                    ) : (
                        <EventLine event={e} />
                    )}
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${meta.tone.pill}`}>{meta.label}</span>
                </div>
                {many && open && (
                    <ul className="mt-2 grid gap-x-4 gap-y-2 border-t border-slate-100 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                        {row.events.map(item => (
                            <li key={item.key}><EventLine event={item} nested /></li>
                        ))}
                    </ul>
                )}
            </div>
        </li>
    );
}

export default function LifecycleTimeline({
    title,
    events,
    categories,
    hiddenCategories,
    kindOverrides = {},
    summary,
}: {
    title: string;
    events: TimelineEvent[];
    categories: Record<string, LifecycleCategoryMeta>;
    hiddenCategories: string[];
    kindOverrides?: Record<string, { icon: LucideIcon; tone: string }>;
    summary?: ReactNode;
}) {
    const order = Object.keys(categories);
    const [active, setActive] = useState<Set<string>>(new Set(order));
    const [shown, setShown] = useState(PAGE);

    const counts = useMemo(() => {
        const map: Record<string, number> = {};
        events.forEach(e => { map[e.category] = (map[e.category] ?? 0) + 1; });
        return map;
    }, [events]);

    const filtered = useMemo(() => events.filter(e => active.has(e.category)), [events, active]);
    const months = useMemo(() => buildMonths(filtered.slice(0, shown)), [filtered, shown]);

    const toggle = (category: string) => {
        setActive(prev => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category); else next.add(category);
            return next;
        });
        setShown(PAGE);
    };
    const onlyThis = (category: string) => {
        setActive(new Set([category]));
        setShown(PAGE);
    };
    const unreliable = events.filter(e => !e.reliable).length;
    const allOn = order.filter(c => counts[c]).every(c => active.has(c));

    return (
        <div className="space-y-4">
            {summary && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    {summary}
                </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white">
                {/* Filters */}
                <div className="border-b border-slate-100 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="text-base font-black text-slate-800">{title}</h3>
                        <span className="text-xs font-semibold text-slate-400">{filtered.length} من {events.length} حدثاً</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {!allOn && (
                            <button
                                type="button"
                                onClick={() => { setActive(new Set(order)); setShown(PAGE); }}
                                className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                            >
                                الكل
                            </button>
                        )}
                        {order.filter(c => counts[c]).map(c => {
                            const meta = categories[c];
                            const Icon = meta.icon;
                            const on = active.has(c);
                            return (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => toggle(c)}
                                    onDoubleClick={() => onlyThis(c)}
                                    title="نقرة: إظهار/إخفاء — نقرتان: هذه الفئة فقط"
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition-colors ${
                                        on ? meta.tone.chipOn : 'border-slate-200 bg-white text-slate-400 line-through decoration-slate-300'
                                    }`}
                                >
                                    <Icon className="h-3.5 w-3.5" /> {meta.label}
                                    <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-white/80' : 'bg-slate-100'}`}>{counts[c]}</span>
                                </button>
                            );
                        })}
                    </div>
                    {(unreliable > 0 || hiddenCategories.length > 0) && (
                        <div className="mt-3 space-y-1 text-xs">
                            {unreliable > 0 && (
                                <p className="flex items-center gap-1.5 text-amber-700">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    {unreliable} حدثاً بتاريخ غير موثوق (بيانات مرحّلة)، وقد لا تكون في موضعها الصحيح.
                                </p>
                            )}
                            {hiddenCategories.length > 0 && (
                                <p className="text-slate-400">
                                    لا تظهر هنا: {hiddenCategories.map(c => categories[c]?.label ?? c).join('، ')}، لأنها خارج صلاحياتك.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Timeline */}
                <div className="p-4">
                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                            <Route className="h-8 w-8" />
                            <p className="text-sm">لا توجد أحداث لعرضها</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {months.map((month, i) => {
                                const year = month.key.slice(0, 4);
                                const newYear = i === 0 || months[i - 1].key.slice(0, 4) !== year;
                                return (
                                    <section key={month.key}>
                                        {newYear && (
                                            <div className="mb-3 flex items-center gap-3">
                                                <span className="text-lg font-black text-slate-800">{year}</span>
                                                <span className="h-px flex-1 bg-slate-200" />
                                            </div>
                                        )}
                                        <div className="mb-2 flex items-center gap-2">
                                            <span className="text-sm font-black text-slate-600">{monthLabel(month.key)}</span>
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{month.count}</span>
                                        </div>
                                        <ol className="relative">
                                            {/* The rail runs through the marker column (day column 3rem + gap). */}
                                            <span className="absolute bottom-2 right-[calc(3rem+0.75rem+1rem-1px)] top-2 w-0.5 bg-slate-100" aria-hidden />
                                            {month.rows.map(row => (
                                                <TimelineRow key={row.lead.key} row={row} categories={categories} kindOverrides={kindOverrides} />
                                            ))}
                                        </ol>
                                    </section>
                                );
                            })}
                            {filtered.length > shown && (
                                <button
                                    type="button"
                                    onClick={() => setShown(n => n + PAGE)}
                                    className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
                                >
                                    عرض المزيد ({filtered.length - shown} حدثاً أقدم)
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
