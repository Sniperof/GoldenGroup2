// All open_tasks belonging to this device. The list is filtered client-side
// because /api/open-tasks/client/:clientId returns the client's full task feed.

import { Link } from 'react-router-dom';
import { SectionShell } from './SectionShell';

interface Props {
  tasks: any[];
  deviceId: number;
}

const STATUS_LABEL: Record<string, { cls: string; label: string }> = {
  open:              { cls: 'bg-amber-100 text-amber-700',     label: 'مفتوحة' },
  in_progress:       { cls: 'bg-sky-100 text-sky-700',         label: 'قيد التنفيذ' },
  completed:         { cls: 'bg-emerald-100 text-emerald-700', label: 'مكتملة' },
  cancelled:         { cls: 'bg-slate-100 text-slate-500',     label: 'ملغاة' },
  needs_follow_up:   { cls: 'bg-rose-100 text-rose-700',       label: 'تحتاج متابعة' },
};

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

export function TasksSection({ tasks, deviceId }: Props) {
  const myTasks = (tasks ?? []).filter(t => t.deviceId === deviceId);

  return (
    <SectionShell
      id="tasks"
      title="المهام المرتبطة"
      subtitle="كل المهام الميدانية على هذا الجهاز"
    >
      {myTasks.length === 0 ? (
        <p className="text-xs text-slate-400 italic">لا مهام مرتبطة بهذا الجهاز.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-slate-400 font-bold">
            <tr className="border-b border-slate-100">
              <th className="text-right py-2 px-2">#</th>
              <th className="text-right py-2 px-2">النوع</th>
              <th className="text-right py-2 px-2">العائلة</th>
              <th className="text-right py-2 px-2">تاريخ الاستحقاق</th>
              <th className="text-right py-2 px-2">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {myTasks.map(t => {
              const st = STATUS_LABEL[t.status] ?? { cls: 'bg-slate-100 text-slate-600', label: t.status };
              return (
                <tr key={t.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 px-2 font-mono text-slate-500">
                    <Link to={`/tasks/${t.id}`} className="hover:text-sky-600 hover:underline">#{t.id}</Link>
                  </td>
                  <td className="py-2 px-2 text-slate-700">{t.taskType}</td>
                  <td className="py-2 px-2 text-slate-500">{t.taskFamily}</td>
                  <td className="py-2 px-2 text-slate-700">{fmt(t.dueDate)}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionShell>
  );
}

export default TasksSection;
