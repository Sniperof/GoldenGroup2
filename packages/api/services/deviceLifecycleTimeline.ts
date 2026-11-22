// Device lifecycle timeline — what happened TO one installed device, from its
// creation to the latest maintenance (2026-11-19).
//
// Derived, not stored, like the client timeline (clientLifecycleTimeline.ts):
// every milestone already lives in its own table with its own date. The only
// new source is the device activity log (migration 498), read for the status
// moves no task result explains (delivery suspension, a manual edit, the
// legacy task completion); moves made by a visit result or by the contract are
// already shown by those events. Who changed which field is the separate
// «سجل التغييرات» section.
import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';
import { authorize } from './authorizationService.js';

export type DeviceLifecycleCategory = 'entry' | 'status' | 'tasks' | 'contract' | 'warranties' | 'possession';

export interface DeviceLifecycleEvent {
  key: string;
  category: DeviceLifecycleCategory;
  kind: string;
  /** ISO timestamp, or YYYY-MM-DD when the source holds a date only. */
  at: string;
  dateOnly: boolean;
  /** False for dates outside 2010 … tomorrow (migrated data) or a fallback date. */
  reliable: boolean;
  title: string;
  /** A task outcome: worded on the screen with the app's decision-label table. */
  decision?: { code: string; taskType: string };
  detail: string | null;
  actor: string | null;
  link: { type: 'task' | 'visit' | 'contract' | 'client'; id: number; taskType?: string } | null;
}

// Category → the permissions of the device-page section that shows the same data.
const CATEGORY_PERMISSIONS: Partial<Record<DeviceLifecycleCategory, string[]>> = {
  tasks: ['open_tasks.view', 'field_visits.view', 'clients.visits.view'],
  contract: ['contracts.view_list', 'clients.purchase_history.view'],
  possession: ['installed_devices.possession.view'],
};

const NON_MILESTONE_DECISIONS = ['cancelled', 'rescheduled', 'reschedule'];

// Visit tasks that ride on the device's contract but are about the client.
const NOT_ABOUT_THE_DEVICE = ['gift_delivery', 'installment_collection'];

// Tasks the system opens on its own: their creation is not a milestone, their outcome is.
const AUTO_GENERATED_TASK_TYPES = [
  'device_delivery', 'device_installation', 'device_activation', 'periodic_maintenance', 'installment_collection',
];

// Status moves that the contract or a task result already shows.
const CONTEXTS_SHOWN_ELSEWHERE = ['contract_approved', 'contract_cancelled', 'visit_result', 'result_edit'];

// The wording of the device page's status badge (web DeviceStatusBadge).
export const DEVICE_STATUS_LABELS: Record<string, string> = {
  registered: 'مسجّل',
  pending_delivery: 'بانتظار التوصيل',
  delivery_suspended: 'معلّق',
  delivered: 'تم التوصيل',
  installed: 'مركّب',
  active: 'نشط',
  faulty: 'معطل',
  in_workshop: 'في الورشة',
  ready: 'جاهز',
  out_of_service: 'خارج الخدمة',
  retrieved: 'مستردة',
  contract_cancelled: 'مُلغى (عقد)',
};

const STATUS_CONTEXT_TITLES: Record<string, string> = {
  delivery_suspended: 'عُلّق التسليم',
  delivery_resumed: 'استُؤنف التسليم',
  device_edit: 'عُدّلت الحالة يدوياً',
  task_completed: 'تغيّرت الحالة بإغلاق مهمة',
};

const HOLDER_LABELS: Record<string, string> = {
  customer: 'الزبون', warehouse: 'المستودع', technician: 'الفني', workshop: 'الورشة', supplier: 'المورّد',
};

const WARRANTY_LABELS: Record<string, string> = { contract: 'كفالة العقد', golden: 'كفالة ذهبية' };

