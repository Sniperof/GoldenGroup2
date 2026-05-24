import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, FileText, Image, Loader2, Tag, Video, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import type { TaskDetailData } from '../../components/tasks/types';
import { Card, EmptyState } from '../../components/tasks/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Deadline({ createdAt, dueWithinHours }: { createdAt: string; dueWithinHours: number }) {
  const deadline = new Date(new Date(createdAt).getTime() + dueWithinHours * 3_600_000);
  const nowMs     = Date.now();
  const diffMs    = deadline.getTime() - nowMs;
  const expired   = diffMs <= 0;
  const diffH     = Math.abs(Math.floor(diffMs / 3_600_000));
  const diffMin   = Math.abs(Math.floor((diffMs % 3_600_000) / 60_000));

  const label = expired
    ? `تجاوز الموعد بـ ${diffH} س ${diffMin} د`
    : diffH < 1
      ? `${diffMin} دقيقة متبقية`
      : `${diffH} ساعة ${diffMin} د متبقية`;

  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border ${
      expired      ? 'bg-red-50 text-red-700 border-red-200'
      : diffH < 4  ? 'bg-amber-50 text-amber-700 border-amber-200'
      :               'bg-emerald-50 text-emerald-700 border-emerald-200'
    }`}>
      <Clock className="h-4 w-4 shrink-0" />
      {label}
      <span className="mr-auto text-[10px] font-normal opacity-70">
        SLA: {dueWithinHours} ساعة
      </span>
    </div>
  );
}

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  Critical: { label: 'حرجة',  cls: 'bg-red-50 text-red-700 border-red-200' },
  High:     { label: 'عالية', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Normal:   { label: 'عادية', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmergencyDetailsTab({ data }: { data: TaskDetailData }) {
  const { task } = data;
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.emergencyTickets.list({ openTaskId: task.id })
      .then((rows: any[]) => setTicket(rows[0] ?? null))
      .catch(() => setTicket(null))
      .finally(() => setLoading(false));
  }, [task.id]);

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-rose-500" /></div>
  );

  if (!ticket) return (
    <EmptyState icon={AlertTriangle} title="لا توجد بيانات طوارئ مرتبطة بهذه المهمة" description="قد تكون المهمة أُنشئت يدوياً بدون تذكرة طوارئ." />
  );

  const images = (ticket.attachments ?? []).filter((a: any) => a.type === 'image' || (!a.type && !String(a.url ?? a).match(/\.(mp4|mov|avi|webm)/i)));
  const videos = (ticket.attachments ?? []).filter((a: any) => a.type === 'video' || String(a.url ?? a).match(/\.(mp4|mov|avi|webm)/i));

  return (
    <div className="space-y-5">
      {/* Deadline */}
      <Deadline createdAt={ticket.createdAt} dueWithinHours={ticket.dueWithinHours ?? 48} />

      {/* Overview card */}
      <Card title="تفاصيل الطلب" icon={Zap}>
        <div className="divide-y divide-slate-100">
          {/* Priority */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs font-bold text-slate-400">الأولوية</span>
            {ticket.priority ? (
              <span className={`text-[11px] font-bold rounded-full border px-2.5 py-0.5 ${(PRIORITY_META[ticket.priority] ?? PRIORITY_META.Normal).cls}`}>
                {(PRIORITY_META[ticket.priority] ?? PRIORITY_META.Normal).label}
              </span>
            ) : <span className="text-sm text-slate-300">—</span>}
          </div>

          {/* Action type */}
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs font-bold text-slate-400">نوع الإجراء</span>
            {ticket.actionTypeLabel ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-0.5">
                <Tag className="h-3 w-3" /> {ticket.actionTypeLabel}
              </span>
            ) : <span className="text-sm text-slate-300">لم يُحدَّد</span>}
          </div>

          {/* Call receiver */}
          {ticket.callReceiver && (
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs font-bold text-slate-400">استلم المكالمة</span>
              <span className="text-sm font-medium text-slate-700">{ticket.callReceiver}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Problem description */}
      {ticket.problemDescription && (
        <Card title="وصف المشكلة" icon={FileText}>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{ticket.problemDescription}</p>
        </Card>
      )}

      {/* Call notes */}
      {ticket.callNotes && (
        <Card title="ملاحظات المكالمة" icon={FileText}>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{ticket.callNotes}</p>
        </Card>
      )}

      {/* Attachments */}
      {(images.length > 0 || videos.length > 0) && (
        <Card title="المرفقات" icon={Image}>
          {images.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                <Image className="h-3 w-3" /> صور ({images.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {images.map((img: any, i: number) => (
                  <a key={i} href={img.url ?? img} target="_blank" rel="noopener noreferrer"
                    className="aspect-square rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 transition-colors">
                    <img src={img.url ?? img} alt={img.name ?? `صورة ${i + 1}`}
                      className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {videos.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                <Video className="h-3 w-3" /> فيديو ({videos.length})
              </p>
              <div className="space-y-2">
                {videos.map((vid: any, i: number) => (
                  <video key={i} src={vid.url ?? vid} controls
                    className="w-full rounded-xl border border-slate-200 max-h-48 bg-black" />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
