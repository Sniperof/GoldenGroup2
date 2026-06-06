import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  ListChecks,
  Hash,
  Video,
  Zap,
  Users,
  UserRound,
  Wrench,
  Target,
} from 'lucide-react';
import { api } from '../../lib/api';
import type { TaskDetailData } from '../../components/tasks/types';
import { Card, EmptyState } from '../../components/tasks/shared';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Deadline({ createdAt, dueWithinHours }: { createdAt: string; dueWithinHours: number }) {
  const deadline = new Date(new Date(createdAt).getTime() + dueWithinHours * 3_600_000);
  const nowMs = Date.now();
  const diffMs = deadline.getTime() - nowMs;
  const expired = diffMs <= 0;
  const diffH = Math.abs(Math.floor(diffMs / 3_600_000));
  const diffMin = Math.abs(Math.floor((diffMs % 3_600_000) / 60_000));

  const label = expired
    ? `تجاوز الموعد بـ ${diffH} س ${diffMin} د`
    : diffH < 1
      ? `${diffMin} دقيقة متبقية`
      : `${diffH} ساعة ${diffMin} د متبقية`;

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border ${
        expired
          ? 'bg-red-50 text-red-700 border-red-200'
          : diffH < 4
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      <Clock className="h-4 w-4 shrink-0" />
      {label}
      <span className="mr-auto text-[10px] font-normal opacity-70">SLA: {dueWithinHours} ساعة</span>
    </div>
  );
}

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  Critical: { label: 'حرجة', cls: 'bg-red-50 text-red-700 border-red-200' },
  High: { label: 'عالية', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Normal: { label: 'عادية', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  Low: { label: 'منخفضة', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const PROBLEM_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  reported: { label: 'مُبلَّغ', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  confirmed: { label: 'مُؤكَّد', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  resolved_at_intake: { label: 'حُلَّ في الاستلام', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  resolved: { label: 'حُلَّ', cls: 'bg-green-50 text-green-700 border-green-200' },
  deferred: { label: 'مؤجَّل', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  unresolvable_field: { label: 'غير قابل ميدانياً', cls: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'مُلغى', cls: 'bg-slate-200 text-slate-500 border-slate-300' },
};

// ── Team card (mirrors device_demo DeviceDemoOfferTab pattern) ────────────────

function TeamCard({ team }: { team: any }) {
  if (!team) return null;
  const roles = [
    { key: 'supervisor', label: 'مشرف', icon: UserRound, bg: 'bg-indigo-50', text: 'text-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { key: 'technician', label: 'فني',  icon: Wrench,    bg: 'bg-sky-50',     text: 'text-sky-500',    badge: 'bg-sky-50 text-sky-700 border-sky-200' },
    { key: 'trainee',    label: 'متدرب', icon: Users,    bg: 'bg-amber-50',   text: 'text-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  ];
  const present = roles.filter((r) => team[r.key]?.name);
  if (present.length === 0) return null;

  return (
    <Card title="الفريق المُكلَّف" icon={Users}>
      <div className="grid gap-3 md:grid-cols-3">
        {present.map((item) => (
          <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.bg}`}>
                <item.icon className={`w-4 h-4 ${item.text}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{item.label}</p>
                <p className="text-sm font-semibold text-slate-800 truncate">{team[item.key].name}</p>
              </div>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${item.badge}`}>{item.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Goal indicator: resolved/total + progress bar ─────────────────────────────

function GoalIndicator({ problems }: { problems: any[] }) {
  const active = problems.filter((p) => p.status !== 'cancelled');
  const total = active.length;
  if (total === 0) return null;
  const resolved = active.filter((p) => p.status === 'resolved' || p.status === 'resolved_at_intake').length;
  const deferred = active.filter((p) => p.status === 'deferred').length;
  const unresolvable = active.filter((p) => p.status === 'unresolvable_field').length;
  const pct = Math.round((resolved / total) * 100);
  const fullyDone = resolved === total;
  const barColor = fullyDone ? 'bg-emerald-500' : pct >= 50 ? 'bg-sky-500' : 'bg-amber-500';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-rose-500" />
          <span className="text-sm font-bold text-slate-700">مؤشِّر إنجاز الأَعطال</span>
        </div>
        <span className={`text-xs font-black px-2.5 py-1 rounded-lg border ${
          fullyDone ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : pct >= 50 ? 'bg-sky-50 text-sky-700 border-sky-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {resolved} / {total} محلولة ({pct}%)
        </span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {(deferred > 0 || unresolvable > 0) && (
        <div className="mt-2 flex gap-1.5 flex-wrap text-[10px] font-bold">
          {deferred > 0 && (
            <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5">
              مؤجَّلة: {deferred}
            </span>
          )}
          {unresolvable > 0 && (
            <span className="rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5">
              غير قابلة: {unresolvable}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmergencyDetailsTab({ data }: { data: TaskDetailData }) {
  const { task } = data as { task: any };
  const sourceSrId: number | null = task.sourceServiceRequestId ?? null;

  const [loading, setLoading] = useState(true);
  // New path — service_request payload
  const [sr, setSr] = useState<any>(null);
  const [problems, setProblems] = useState<any[]>([]);
  // Legacy path — emergency_tickets
  const [ticket, setTicket] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (sourceSrId) {
        try {
          const res = await api.serviceRequests.get(sourceSrId);
          if (!cancelled) {
            setSr(res.request);
            setProblems((res.problems ?? []).filter((p: any) => p.deletedAt == null));
          }
        } catch {
          if (!cancelled) {
            setSr(null);
            setProblems([]);
          }
        }
      } else {
        try {
          const rows = await api.emergencyTickets.list({ openTaskId: task.id });
          if (!cancelled) setTicket(rows?.[0] ?? null);
        } catch {
          if (!cancelled) setTicket(null);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceSrId, task.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
      </div>
    );
  }

  // ── New path: service_request-backed task ───────────────────────────────────
  if (sourceSrId && sr) {
    const callNote = (data as any).auditLog?.find?.((e: any) => e.eventType === 'internal_note_added');
    const attachments: any[] = Array.isArray(sr.attachments) ? sr.attachments : [];
    const images = attachments.filter(
      (a: any) => a.type === 'image' || (!a.type && !String(a.url ?? a).match(/\.(mp4|mov|avi|webm)/i)),
    );
    const videos = attachments.filter(
      (a: any) => a.type === 'video' || String(a.url ?? a).match(/\.(mp4|mov|avi|webm)/i),
    );

    return (
      <div className="space-y-5">
        <Deadline createdAt={sr.createdAt} dueWithinHours={48} />

        {/* #5 — Team card mirrors device_demo pattern */}
        <TeamCard team={task.teamSnapshot} />

        {/* #6 — Goal indicator: resolved/total + progress bar */}
        <GoalIndicator problems={problems} />

        {/* Overview from the service_request */}
        <Card title="تفاصيل الطلب" icon={Zap}>
          <div className="divide-y divide-slate-100">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs font-bold text-slate-400">رقم الطلب</span>
              <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-700">
                <Hash className="h-3 w-3 text-slate-400" /> {sr.publicRefNumber}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs font-bold text-slate-400">القناة</span>
              <span className="text-sm font-medium text-slate-700">{sr.channel}</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-xs font-bold text-slate-400">الأولوية</span>
              {sr.priority ? (
                <span
                  className={`text-[11px] font-bold rounded-full border px-2.5 py-0.5 ${
                    (PRIORITY_META[sr.priority] ?? PRIORITY_META.Normal).cls
                  }`}
                >
                  {(PRIORITY_META[sr.priority] ?? PRIORITY_META.Normal).label}
                </span>
              ) : (
                <span className="text-sm text-slate-300">—</span>
              )}
            </div>
          </div>
        </Card>

        {/* Problem description — from the service_request (immutable) */}
        {sr.problemDescription && (
          <Card title="وصف المشكلة" icon={FileText}>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {sr.problemDescription}
            </p>
          </Card>
        )}

        {/* Call notes — first internal_note_added on the request */}
        {callNote?.note && (
          <Card title="ملاحظات المكالمة" icon={FileText}>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{callNote.note}</p>
          </Card>
        )}

        {/* Problems list (moved from service_request to this open_task) */}
        <Card title={`لائحة الأعطال (${problems.length})`} icon={ListChecks}>
          {problems.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="لا أعطال مُسجَّلة"
              description="أُنشئ الطلب بدون أعطال — يُمكن إضافتها من شاشة طلب الصيانة."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {problems.map((p: any) => {
                const meta = PROBLEM_STATUS_LABELS[p.status] ?? PROBLEM_STATUS_LABELS.reported;
                return (
                  <li key={p.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs text-slate-400">#{p.id}</span>
                        <span className="text-sm font-bold text-slate-800">
                          {p.problemTypeLabel ?? `نوع #${p.problemTypeId}`}
                        </span>
                        <span
                          className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                        {p.addedDuringPhase === 'field_discovery' && (
                          <span className="text-[10px] font-bold rounded-full border px-2 py-0.5 bg-violet-50 text-violet-700 border-violet-200">
                            مُكتشَف ميدانياً
                          </span>
                        )}
                      </div>
                      {p.details && (
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{p.details}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Attachments */}
        {(images.length > 0 || videos.length > 0) && (
          <Card title="المرفقات" icon={ImageIcon}>
            {images.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                  <ImageIcon className="h-3 w-3" /> صور ({images.length})
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {images.map((img: any, i: number) => (
                    <a
                      key={i}
                      href={img.url ?? img}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="aspect-square rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 transition-colors"
                    >
                      <img
                        src={img.url ?? img}
                        alt={img.name ?? `صورة ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
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
                    <video
                      key={i}
                      src={vid.url ?? vid}
                      controls
                      className="w-full rounded-xl border border-slate-200 max-h-48 bg-black"
                    />
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

  // ── Legacy path: emergency_tickets ──────────────────────────────────────────
  if (!ticket) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="لا توجد بيانات طوارئ مرتبطة بهذه المهمة"
        description="قد تكون المهمة أُنشئت يدوياً بدون طلب صيانة."
      />
    );
  }

  const images = (ticket.attachments ?? []).filter(
    (a: any) => a.type === 'image' || (!a.type && !String(a.url ?? a).match(/\.(mp4|mov|avi|webm)/i)),
  );
  const videos = (ticket.attachments ?? []).filter(
    (a: any) => a.type === 'video' || String(a.url ?? a).match(/\.(mp4|mov|avi|webm)/i),
  );

  return (
    <div className="space-y-5">
      <Deadline createdAt={ticket.createdAt} dueWithinHours={ticket.dueWithinHours ?? 48} />

      <Card title="تفاصيل الطلب" icon={Zap}>
        <div className="divide-y divide-slate-100">
          <div className="flex items-center justify-between py-2.5">
            <span className="text-xs font-bold text-slate-400">الأولوية</span>
            {ticket.priority ? (
              <span
                className={`text-[11px] font-bold rounded-full border px-2.5 py-0.5 ${
                  (PRIORITY_META[ticket.priority] ?? PRIORITY_META.Normal).cls
                }`}
              >
                {(PRIORITY_META[ticket.priority] ?? PRIORITY_META.Normal).label}
              </span>
            ) : (
              <span className="text-sm text-slate-300">—</span>
            )}
          </div>
        </div>
      </Card>

      {ticket.problemDescription && (
        <Card title="وصف المشكلة" icon={FileText}>
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {ticket.problemDescription}
          </p>
        </Card>
      )}

      {ticket.callNotes && (
        <Card title="ملاحظات المكالمة" icon={FileText}>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{ticket.callNotes}</p>
        </Card>
      )}

      {(images.length > 0 || videos.length > 0) && (
        <Card title="المرفقات" icon={ImageIcon}>
          {images.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                <ImageIcon className="h-3 w-3" /> صور ({images.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {images.map((img: any, i: number) => (
                  <a
                    key={i}
                    href={img.url ?? img}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 transition-colors"
                  >
                    <img
                      src={img.url ?? img}
                      alt={img.name ?? `صورة ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
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
                  <video
                    key={i}
                    src={vid.url ?? vid}
                    controls
                    className="w-full rounded-xl border border-slate-200 max-h-48 bg-black"
                  />
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