const MIN_RELIABLE = Date.UTC(2010, 0, 1);

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dateOnlyOf(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function isReliable(at: string): boolean {
  const t = new Date(at).getTime();
  return t >= MIN_RELIABLE && t <= Date.now() + 24 * 3600 * 1000;
}

function event(e: Omit<DeviceLifecycleEvent, 'reliable'> & { reliable?: boolean }): DeviceLifecycleEvent {
  return { ...e, reliable: e.reliable ?? isReliable(e.at) };
}

function joinDetail(...parts: Array<string | null | undefined | false>): string | null {
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

function statusLabel(code: string | null | undefined): string {
  return code ? (DEVICE_STATUS_LABELS[code] ?? code) : '—';
}

export async function listDeviceLifecycle(
  authContext: AuthContext,
  device: { id: number; branchId: number | null },
): Promise<{ events: DeviceLifecycleEvent[]; hiddenCategories: DeviceLifecycleCategory[] }> {
  const can = (category: keyof typeof CATEGORY_PERMISSIONS) =>
    (CATEGORY_PERMISSIONS[category] ?? []).some(permission =>
      authorize(authContext, { permission, branchId: device.branchId }).allowed);
  const allowed = { tasks: can('tasks'), contract: can('contract'), possession: can('possession') };
  const id = device.id;
  const skip = Promise.resolve({ rows: [] as any[] });

  const [entry, statusMoves, tasks, results, warranties, possession] = await Promise.all([
    pool.query(
      `SELECT d.created_at, d.device_source, d.delivery_date, d.installation_date, d.activated_at,
              d.contract_id, ct.contract_number, ct.contract_date, ct.cancelled_at, ct.cancellation_reason,
              ct.status AS contract_status, so.name AS sale_owner, cb.name AS cancelled_by_name,
              created.performed_by_name AS created_by_name, created.change_context AS created_context
         FROM installed_devices d
         LEFT JOIN contracts ct ON ct.id = d.contract_id
         LEFT JOIN employees so ON so.id = ct.sale_owner_id
         LEFT JOIN hr_users cb ON cb.id = ct.cancelled_by
         LEFT JOIN LATERAL (
           SELECT u.name AS performed_by_name, l.change_context
             FROM device_activity_log l
             LEFT JOIN hr_users u ON u.id = l.performed_by
            WHERE l.device_id = d.id AND l.event_type = 'created'
            ORDER BY l.id LIMIT 1
         ) created ON TRUE
        WHERE d.id = $1`,
      [id],
    ),
    pool.query(
      `SELECT l.id, l.old_value, l.new_value, l.change_context, l.reason, l.created_at, u.name AS actor
         FROM device_activity_log l
         LEFT JOIN hr_users u ON u.id = l.performed_by
        WHERE l.device_id = $1
          AND l.event_type = 'status_changed'
          AND l.visit_task_id IS NULL
          AND COALESCE(l.change_context, '') <> ALL($2::text[])`,
      [id, CONTEXTS_SHOWN_ELSEWHERE],
    ),
    allowed.tasks ? pool.query(
      `SELECT ot.id, ot.task_type, COALESCE(ttc.arabic_label, ot.task_type) AS label, ot.created_at, ot.due_date,
              u.name AS actor
         FROM open_tasks ot
         LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
         LEFT JOIN hr_users u ON u.id = ot.created_by
        WHERE ot.device_id = $1
          AND ot.task_type <> ALL($2::text[])`,
      [id, AUTO_GENERATED_TASK_TYPES],
    ) : skip,
    allowed.tasks ? pool.query(
      `SELECT r.id, r.closed_at, r.created_at, r.final_decision, vt.task_type,
              COALESCE(ttc.arabic_label, vt.task_type) AS label, vt.field_visit_id AS visit_id, u.name AS actor,
              tr.to_client_id, tc.name AS to_client_name
         FROM visit_tasks vt
         LEFT JOIN open_tasks ot ON ot.id = vt.source_open_task_id
         JOIN visit_task_results r ON r.visit_task_id = vt.id
         LEFT JOIN task_type_config ttc ON ttc.task_type = vt.task_type
         LEFT JOIN hr_users u ON u.id = r.closed_by
         LEFT JOIN visit_task_device_transfer_results tr ON tr.visit_task_result_id = r.id
         LEFT JOIN clients tc ON tc.id = tr.to_client_id
        WHERE (vt.device_id = $1 OR ot.device_id = $1)
          AND vt.task_type <> ALL($2::text[])
          AND r.final_decision <> ALL($3::text[])`,
      [id, NOT_ABOUT_THE_DEVICE, NON_MILESTONE_DECISIONS],
    ) : skip,
    pool.query(
      `SELECT w.id, w.warranty_type, w.status, w.start_date, w.end_date, w.months, w.activated_at,
              w.cancelled_at, w.cancellation_reason, cb.name AS cancelled_by_name
         FROM device_warranties w
         LEFT JOIN hr_users cb ON cb.id = w.cancelled_by
        WHERE w.device_id = $1`,
      [id],
    ),
    allowed.possession ? pool.query(
      `SELECT p.id, p.holder_type, p.holder_id, p.start_at, p.reason, cl.name AS client_name, u.name AS actor
         FROM device_possession_log p
         LEFT JOIN clients cl ON p.holder_type = 'customer' AND cl.id = p.holder_id
         LEFT JOIN hr_users u ON u.id = p.created_by
        WHERE p.device_id = $1`,
      [id],
    ) : skip,
  ]);

  const events: DeviceLifecycleEvent[] = [];
  const d = entry.rows[0];

  // ── Entry ────────────────────────────────────────────────────────────────
  if (d) {
    const createdAt = toIso(d.created_at);
    if (createdAt) {
      const external = d.device_source === 'external';
      events.push(event({
        key: 'device:created', category: 'entry', kind: 'device_created', at: createdAt, dateOnly: false,
        title: external
          ? 'سُجّل جهازاً خارجياً'
          : d.created_context === 'service_request_promoted' ? 'سُجّل من طلب خدمة' : 'أُنشئ الجهاز مع اعتماد العقد',
        detail: null, actor: d.created_by_name ?? null, link: null,
      }));
    }

    // ── Contract ───────────────────────────────────────────────────────────
    if (allowed.contract && d.contract_id != null) {
      const signed = dateOnlyOf(d.contract_date);
      if (signed) {
        events.push(event({
          key: `contract:${d.contract_id}`, category: 'contract', kind: 'contract_signed', at: signed, dateOnly: true,
          title: 'عقد الشراء', detail: joinDetail(d.contract_number && `رقم ${d.contract_number}`),
          actor: d.sale_owner ?? null, link: { type: 'contract', id: Number(d.contract_id) },
        }));
      }
      const cancelledAt = toIso(d.cancelled_at);
      if (cancelledAt) {
        events.push(event({
          key: `contract-cancel:${d.contract_id}`, category: 'contract', kind: 'contract_cancelled', at: cancelledAt, dateOnly: false,
          title: 'أُلغي العقد', detail: joinDetail(d.contract_number && `رقم ${d.contract_number}`, d.cancellation_reason),
          actor: d.cancelled_by_name ?? null, link: { type: 'contract', id: Number(d.contract_id) },
        }));
      }
    }
  }

  // ── Status moves no task or contract explains ────────────────────────────
  for (const s of statusMoves.rows) {
    const at = toIso(s.created_at);
    if (!at) continue;
    events.push(event({
      key: `status:${s.id}`, category: 'status', kind: `status_${s.new_value}`, at, dateOnly: false,
      title: `${STATUS_CONTEXT_TITLES[s.change_context] ?? 'تغيّرت الحالة'}: ${statusLabel(s.old_value)} ← ${statusLabel(s.new_value)}`,
      detail: s.reason ?? null, actor: s.actor ?? null, link: null,
    }));
  }

  // ── Tasks: creation and real outcome ─────────────────────────────────────
  for (const t of tasks.rows) {
    const at = toIso(t.created_at);
    if (!at) continue;
    const due = dateOnlyOf(t.due_date);
    events.push(event({
      key: `task:${t.id}`, category: 'tasks', kind: 'task_created', at, dateOnly: false,
      title: `أُضيفت مهمة ${t.label}`, detail: due ? `الاستحقاق: ${due}` : null,
      actor: t.actor ?? null, link: { type: 'task', id: Number(t.id), taskType: t.task_type },
    }));
  }
  const typesWithResult = new Set<string>();
  for (const r of results.rows) {
    const at = toIso(r.closed_at) ?? toIso(r.created_at);
    if (!at) continue;
    typesWithResult.add(r.task_type);
    events.push(event({
      key: `result:${r.id}`, category: 'tasks', kind: r.task_type === 'emergency_maintenance' ? 'emergency_done' : 'task_result',
      at, dateOnly: false,
      title: r.label, decision: { code: r.final_decision, taskType: r.task_type },
      detail: r.to_client_id != null ? `إلى ${r.to_client_name ?? 'زبون آخر'}` : null,
      actor: r.actor ?? null, link: r.visit_id != null ? { type: 'visit', id: Number(r.visit_id) } : null,
    }));
  }

  // Migrated devices hold the step dates without a recorded result: the date
  // stands in for the missing task outcome.
  if (d) {
    const steps: Array<[string, string, string, unknown, boolean]> = [
      ['device_delivery', 'device_delivered', 'سُلّم الجهاز', d.delivery_date, true],
      ['device_installation', 'device_installed', 'رُكّب الجهاز', d.installation_date, true],
      ['device_activation', 'device_activated', 'شُغّل الجهاز', d.activated_at, false],
    ];
    for (const [taskType, kind, title, value, dateOnly] of steps) {
      if (allowed.tasks && typesWithResult.has(taskType)) continue;
      const at = dateOnly ? dateOnlyOf(value) : toIso(value);
      if (!at) continue;
      events.push(event({
        key: `${kind}:${id}`, category: 'status', kind, at, dateOnly, title, detail: null, actor: null, link: null,
      }));
    }
  }

  // ── Warranties ───────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  for (const w of warranties.rows) {
    const label = WARRANTY_LABELS[w.warranty_type] ?? 'كفالة';
    const start = dateOnlyOf(w.start_date) ?? dateOnlyOf(w.activated_at);
    const end = dateOnlyOf(w.end_date);
    if (start && w.status !== 'pending') {
      events.push(event({
        key: `warranty:${w.id}`, category: 'warranties', kind: 'warranty_started', at: start, dateOnly: true,
        title: `بدأت ${label}`, detail: joinDetail(w.months != null && `${w.months} شهراً`, end && `حتى ${end}`),
        actor: null, link: null,
      }));
    }
    const cancelledAt = toIso(w.cancelled_at);
    if (cancelledAt) {
      events.push(event({
        key: `warranty-cancel:${w.id}`, category: 'warranties', kind: 'warranty_cancelled', at: cancelledAt, dateOnly: false,
        title: `أُلغيت ${label}`,
        detail: w.cancellation_reason === 'contract_cancelled' ? 'بإلغاء العقد'
          : w.cancellation_reason === 'device_retrieved' ? 'بسحب الجهاز' : null,
        actor: w.cancelled_by_name ?? null, link: null,
      }));
    } else if (end && end < today && w.status !== 'pending') {
      events.push(event({
        key: `warranty-end:${w.id}`, category: 'warranties', kind: 'warranty_expired', at: end, dateOnly: true,
        title: `انتهت ${label}`, detail: null, actor: null, link: null,
      }));
    }
  }

  // ── Possession ───────────────────────────────────────────────────────────
  for (const p of possession.rows) {
    const at = toIso(p.start_at);
    if (!at) continue;
    const holder = p.holder_type === 'customer' && p.client_name ? p.client_name : (HOLDER_LABELS[p.holder_type] ?? p.holder_type);
    events.push(event({
      key: `possession:${p.id}`, category: 'possession', kind: 'possession_started', at, dateOnly: false,
      title: `انتقلت الحيازة إلى ${holder}`, detail: null, actor: p.actor ?? null,
      link: p.holder_type === 'customer' && p.holder_id != null ? { type: 'client', id: Number(p.holder_id) } : null,
    }));
  }

  // Newest first; a date-only event sorts as the end of its day.
  const sortKey = (e: DeviceLifecycleEvent) => new Date(e.dateOnly ? `${e.at}T23:59:59Z` : e.at).getTime();
  events.sort((a, b) => sortKey(b) - sortKey(a));

  const hiddenCategories = (Object.keys(allowed) as Array<keyof typeof allowed>).filter(k => !allowed[k]);
  return { events, hiddenCategories };
}
