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
    <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm mb-6">
      <div className="flex items-center gap-2 text-slate-500">
        <Clock className="w-4 h-4 text-sky-500" />
        <span className="text-xs font-medium">الفترة</span>
      </div>
      <Select<TimePreset>
        value={value.preset}
        onChange={preset => onChange({ ...value, preset })}
        options={TIME_PRESET_OPTIONS}
        variant="filled"
      />

      {canPickBranch && (
        <>
          <div className="flex items-center gap-2 text-slate-500 mr-2">
            <Building2 className="w-4 h-4 text-sky-500" />
            <span className="text-xs font-medium">النطاق</span>
          </div>
          <Select<number>
            value={value.branchId ?? ALL_BRANCHES}
            onChange={branchId => onChange({ ...value, branchId: branchId === ALL_BRANCHES ? null : branchId })}
            options={branchOptions}
            variant="filled"
          />
        </>
      )}
    </div>
  );
}
