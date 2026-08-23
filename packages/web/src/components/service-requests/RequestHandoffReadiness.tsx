import { AlertTriangle, ArrowUpCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import Button from '../ui/Button';

export default function RequestHandoffReadiness({
  request,
  title,
  missing,
  permissionDenied = false,
  onOpenTask,
}: {
  request: any;
  title: string;
  missing: string[];
  permissionDenied?: boolean;
  onOpenTask: (taskId: number) => void;
}) {
  const taskId = Number(request.linkedOpenTaskId);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpCircle className="h-5 w-5 text-sky-600" />
        <h2 className="text-lg font-black text-slate-800">جاهزية التسليم</h2>
      </div>
      {Number.isInteger(taskId) && taskId > 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <CheckCircle2 className="h-4 w-4" />
              تم تسليم الطلب إلى {title} رقم #{taskId}
            </div>
            <Button variant="secondary" size="sm" icon={ExternalLink} onClick={() => onOpenTask(taskId)}>
              فتح المهمة
            </Button>
          </div>
          <div className="mt-2 text-xs text-emerald-800">
            الحالة: {request.linkedOpenTaskStatus ?? 'مفتوحة'}
            {request.linkedOpenTaskPriority ? ` · الأولوية: ${request.linkedOpenTaskPriority}` : ''}
          </div>
        </div>
      ) : permissionDenied ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          لا تملك الصلاحية المطلوبة لإنشاء {title} ضمن نطاق هذا الطلب.
        </div>
      ) : missing.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-black">
            <AlertTriangle className="h-4 w-4" />
            الطلب غير جاهز للتسليم؛ يلزم استكمال:
          </div>
          <ul className="mt-2 list-disc space-y-1 pe-5">
            {missing.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          الطلب جاهز لإنشاء {title}. استخدم إجراء التسليم أعلى الصفحة.
        </div>
      )}
    </section>
  );
}
