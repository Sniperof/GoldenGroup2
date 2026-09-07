BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- Three fixes the call reports cannot be built without, and none of them can be
-- applied retroactively later: every day that passes writes history we can never
-- reconstruct.
--
--  1) Freeze the task's due date and status ON the call link, so «was this task
--     overdue when the employee called?» stays a historical fact. Today it would
--     be computed from the CURRENT due_date — and the due date is editable
--     (routes/tasks.ts) with no entry in task_activity_log, which records only
--     status_change / priority_changed / note_added / lifecycle_skip. So the
--     answer could flip retroactively with no trace.
--
--  2) Mark which link is the call's SUBJECT task. The write path links a call to
--     every sibling task sharing the contact target — deliberately, so the call
--     shows on any sibling's page — which makes one call countable under several
--     task types at once. Measured: 47 calls link to one task, 3 link to 2-4.
--
--  3) Correct the call times that were stored three hours ahead of the instant
--     they happened, and only where another table proves the true instant.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) The snapshot columns ─────────────────────────────────────────────────
ALTER TABLE public.call_task_links
  ADD COLUMN IF NOT EXISTS task_due_date_snapshot DATE,
  ADD COLUMN IF NOT EXISTS task_status_snapshot   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_primary             BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.call_task_links.task_due_date_snapshot IS
  'استحقاق المهمة لحظة المكالمة. مجمَّد عند التسجيل فلا ينقضه تعديل الاستحقاق لاحقًا. الروابط الأقدم من migration 454 قيمتها مشتقة من الاستحقاق الحالي لا مجمَّدة.';
COMMENT ON COLUMN public.call_task_links.task_status_snapshot IS
  'حالة المهمة لحظة المكالمة. مجمَّدة لأن سجل أحداث المهمة يغطي نصف المهام فقط فلا يصلح لإعادة البناء دائمًا.';
COMMENT ON COLUMN public.call_task_links.is_primary IS
  'هل هذه مهمة موضوع المكالمة، أم رابط شقيق أُنشئ لعرض المكالمة على صفحة مهمة أخرى لجهة التواصل نفسها. الروابط الأقدم من migration 454 تبقى FALSE لأن تحديد الموضوع أثريًّا غير ممكن.';

-- ── 2) Correct the shifted call times, only where proven ────────────────────
-- Every telemarketing call was written twice: once by the telemarketing route
-- with a server-generated timestamp (sub-second precision), and once by the
-- customer-calls route with a caller-supplied minute-precision value. Where the
-- two describe the same call, the server-generated instant is the truth.
--
-- The rows with no counterpart are LEFT ALONE on purpose: shifting them by an
-- assumed three hours would be inventing data. Their «seconds = 0» fingerprint
-- still marks them as entered rather than measured.
WITH shifted AS (
  SELECT call_log.id,
         call_log.call_date AS stored_at,
         truth.timestamp    AS measured_at
    FROM public.customer_call_logs call_log
    JOIN LATERAL (
      SELECT tm.timestamp
        FROM public.telemarketing_call_logs tm
       WHERE tm.entity_type = 'client'
         AND tm.entity_id = call_log.customer_id
         AND tm.outcome = call_log.outcome
         AND DATE_TRUNC('minute', tm.timestamp + INTERVAL '3 hours')
             = DATE_TRUNC('minute', call_log.call_date)
       ORDER BY tm.timestamp ASC
       LIMIT 1
    ) truth ON TRUE
   WHERE call_log.call_date <> truth.timestamp
     AND NOT COALESCE(call_log.action_log ? 'callDateCorrectedFrom', FALSE)
)
UPDATE public.customer_call_logs AS call_log
   SET call_date = shifted.measured_at,
       action_log = COALESCE(call_log.action_log, '{}'::jsonb)
                      || JSONB_BUILD_OBJECT(
                           'callDateCorrectedFrom', shifted.stored_at,
                           'callDateCorrectedBy', 'migration_454')
  FROM shifted
 WHERE call_log.id = shifted.id;

-- ── 3) Backfill the snapshots for the links that already exist ──────────────
-- The due date is the best available value, not a frozen one, and the column
-- comment says so. The status is reconstructed from the last status change
-- recorded before the (now corrected) call time.
UPDATE public.call_task_links AS link
   SET task_due_date_snapshot = task.due_date,
       task_status_snapshot = COALESCE(prior.new_value, task.status)
  FROM public.open_tasks task
  JOIN public.customer_call_logs call_log ON TRUE
  LEFT JOIN LATERAL (
    SELECT event.new_value
      FROM public.task_activity_log event
     WHERE event.task_id = task.id
       AND event.event_type = 'status_change'
       AND event.created_at <= call_log.call_date
     ORDER BY event.created_at DESC, event.id DESC
     LIMIT 1
  ) prior ON TRUE
 WHERE task.id = link.task_id
   AND call_log.id = link.call_id
   AND link.task_due_date_snapshot IS NULL;

COMMIT;
