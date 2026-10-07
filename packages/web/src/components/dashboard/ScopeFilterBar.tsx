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
    // Mobile: each filter is a full-width row whose Select fills the line (no
    // dead space beside a shrunk pill). ≥md: filters sit inline with a fixed
    // Select width.
    <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="flex items-center gap-2.5 text-slate-600">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Clock className="h-4 w-4" />
          </span>
          <span className="w-12 shrink-0 text-xs font-bold">الفترة</span>
          <Select<TimePreset>
            value={preset}
            onChange={onPresetChange}
            options={TIME_PRESET_OPTIONS}
            variant="filled"
            className="flex-1 md:w-44 md:flex-none"
          />
        </div>
      </div>
    </div>
  );
}
