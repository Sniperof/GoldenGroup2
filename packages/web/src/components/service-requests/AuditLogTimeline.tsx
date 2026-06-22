// ============================================================
// AuditLogTimeline — chronological view of service_request audit events
// Constitution: maintenance.md §٠.١٧ + §٠.١٩.و
// ============================================================
import { Clock, User, AlertTriangle, CheckCircle2, X, ArrowRight, MessageSquare, Wrench } from 'lucide-react';

interface AuditEvent {
  id: number;
  eventType: string;
  eventPayload: Record<string, unknown> | null;
  actorUserId: number | null;
  actorRole: string;
  note: string | null;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  request_created: 'إنشاء الطلب',
  status_changed: 'تغيير الحالة',
  claimed_by_operator: 'تَولّي الـ Operator',
  claim_transferred: 'نَقل الـ claim',
  review_required_flag_set: 'رفع علم مراجعة',
  duplicate_flag_set: 'رفع علم تَكرار',
  party_linked: 'ربط مستفيد',
  linkage_changed: 'تَغيير الربط',
  candidate_created: 'إنشاء مرشّح',
  priority_changed: 'تَغيير الأولوية',
  escalated_to_audit_admin: 'تَصعيد للمدقّق',
  rejected_decision: 'قرار رفض',
  promoted_to_task: 'ترقية لمهمة',
  merged_into_existing_task: 'دمج مع مهمة قائمة',
  cancelled_by_admin: 'إلغاء إداري',
  customer_info_requested: 'طلب معلومة من الزبون',
  customer_info_received: 'استلام ردّ الزبون',
  internal_note_added: 'ملاحظة داخلية',
  archived: 'أرشفة',
  unarchived: 'إلغاء الأرشفة',
  request_reopened: 'إعادة فتح',
  problem_added: 'إضافة عطل',
  problem_edited: 'تعديل عطل',
  problem_status_changed: 'تَغيير حالة عطل',
  problem_resolution_recorded: 'تَسجيل نتيجة عطل',
  problem_soft_deleted: 'حذف عطل',
  problem_restored: 'استعادة عطل',
  problem_audit_admin_override: 'تجاوز مدقّق على عطل',
};

function iconFor(eventType: string) {
  if (eventType.startsWith('problem_')) return <Wrench className="h-4 w-4" />;
  if (eventType === 'rejected_decision' || eventType === 'cancelled_by_admin') return <X className="h-4 w-4" />;
  if (eventType === 'promoted_to_task' || eventType === 'merged_into_existing_task') return <CheckCircle2 className="h-4 w-4" />;
  if (eventType.includes('flag_set') || eventType === 'escalated_to_audit_admin') return <AlertTriangle className="h-4 w-4" />;
  if (eventType === 'internal_note_added') return <MessageSquare className="h-4 w-4" />;
  if (eventType === 'status_changed' || eventType === 'request_reopened') return <ArrowRight className="h-4 w-4" />;
  if (eventType.includes('claim')) return <User className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

function colorFor(eventType: string): string {
  if (eventType === 'rejected_decision' || eventType.includes('soft_deleted')) return 'bg-red-100 text-red-700';
  if (eventType === 'promoted_to_task' || eventType === 'merged_into_existing_task') return 'bg-green-100 text-green-700';
  if (eventType.includes('flag_set') || eventType === 'escalated_to_audit_admin') return 'bg-yellow-100 text-yellow-700';
  if (eventType === 'problem_audit_admin_override') return 'bg-purple-100 text-purple-700';
  return 'bg-slate-100 text-slate-700';
}

export default function AuditLogTimeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <div className="text-sm text-slate-500 py-4">لا توجد أحداث مسجَّلة بعد.</div>;
  }
  return (
    <ol className="relative border-r-2 border-slate-200 mr-2 space-y-3" dir="rtl">
      {events.map((ev) => (
        <li key={ev.id} className="mr-4 relative">
          <span className={`absolute -right-7 flex items-center justify-center w-6 h-6 rounded-full ring-4 ring-white ${colorFor(ev.eventType)}`}>
            {iconFor(ev.eventType)}
          </span>
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-slate-800">
                {EVENT_LABELS[ev.eventType] ?? ev.eventType}
              </span>
              <time className="text-xs text-slate-400">
                {new Date(ev.createdAt).toLocaleString('ar-SY')}
              </time>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="px-1.5 py-0.5 bg-slate-100 rounded">{ev.actorRole}</span>
              {ev.actorUserId != null && <span>المستخدم #{ev.actorUserId}</span>}
            </div>
            {ev.note && <p className="text-sm text-slate-600 mt-1.5">{ev.note}</p>}
            {ev.eventPayload && Object.keys(ev.eventPayload).length > 0 && (
              <details className="mt-1.5">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                  التفاصيل
                </summary>
                <pre className="text-xs bg-slate-50 p-2 rounded mt-1 overflow-auto max-h-40">
                  {JSON.stringify(ev.eventPayload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
