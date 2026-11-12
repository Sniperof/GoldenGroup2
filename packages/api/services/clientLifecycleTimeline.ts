// Client lifecycle timeline — what happened WITH a client, from the first
// suggested name to the latest emergency (2026-11-02).
//
// Derived, not stored: every milestone already lives in its own table with its
// own date, so the timeline reads them on demand. It covers the whole history
// (migrated data included), adds no write path and cannot drift from the source.
// Who changed the client's DATA is the separate activity log (migration 489).
//
// Milestones only: a task's creation and its real outcome (not a cancelled or
// rescheduled visit task), the contract, the device steps, transfers, actual
// payments and refunds (not the installment schedule), gifts, requests and
// complaints. Each category follows the permission of its own profile tab, so
// the timeline never shows what the tab would hide.
import type { AuthContext } from '@golden-crm/shared';
import pool from '../db.js';
import { authorize } from './authorizationService.js';

export type LifecycleCategory = 'entry' | 'tasks' | 'contracts' | 'devices' | 'money' | 'gifts' | 'requests' | 'complaints';

export interface ClientLifecycleEvent {
  key: string;
  category: LifecycleCategory;
  kind: string;
  /** ISO timestamp, or YYYY-MM-DD when the source holds a date only. */
  at: string;
  dateOnly: boolean;
  /** False for dates outside 2010 … tomorrow (migrated data) or a fallback date. */
  reliable: boolean;
  title: string;
  /**
   * A task outcome: the stored final_decision code and its task type. The
   * screen words it with the app's one decision-label table
   * (web lib/taskDecisionLabels), so the timeline reads like the task screens;
   * `title` then holds the task's name only.
   */
  decision?: { code: string; taskType: string };
  detail: string | null;
  actor: string | null;
  link: { type: 'task' | 'visit' | 'contract' | 'device' | 'request' | 'complaint'; id: number; taskType?: string } | null;
}

// Category → the permissions of the profile tab that shows the same data.
const CATEGORY_PERMISSIONS: Record<Exclude<LifecycleCategory, 'entry' | 'gifts'>, string[]> = {
  tasks: ['clients.visits.view', 'open_tasks.view', 'field_visits.view'],
  contracts: ['clients.purchase_history.view', 'contracts.view_list'],
  devices: ['clients.devices.view', 'contracts.view_list'],
  money: ['clients.account_statement.view'],
  requests: [
    'service_requests.view', 'water_check.view', 'periodic_maintenance.view', 'golden_warranty.view',
    'name_nomination.view', 'account_requests.view',
  ],
  complaints: ['complaints.view_list'],
};

// Outcomes that are not milestones: the visit task was dropped or moved. Both
// spellings are stored ('reschedule' by the device check/retrieval/return/
// transfer result tables).
const NON_MILESTONE_DECISIONS = ['cancelled', 'rescheduled', 'reschedule'];

const REQUEST_LABELS: Record<string, string> = {
  device_request: 'طلب جهاز',
  water_check: 'طلب فحص مياه',
  periodic_maintenance: 'طلب صيانة دورية',
  emergency_maintenance: 'طلب صيانة طارئة',
  golden_warranty: 'طلب كفالة ذهبية',
  account_creation: 'طلب حساب على التطبيق',
  name_nomination: 'ترشيح أسماء',
  agent_license: 'طلب وكالة',
};

const REFERRER_LABELS: Record<string, string> = {
  Personal: 'شخصي', Employee: 'موظف', Client: 'زبون', Unknown: 'مجهول',
};

// Device steps the device record already shows; their visit-task results would
// repeat them. A transfer has its own event on both clients.
const RESULT_TYPES_SHOWN_ELSEWHERE = ['device_delivery', 'device_installation', 'device_activation', 'device_transfer'];

// Tasks the system generates on its own (contract approval, the periodic
// cycle, the installment schedule): their creation is not a milestone — a
// client with 35 contracts had 850 «task added» lines. Their outcome is.
// open_tasks.created_by cannot tell them apart: most paths leave it empty.
const AUTO_GENERATED_TASK_TYPES = [
  'device_delivery', 'device_installation', 'device_activation', 'periodic_maintenance', 'installment_collection',
];

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

