import type { LucideIcon } from 'lucide-react';
import { ChevronRight, UserRound, Clock, MapPin, Tag, Link2 } from 'lucide-react';
import {
  OPEN_TASK_STATUS_LABELS, OPEN_TASK_PHASE_LABELS, OPEN_TASK_PHASE_COLORS,
  OPEN_TASK_TYPE_LABELS, getTaskPhase, type OpenTaskStatus,
} from '@golden-crm/shared';
import { formatDateTime } from './shared';
import Button from '../ui/Button';

// Mirror of DB CHECK on open_tasks.task_family — 8 families.
const TASK_FAMILY_LABELS: Record<string, string> = {
  marketing:   'تسويق',
  sales:       'مبيعات',
  delivery:    'تسليم',
  maintenance: 'صيانة',
  emergency:   'طوارئ',
  collection:  'تحصيل',
  service:     'خدمة',
  warranty:    'كفالة',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  open: 'bg-sky-50 text-sky-700 border-sky-200',
  needs_follow_up: 'bg-amber-50 text-amber-700 border-amber-200',
  assigned: 'bg-violet-50 text-violet-700 border-violet-200',
  in_scheduling: 'bg-blue-50 text-blue-700 border-blue-200',
  scheduled: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  waiting_execution: 'bg-teal-50 text-teal-700 border-teal-200',
  in_execution: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ended: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  completed: 'bg-green-50 text-green-700 border-green-100',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
  cancelled: 'bg-slate-200 text-slate-600 border-slate-300',
};

function getPeriodicSupersessionLabel(task: any): string | null {
  const reason = task.periodicSupersession?.reason;
  if (reason === 'superseded_within_emergency') return 'مُكتفى عنها بطارئة';
  if (reason === 'superseded_within_periodic') return 'مُكتفى عنها بدورية';
  return null;
}

export interface TaskHeaderProps {
  task: any;
  /** Icon for this task type */
  typeIcon: LucideIcon;
  /** Color hint for the type icon */
  typeIconColor?: string;
  /** Back link label and target */
  backLabel: string;
  backHref: string;
  onBack: () => void;
  /** Optional action buttons rendered at the end */
  actions?: React.ReactNode;
}

export default function TaskHeader({ task, typeIcon: TypeIcon, typeIconColor = 'text-indigo-500', backLabel, onBack, actions }: TaskHeaderProps) {
  const phase = (task.phase ?? getTaskPhase(task.status as OpenTaskStatus)) as keyof typeof OPEN_TASK_PHASE_LABELS;
  const statusLabel = OPEN_TASK_STATUS_LABELS[task.status as keyof typeof OPEN_TASK_STATUS_LABELS] ?? task.status;
  const statusColor = TASK_STATUS_COLORS[task.status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  const typeLabel = OPEN_TASK_TYPE_LABELS[task.taskType as keyof typeof OPEN_TASK_TYPE_LABELS] ?? task.taskType;
  const periodicSupersessionLabel = getPeriodicSupersessionLabel(task);

  return (
    <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={onBack} icon={ChevronRight}>
            {backLabel}
          </Button>
          <span className="text-slate-300">/</span>
          <div className="flex items-center gap-2 flex-wrap">
            <TypeIcon className={`w-5 h-5 ${typeIconColor}`} />
            <span className="text-sm font-bold text-slate-800">تفاصيل مهمة {typeLabel} #{task.id}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${OPEN_TASK_PHASE_COLORS[phase]}`}>
              {OPEN_TASK_PHASE_LABELS[phase]}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold border ${statusColor}`}>
              {statusLabel}
            </span>
            {periodicSupersessionLabel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Link2 className="w-3 h-3" />
                {periodicSupersessionLabel}
              </span>
            )}
            {task.taskFamily && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                {TASK_FAMILY_LABELS[task.taskFamily] ?? task.taskFamily}
              </span>
            )}
            {task.originRefId && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200" title="ناتجة عن مهمة سابقة">
                <Link2 className="w-3 h-3" />
                مشتقّة من #{task.originRefId}
              </span>
            )}
          </div>
        </div>

        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100">
          <Tag className="w-3 h-3" />
          {typeLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {formatDateTime(task.createdAt)}
        </span>
        {task.branchName && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            {task.branchName}
          </span>
        )}
        {task.clientSnapshot?.name && (
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="w-3 h-3" />
            {task.clientSnapshot.name}
          </span>
        )}
      </div>
    </div>
  );
}
