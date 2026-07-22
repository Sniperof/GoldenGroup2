// ============================================================
// ScopeFilterBar — شريط النطاق العام (reporting-analytics §1.1 / §6.5)
// ============================================================
// يطبّق البُعد الزمني + الفرع على كل widgets الداشبورد دفعةً واحدة. منتقي الفرع
// يظهر فقط لمن يملك اتساع GLOBAL (يقدر يتنقّل بين كل الفروع وفرع بعينه)؛ صاحب
// BRANCH/ASSIGNED مُقيّد بنطاقه على الخادم فلا يُعرض له المنتقي.
// ============================================================

import Select from '../ui/Select';
import { Clock, Building2 } from 'lucide-react';
import { TIME_PRESET_OPTIONS, type ScopeState, type TimePreset } from './widgetRegistry';

export interface BranchOption {
  id: number;
  name: string;
}

interface Props {
  value: ScopeState;
  onChange: (next: ScopeState) => void;
  canPickBranch: boolean;
  branches: BranchOption[];
}

const ALL_BRANCHES = 0;

export default function ScopeFilterBar({ value, onChange, canPickBranch, branches }: Props) {
  const branchOptions = [
    { value: ALL_BRANCHES, label: 'كل الفروع' },
    ...branches.map(b => ({ value: b.id, label: b.name })),
  ];

  return (
    <div className="mb-8 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 md:flex md:flex-wrap md:items-center">
      <div className="flex min-w-0 items-center gap-2 text-slate-600">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          <Clock className="h-4 w-4" />
        </span>
        <span className="shrink-0 text-xs font-bold">الفترة</span>
        <div className="min-w-0 flex-1 md:flex-none">
          <Select<TimePreset>
            value={value.preset}
            onChange={preset => onChange({ ...value, preset })}
            options={TIME_PRESET_OPTIONS}
            variant="filled"
          />
        </div>
      </div>

      {canPickBranch && (
        <div className="flex min-w-0 items-center gap-2 text-slate-600 md:mr-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="shrink-0 text-xs font-bold">النطاق</span>
            <div className="min-w-0 flex-1 md:flex-none">
              <Select<number>
                value={value.branchId ?? ALL_BRANCHES}
                onChange={branchId => onChange({ ...value, branchId: branchId === ALL_BRANCHES ? null : branchId })}
                options={branchOptions}
                variant="filled"
              />
            </div>
          </div>
      )}
    </div>
  );
}
