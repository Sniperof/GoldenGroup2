// ============================================================
// ScopeFilterBar — شريط النطاق الزمني للداشبورد (reporting-analytics §1.1 / §6.5)
// ============================================================
// يطبّق البُعد الزمني على كل widgets الداشبورد دفعةً واحدة. بُعد الفرع لم يعد
// هنا: مصدره الوحيد هو مبدّل الفروع الخارجي (سياق الفرع)، فلا ازدواج ضوابط على
// صفحة واحدة. صاحب BRANCH/ASSIGNED مُقيّد بنطاقه على الخادم تلقائياً.
// ============================================================

import Select from '../ui/Select';
import { Clock } from 'lucide-react';
import { TIME_PRESET_OPTIONS, type TimePreset } from './widgetRegistry';

interface Props {
  preset: TimePreset;
  onPresetChange: (next: TimePreset) => void;
}

export default function ScopeFilterBar({ preset, onPresetChange }: Props) {
  return (
    <div className="mb-8 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 md:flex md:flex-wrap md:items-center">
      <div className="flex min-w-0 items-center gap-2 text-slate-600">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          <Clock className="h-4 w-4" />
        </span>
        <span className="shrink-0 text-xs font-bold">الفترة</span>
        <div className="min-w-0 flex-1 md:flex-none">
          <Select<TimePreset>
            value={preset}
            onChange={onPresetChange}
            options={TIME_PRESET_OPTIONS}
            variant="filled"
          />
        </div>
      </div>
    </div>
  );
}
