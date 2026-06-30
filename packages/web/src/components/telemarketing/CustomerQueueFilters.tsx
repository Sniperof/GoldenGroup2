import React from 'react';
import { Filter, ChevronDown, X, ArrowDownUp, UserSearch, MapPin, History, Layers, Tag, Star } from 'lucide-react';
import Select from '../ui/Select';

export interface FilterOption { value: string; label: string; }

export interface ActiveChip { key: string; label: string; onRemove: () => void; }

export type QueueSortMode = 'station' | 'ct_status';

interface Props {
    open: boolean;
    onToggle: () => void;
    activeCount: number;
    activeChips: ActiveChip[];
    onClearAll: () => void;

    referrer: string;
    setReferrer: (v: string) => void;
    referrerOptions: FilterOption[];

    station: string;
    setStation: (v: string) => void;
    stationOptions: FilterOption[];

    lastOutcome: string;
    setLastOutcome: (v: string) => void;
    outcomeOptions: FilterOption[];

    taskType: string;
    setTaskType: (v: string) => void;
    taskTypeOptions: FilterOption[];

    classification: string[];
    toggleClassification: (v: string) => void;

    rating: string[];
    toggleRating: (v: string) => void;

    sortMode: QueueSortMode;
    setSortMode: (v: QueueSortMode) => void;
}

const CLASSIFICATION_CHIPS: { value: string; label: string; on: string }[] = [
    { value: 'FOP', label: 'FOP', on: 'bg-emerald-600 border-emerald-600 text-white' },
    { value: 'OP', label: 'OP', on: 'bg-sky-600 border-sky-600 text-white' },
    { value: 'LEAD', label: 'LEAD', on: 'bg-slate-600 border-slate-600 text-white' },
];

const RATING_CHIPS: { value: string; label: string; on: string }[] = [
    { value: 'Committed', label: 'ملتزم', on: 'bg-emerald-600 border-emerald-600 text-white' },
    { value: 'NotCommitted', label: 'غير ملتزم', on: 'bg-amber-500 border-amber-500 text-white' },
];

const SORT_CHIPS: { value: QueueSortMode; label: string }[] = [
    { value: 'station', label: 'ترتيب نطاق العمل' },
    { value: 'ct_status', label: 'حالة جهة الاتصال' },
];

function FieldLabel({ icon: Icon, children, hint }: { icon: any; children: React.ReactNode; hint?: string }) {
    return (
        <label className="text-xs font-bold text-slate-600 flex items-center gap-1 mb-1">
            <Icon className="w-3 h-3 text-slate-400" />
            {children}
            {hint && <span className="text-slate-400 font-normal">{hint}</span>}
        </label>
    );
}

export default function CustomerQueueFilters(props: Props) {
    const {
        open, onToggle, activeCount, activeChips, onClearAll,
        referrer, setReferrer, referrerOptions,
        station, setStation, stationOptions,
        lastOutcome, setLastOutcome, outcomeOptions,
        taskType, setTaskType, taskTypeOptions,
        classification, toggleClassification,
        rating, toggleRating,
        sortMode, setSortMode,
    } = props;

    const withAll = (opts: FilterOption[], allLabel: string): FilterOption[] => [{ value: '', label: allLabel }, ...opts];

    return (
        <div className="border-b border-slate-100">
            {/* Toggle row */}
            <button
                type="button"
                onClick={onToggle}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-violet-500" /> الفلاتر
                    {activeCount > 0 && (
                        <span className="text-xs font-bold bg-violet-600 text-white rounded-full px-1.5 py-0.5 leading-none">{activeCount}</span>
                    )}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {/* Active chips */}
            {activeChips.length > 0 && (
                <div className="px-2 pb-2 flex flex-wrap items-center gap-1">
                    {activeChips.map(chip => (
                        <span key={chip.key} className="text-xs font-bold text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                            {chip.label}
                            <button type="button" onClick={chip.onRemove} aria-label="إزالة" className="hover:text-violet-900">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                    <button type="button" onClick={onClearAll} className="text-xs font-bold text-slate-400 hover:text-slate-600 mr-auto">
                        مسح الكل
                    </button>
                </div>
            )}

            {/* Panel */}
            {open && (
                <div className="px-3 pb-3 space-y-3 bg-slate-50/60">
                    <div>
                        <FieldLabel icon={UserSearch} hint="(ضمن القائمة)">الوسيط</FieldLabel>
                        <Select<string> value={referrer} onChange={setReferrer} className="w-full" options={withAll(referrerOptions, 'كل الوسطاء')} />
                    </div>

                    <div>
                        <FieldLabel icon={MapPin}>محطة نطاق العمل</FieldLabel>
                        <Select<string> value={station} onChange={setStation} className="w-full" options={withAll(stationOptions, 'كل المحطات')} />
                    </div>

                    <div>
                        <FieldLabel icon={History}>آخر نتيجة اتصال</FieldLabel>
                        <Select<string> value={lastOutcome} onChange={setLastOutcome} className="w-full" options={withAll(outcomeOptions, 'الكل')} />
                    </div>

                    <div>
                        <FieldLabel icon={Layers}>نوع مهمة جهة الاتصال</FieldLabel>
                        <Select<string> value={taskType} onChange={setTaskType} className="w-full" options={withAll(taskTypeOptions, 'الكل')} />
                    </div>

                    <div>
                        <FieldLabel icon={Tag}>التصنيف</FieldLabel>
                        <div className="flex gap-1.5">
                            {CLASSIFICATION_CHIPS.map(c => {
                                const on = classification.includes(c.value);
                                return (
                                    <button key={c.value} type="button" onClick={() => toggleClassification(c.value)}
                                        className={`flex-1 text-center text-xs font-bold py-1.5 rounded-lg border-2 transition-all ${on ? c.on : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                        {c.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <FieldLabel icon={Star}>التقييم</FieldLabel>
                        <div className="flex gap-1.5">
                            {RATING_CHIPS.map(c => {
                                const on = rating.includes(c.value);
                                return (
                                    <button key={c.value} type="button" onClick={() => toggleRating(c.value)}
                                        className={`flex-1 text-center text-xs font-bold py-1.5 rounded-lg border-2 transition-all ${on ? c.on : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                        {c.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="border-t border-slate-200 pt-2.5">
                        <FieldLabel icon={ArrowDownUp}>الفرز</FieldLabel>
                        <div className="flex gap-1.5">
                            {SORT_CHIPS.map(c => (
                                <button key={c.value} type="button" onClick={() => setSortMode(c.value)}
                                    className={`flex-1 text-center text-xs font-bold py-1.5 rounded-lg border-2 transition-all ${sortMode === c.value ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
