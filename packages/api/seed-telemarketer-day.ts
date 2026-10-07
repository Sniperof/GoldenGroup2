/**
 * seed-telemarketer-day.ts — DEV ONLY
 *
 * Populates ONE complete day for the Telemarketer/Appointments page
 * (/telemarketer) so it renders full of data:
 *   • 1 team in the schedule  (day_schedules → team_0)
 *   • 1 call list ("قائمة الاتصال") with 12 customer items in mixed stages
 *     (ضمن القائمة / تم التواصل / مغلقة / محجوز)
 *   • call logs for the contacted/closed/booked items
 *   • 4 booked appointments (field_visits) shown in the team-agenda rail
 *
 * Idempotent: re-running wipes only the rows THIS script created for the
 * target (branch, date, team) and re-inserts them. Touches no real data.
 *
 * Run:  cd packages/api && npx tsx seed-telemarketer-day.ts
 * View: log in as global_admin, switch the branch to «طرطوس», open /telemarketer
 *       (the default date is the plan date, 2026-08-03).
 */
import pool from './db.js';

const BRANCH_ID = 3;                 // طرطوس — where all real clients/employees live
const DATE = '2026-08-03';           // the app's default planning date (today+1)
const TEAM_KEY = 'team_0';           // positional key: teams[0]
const LIST_ID = `tm_${DATE}_${TEAM_KEY}`;

// Branch-3 employees (must be branch 3 or the schedule GET redacts the team).
const TEAM = { supervisor: 70, technician: 77, telemarketers: [69, 73] };

// 12 customers laid out across the four lifecycle stages the page filters by.
// stage: 'in_list' (no call) | 'contacted' (call, still open) | 'closed' (rejected) | 'booked' (appointment)
const PLAN: { stage: 'in_list' | 'contacted' | 'closed' | 'booked'; outcome: string | null; time?: string }[] = [
    { stage: 'in_list',   outcome: null },
    { stage: 'in_list',   outcome: null },
    { stage: 'in_list',   outcome: null },
    { stage: 'contacted', outcome: 'no_answer' },
    { stage: 'contacted', outcome: 'busy' },
    { stage: 'contacted', outcome: 'no_answer' },
    { stage: 'closed',    outcome: 'not_interested' },
    { stage: 'closed',    outcome: 'wrong_number' },
    { stage: 'booked',    outcome: 'booked_marketing_appointment', time: '09:30' },
    { stage: 'booked',    outcome: 'booked_marketing_appointment', time: '10:15' },
    { stage: 'booked',    outcome: 'booked_marketing_appointment', time: '11:00' },
    { stage: 'booked',    outcome: 'booked_marketing_appointment', time: '12:30' },
];