function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n).toLocaleString('en-US')} ل.س` : '';
}

function event(e: Omit<ClientLifecycleEvent, 'reliable'> & { reliable?: boolean }): ClientLifecycleEvent {
  return { ...e, reliable: e.reliable ?? isReliable(e.at) };
}

function joinDetail(...parts: Array<string | null | undefined | false>): string | null {
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

export async function listClientLifecycle(
  authContext: AuthContext,
  client: { id: number; branchId: number | null },
): Promise<{ events: ClientLifecycleEvent[]; hiddenCategories: LifecycleCategory[] }> {
  const can = (category: keyof typeof CATEGORY_PERMISSIONS) =>
    CATEGORY_PERMISSIONS[category].some(permission =>
      authorize(authContext, { permission, branchId: client.branchId }).allowed);
  const allowed = {
    tasks: can('tasks'), contracts: can('contracts'), devices: can('devices'), money: can('money'),
    requests: can('requests'), complaints: can('complaints'),
  };
  const id = client.id;
  const skip = Promise.resolve({ rows: [] as any[] });

  const [entry, tasks, results, contracts, devices, transfers, payments, gifts, requests, complaints] = await Promise.all([
    pool.query(
      `SELECT c.created_at, c.name, c.referrer_type, c.referrer_name, c.deleted_at,
              cu.name AS created_by_name, du.name AS deleted_by_name,
              cand.id AS candidate_id, cand.created_at AS candidate_at, cu2.name AS candidate_by_name
         FROM clients c
         LEFT JOIN hr_users cu ON cu.id = c.created_by
         LEFT JOIN hr_users du ON du.id = c.deleted_by
         LEFT JOIN LATERAL (
           SELECT x.id, x.created_at, x.created_by FROM candidates x
            WHERE x.converted_to_lead_id = c.id ORDER BY x.id LIMIT 1
         ) cand ON TRUE
         LEFT JOIN hr_users cu2 ON cu2.id = cand.created_by
        WHERE c.id = $1`,
      [id],
    ),
    allowed.tasks ? pool.query(
      `SELECT ot.id, ot.task_type, COALESCE(ttc.arabic_label, ot.task_type) AS label, ot.created_at, ot.due_date,
              u.name AS actor
         FROM open_tasks ot
         LEFT JOIN task_type_config ttc ON ttc.task_type = ot.task_type
         LEFT JOIN hr_users u ON u.id = ot.created_by
        WHERE ot.client_id = $1
          AND ot.task_type <> ALL($2::text[])`,
      [id, AUTO_GENERATED_TASK_TYPES],
    ) : skip,
    allowed.tasks ? pool.query(
      `SELECT r.id, r.closed_at, r.created_at, r.final_decision, vt.task_type, vt.source_open_task_id,
              COALESCE(ttc.arabic_label, vt.task_type) AS label, fv.id AS visit_id, u.name AS actor
         FROM field_visits fv
         JOIN visit_tasks vt ON vt.field_visit_id = fv.id
         JOIN visit_task_results r ON r.visit_task_id = vt.id
         LEFT JOIN task_type_config ttc ON ttc.task_type = vt.task_type
         LEFT JOIN hr_users u ON u.id = r.closed_by
        WHERE fv.client_id = $1
          AND r.final_decision <> ALL($3::text[])
          AND vt.task_type <> ALL($2::text[])`,
      [id, RESULT_TYPES_SHOWN_ELSEWHERE, NON_MILESTONE_DECISIONS],
    ) : skip,
    allowed.contracts ? pool.query(
      `SELECT ct.id, ct.contract_number, ct.contract_date, ct.created_at, ct.status, ct.device_model_name,
              ct.final_price, ct.payment_type, ct.cancelled_at, ct.cancellation_reason,
              so.name AS sale_owner, cb.name AS cancelled_by_name
         FROM contracts ct
         LEFT JOIN employees so ON so.id = ct.sale_owner_id
         LEFT JOIN hr_users cb ON cb.id = ct.cancelled_by
        WHERE ct.customer_id = $1 AND ct.status NOT IN ('draft', 'discarded')`,
      [id],
    ) : skip,
    allowed.devices ? pool.query(
      `SELECT d.id, COALESCE(d.device_model_name, d.external_device_name) AS model, d.serial_number,
              d.device_source, d.delivery_date, d.installation_date, d.activated_at
         FROM installed_devices d
        WHERE d.customer_id = $1`,
      [id],
    ) : skip,
    allowed.devices ? pool.query(
      `SELECT t.id, r.closed_at, t.from_client_id, t.to_client_id, fc.name AS from_name, tc.name AS to_name,
              COALESCE(d.device_model_name, d.external_device_name) AS model, d.serial_number, vt.device_id,
              u.name AS actor
         FROM visit_task_device_transfer_results t
         JOIN visit_task_results r ON r.id = t.visit_task_result_id
         JOIN visit_tasks vt ON vt.id = r.visit_task_id
         LEFT JOIN installed_devices d ON d.id = vt.device_id
         LEFT JOIN clients fc ON fc.id = t.from_client_id
         LEFT JOIN clients tc ON tc.id = t.to_client_id
         LEFT JOIN hr_users u ON u.id = r.closed_by
        WHERE (t.from_client_id = $1 OR t.to_client_id = $1)
          AND r.final_decision <> ALL($2::text[])`,
      [id, NON_MILESTONE_DECISIONS],
    ) : skip,
    allowed.money ? pool.query(
      `SELECT f.id, f.occurred_at, f.kind, f.amount_syp, f.source_type, f.contract_id, f.reference_no,
              ct.contract_number, u.name AS actor
         FROM financial_movements f
         LEFT JOIN contracts ct ON ct.id = f.contract_id
         LEFT JOIN hr_users u ON u.id = f.recorded_by
        WHERE f.client_id = $1 AND f.kind IN ('payment', 'refund')`,
      [id],
    ) : skip,
    pool.query(
      `SELECT g.id, g.created_at, g.status, g.manual_delivered_at, g.customer_id, g.beneficiary_client_id,
              gd.name AS gift_name, g.condition_label, cu.name AS actor, mu.name AS delivered_by
         FROM gift_records g
         LEFT JOIN gift_definitions gd ON gd.id = g.gift_definition_id
         LEFT JOIN hr_users cu ON cu.id = g.created_by
         LEFT JOIN hr_users mu ON mu.id = g.manual_delivered_by
        WHERE g.customer_id = $1 OR g.beneficiary_client_id = $1`,
      [id],
    ),
    allowed.requests ? pool.query(
      `SELECT s.id, s.public_ref_number, s.request_type, s.status, s.created_at, s.closed_at
         FROM service_requests s
        WHERE $1 IN (s.requester_client_id, s.beneficiary_client_id)`,
      [id],
    ) : skip,
    allowed.complaints ? pool.query(
      `SELECT c.id, c.public_ref_number, c.created_at, c.closed_at, c.status
         FROM complaints c
        WHERE c.requester_client_id = $1`,
      [id],
    ) : skip,
  ]);

  const events: ClientLifecycleEvent[] = [];

  // ── Entry ────────────────────────────────────────────────────────────────
  const c = entry.rows[0];
  if (c) {
    const candidateAt = toIso(c.candidate_at);
    if (c.candidate_id != null && candidateAt) {
      events.push(event({
        key: `candidate:${c.candidate_id}`, category: 'entry', kind: 'candidate_registered', at: candidateAt, dateOnly: false,
        title: 'سُجّل اسماً مقترحاً', detail: null, actor: c.candidate_by_name ?? null, link: null,
      }));
    }
    const createdAt = toIso(c.created_at);
    if (createdAt) {
      const typeLabel = c.referrer_type ? REFERRER_LABELS[c.referrer_type] : undefined;
      const mediator = c.referrer_name
        ? `الوسيط: ${c.referrer_name}${typeLabel && typeLabel !== c.referrer_name ? ` (${typeLabel})` : ''}`
        : null;
      events.push(event({
        key: 'client:created', category: 'entry', kind: 'client_created', at: createdAt, dateOnly: false,
        title: c.candidate_id != null ? 'تحوّل إلى زبون' : 'أُضيف الزبون', detail: mediator,
        actor: c.created_by_name ?? null, link: null,
      }));
    }
    const deletedAt = toIso(c.deleted_at);
    if (deletedAt) {
      events.push(event({
        key: 'client:deleted', category: 'entry', kind: 'client_deleted', at: deletedAt, dateOnly: false,
        title: 'حُذف الزبون', detail: null, actor: c.deleted_by_name ?? null, link: null,
      }));
    }
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
  for (const r of results.rows) {
    const at = toIso(r.closed_at) ?? toIso(r.created_at);
    if (!at) continue;
    events.push(event({
      key: `result:${r.id}`, category: 'tasks', kind: r.task_type === 'emergency_maintenance' ? 'emergency_done' : 'task_result',
      at, dateOnly: false,
      title: r.label, decision: { code: r.final_decision, taskType: r.task_type }, detail: null,
      actor: r.actor ?? null, link: { type: 'visit', id: Number(r.visit_id) },
    }));
  }

  // ── Contracts ────────────────────────────────────────────────────────────
  for (const ct of contracts.rows) {
    // contract_date is the sale date; created_at is the import date for most
    // migrated contracts, so it is only a fallback (marked unreliable).
    const signed = dateOnlyOf(ct.contract_date);
    const at = signed ?? toIso(ct.created_at);
    if (at) {
      events.push(event({
        key: `contract:${ct.id}`, category: 'contracts', kind: 'contract_signed', at, dateOnly: signed != null,
        reliable: signed != null ? isReliable(signed) : false,
        title: `عقد شراء${ct.device_model_name ? ` — ${ct.device_model_name}` : ''}`,
        detail: joinDetail(ct.contract_number && `رقم ${ct.contract_number}`, ct.final_price != null && money(ct.final_price),
          ct.status === 'completed' && 'مكتمل'),
        actor: ct.sale_owner ?? null, link: { type: 'contract', id: Number(ct.id) },
      }));
    }
    const cancelledAt = toIso(ct.cancelled_at);
    if (cancelledAt) {
      events.push(event({
        key: `contract-cancel:${ct.id}`, category: 'contracts', kind: 'contract_cancelled', at: cancelledAt, dateOnly: false,
        title: 'أُلغي العقد', detail: joinDetail(ct.contract_number && `رقم ${ct.contract_number}`, ct.cancellation_reason),
        actor: ct.cancelled_by_name ?? null, link: { type: 'contract', id: Number(ct.id) },
      }));
    }
  }

  // ── Devices ──────────────────────────────────────────────────────────────
  for (const d of devices.rows) {
    const name = joinDetail(d.model, d.serial_number && `رقم تسلسلي ${d.serial_number}`, d.device_source === 'external' && 'جهاز خارجي');
    const steps: Array<[string, string, unknown, boolean]> = [
      ['device_delivered', 'سُلّم جهاز', d.delivery_date, true],
      ['device_installed', 'رُكّب جهاز', d.installation_date, true],
      ['device_activated', 'شُغّل جهاز', d.activated_at, false],
    ];
    for (const [kind, title, value, dateOnly] of steps) {
      const at = dateOnly ? dateOnlyOf(value) : toIso(value);
      if (!at) continue;
      events.push(event({
        key: `${kind}:${d.id}`, category: 'devices', kind, at, dateOnly,
        title, detail: name, actor: null, link: { type: 'device', id: Number(d.id) },
      }));
    }
  }
  for (const t of transfers.rows) {
    const at = toIso(t.closed_at);
    if (!at) continue;
    const outgoing = Number(t.from_client_id) === id;
    events.push(event({
      key: `transfer:${t.id}`, category: 'devices', kind: outgoing ? 'device_transferred_out' : 'device_transferred_in', at, dateOnly: false,
      title: outgoing ? `نُقل جهاز إلى ${t.to_name ?? 'زبون آخر'}` : `نُقل إليه جهاز من ${t.from_name ?? 'زبون آخر'}`,
      detail: joinDetail(t.model, t.serial_number && `رقم تسلسلي ${t.serial_number}`),
      actor: t.actor ?? null, link: t.device_id != null ? { type: 'device', id: Number(t.device_id) } : null,
    }));
  }

  // ── Money: actual payments and refunds ───────────────────────────────────
  for (const f of payments.rows) {
    const at = toIso(f.occurred_at);
    if (!at) continue;
    events.push(event({
      key: `money:${f.id}`, category: 'money', kind: f.kind === 'refund' ? 'refund' : 'payment', at, dateOnly: false,
      title: `${f.kind === 'refund' ? 'استرداد' : 'دفعة'} ${money(f.amount_syp)}`,
      detail: joinDetail(f.contract_number && `عقد ${f.contract_number}`, f.reference_no && `مرجع ${f.reference_no}`),
      actor: f.actor ?? null, link: f.contract_id != null ? { type: 'contract', id: Number(f.contract_id) } : null,
    }));
  }

  // ── Gifts ────────────────────────────────────────────────────────────────
  for (const g of gifts.rows) {
    const asBeneficiary = Number(g.beneficiary_client_id) === id && Number(g.customer_id) !== id;
    const at = toIso(g.created_at);
    if (at) {
      events.push(event({
        key: `gift:${g.id}`, category: 'gifts', kind: 'gift_promised', at, dateOnly: false,
        title: `${asBeneficiary ? 'وُعد بهدية كوسيط' : 'وُعد بهدية'}${g.gift_name ? `: ${g.gift_name}` : ''}`,
        detail: g.condition_label ? `الشرط: ${g.condition_label}` : null,
        actor: g.actor ?? null, link: null,
      }));
    }
    const deliveredAt = toIso(g.manual_delivered_at);
    if (deliveredAt) {
      events.push(event({
        key: `gift-delivered:${g.id}`, category: 'gifts', kind: 'gift_delivered', at: deliveredAt, dateOnly: false,
        title: `سُلّمت هدية${g.gift_name ? `: ${g.gift_name}` : ''}`, detail: null,
        actor: g.delivered_by ?? null, link: null,
      }));
    }
  }

  // ── Requests and complaints ──────────────────────────────────────────────
  for (const s of requests.rows) {
    const label = REQUEST_LABELS[s.request_type] ?? 'طلب خدمة';
    const at = toIso(s.created_at);
    if (at) {
      events.push(event({
        key: `request:${s.id}`, category: 'requests', kind: 'request_created', at, dateOnly: false,
        title: `قدّم ${label}`, detail: s.public_ref_number ? `مرجع ${s.public_ref_number}` : null,
        actor: null, link: { type: 'request', id: Number(s.id) },
      }));
    }
    const closedAt = toIso(s.closed_at);
    if (closedAt) {
      events.push(event({
        key: `request-closed:${s.id}`, category: 'requests', kind: 'request_closed', at: closedAt, dateOnly: false,
        title: `أُغلق ${label}`, detail: s.public_ref_number ? `مرجع ${s.public_ref_number}` : null,
        actor: null, link: { type: 'request', id: Number(s.id) },
      }));
    }
  }
  for (const cp of complaints.rows) {
    const at = toIso(cp.created_at);
    if (at) {
      events.push(event({
        key: `complaint:${cp.id}`, category: 'complaints', kind: 'complaint_created', at, dateOnly: false,
        title: 'قدّم شكوى', detail: cp.public_ref_number ? `مرجع ${cp.public_ref_number}` : null,
        actor: null, link: { type: 'complaint', id: Number(cp.id) },
      }));
    }
    const closedAt = toIso(cp.closed_at);
    if (closedAt) {
      events.push(event({
        key: `complaint-closed:${cp.id}`, category: 'complaints', kind: 'complaint_closed', at: closedAt, dateOnly: false,
        title: 'أُغلقت الشكوى', detail: cp.public_ref_number ? `مرجع ${cp.public_ref_number}` : null,
        actor: null, link: { type: 'complaint', id: Number(cp.id) },
      }));
    }
  }

  // Newest first; a date-only event sorts as the end of its day.
  const sortKey = (e: ClientLifecycleEvent) => new Date(e.dateOnly ? `${e.at}T23:59:59Z` : e.at).getTime();
  events.sort((a, b) => sortKey(b) - sortKey(a));

  const hiddenCategories = (Object.keys(allowed) as Array<keyof typeof allowed>).filter(k => !allowed[k]);
  return { events, hiddenCategories };
}