async function main() {
    console.log('==========================================================');
    console.log(` Seeding telemarketer day — branch ${BRANCH_ID}, date ${DATE}`);
    console.log('==========================================================\n');

    // ── 1. Pull real branch-3 clients to reference ──────────────────────────
    const { rows: clients } = await pool.query(
        `SELECT c.id, c.name, c.mobile, c.neighborhood AS geo_unit_id,
                COALESCE(g.name, c.detailed_address, '') AS address_text,
                COALESCE(NULLIF(c.occupation, ''), 'موظف') AS occupation
           FROM clients c
           LEFT JOIN geo_units g ON g.id = c.neighborhood
          WHERE c.branch_id = $1 AND (c.is_candidate IS NULL OR c.is_candidate = false)
          ORDER BY c.id
          LIMIT $2`,
        [BRANCH_ID, PLAN.length],
    );
    if (clients.length < PLAN.length) {
        throw new Error(`Only ${clients.length} clients in branch ${BRANCH_ID}; need ${PLAN.length}.`);
    }
    console.log(`✓ Loaded ${clients.length} reference clients from branch ${BRANCH_ID}`);

    // ── 2. Idempotent cleanup of anything THIS script previously seeded ─────
    await pool.query(`DELETE FROM field_visits WHERE source_legacy_type = 'seed_tm_appt' AND scheduled_date = $1`, [DATE]);
    await pool.query(`DELETE FROM telemarketing_call_logs WHERE task_list_id = $1`, [LIST_ID]);
    await pool.query(`DELETE FROM telemarketing_task_list_items WHERE task_list_id = $1`, [LIST_ID]);
    await pool.query(`DELETE FROM telemarketing_task_lists WHERE id = $1`, [LIST_ID]);
    console.log('✓ Cleared previous seed rows for this list/date');

    // ── 3. Schedule → one team (team_0) ─────────────────────────────────────
    const teams = JSON.stringify([{
        supervisor: TEAM.supervisor,
        technician: TEAM.technician,
        telemarketers: TEAM.telemarketers,
    }]);
    await pool.query(
        `INSERT INTO day_schedules (date, teams, solos)
         VALUES ($1, $2::jsonb, '[]'::jsonb)
         ON CONFLICT (date) DO UPDATE SET teams = EXCLUDED.teams`,
        [DATE, teams],
    );
    console.log(`✓ day_schedules: 1 team (${TEAM_KEY}, supervisor emp ${TEAM.supervisor})`);

    // ── 4. Call list header ─────────────────────────────────────────────────
    await pool.query(
        `INSERT INTO telemarketing_task_lists (id, team_key, date, branch_id, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [LIST_ID, TEAM_KEY, DATE, BRANCH_ID],
    );
    console.log(`✓ telemarketing_task_lists: ${LIST_ID}`);

    // ── 5. Items + call logs + appointments ─────────────────────────────────
    let items = 0, logs = 0, appts = 0;
    for (let i = 0; i < PLAN.length; i++) {
        const c = clients[i];
        const p = PLAN[i];
        const itemStatus = p.stage === 'booked' ? 'booked' : (p.stage === 'in_list' ? 'pending' : 'called');
        const itemId = `${LIST_ID}_client_${c.id}`;

        await pool.query(
            `INSERT INTO telemarketing_task_list_items
               (id, task_list_id, entity_type, entity_id, name, mobile, contact_number,
                contact_label, address_text, geo_unit_id, status, call_outcome)
             VALUES ($1,$2,'client',$3,$4,$5,$5,'primary',$6,$7,$8,$9)`,
            [itemId, LIST_ID, c.id, c.name, c.mobile, c.address_text, c.geo_unit_id, itemStatus, p.outcome],
        );
        items++;

        // A call log for every attempted contact (contacted / closed / booked).
        if (p.stage !== 'in_list') {
            await pool.query(
                `INSERT INTO telemarketing_call_logs
                   (id, entity_type, entity_id, task_list_id, team_key, outcome,
                    contact_number, notes, timestamp, branch_id)
                 VALUES ($1,'client',$2,$3,$4,$5,$6,$7, now(), $8)`,
                [`cl_${LIST_ID}_${c.id}`, c.id, LIST_ID, TEAM_KEY, p.outcome, c.mobile,
                 p.stage === 'booked' ? 'تم حجز موعد زيارة' : 'محاولة اتصال', BRANCH_ID],
            );
            logs++;
        }

        // A booked appointment → a marketing field_visit resolved to team_0.
        if (p.stage === 'booked') {
            const teamSnap = JSON.stringify({
                teamKey: TEAM_KEY,
                supervisorEmployeeId: TEAM.supervisor,
                technicianEmployeeId: TEAM.technician,
                telemarketerEmployeeIds: TEAM.telemarketers,
            });
            const custSnap = JSON.stringify({
                name: c.name, mobile: c.mobile, addressText: c.address_text,
                occupation: c.occupation, waterSource: 'شبكة عامة',
            });
            await pool.query(
                `INSERT INTO field_visits
                   (visit_type, visit_family, status, client_id, branch_id,
                    scheduled_date, scheduled_time, origin_type,
                    source_legacy_type, source_legacy_id, team_snapshot, customer_snapshot,
                    created_at, updated_at)
                 VALUES ('marketing','marketing','scheduled',$1,$2,$3,$4,'telemarketing',
                         'seed_tm_appt',$5,$6::jsonb,$7::jsonb, now(), now())`,
                [c.id, BRANCH_ID, DATE, p.time, `seed_${DATE}_${TEAM_KEY}_${i}`, teamSnap, custSnap],
            );
            appts++;
        }
    }

    console.log(`✓ items: ${items}  ·  call logs: ${logs}  ·  appointments: ${appts}\n`);
    console.log('==========================================================');
    console.log(' DONE');
    console.log('==========================================================');
    console.log(` Branch : طرطوس (id ${BRANCH_ID}) — select it in the switcher`);
    console.log(` Date   : ${DATE} (the default plan date)`);
    console.log(` Stages : 3 ضمن القائمة · 3 تم التواصل · 2 مغلقة · 4 محجوز`);
    console.log(` Agenda : 4 مواعيد في رَفّ مواعيد الفريق`);
    console.log('==========================================================');

    await pool.end();
}

main().catch(async (err) => {
    console.error('SEED FAILED:', err);
    await pool.end();
    process.exit(1);
});
