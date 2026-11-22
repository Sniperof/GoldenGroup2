// Contact target = unit of telemarketing writes (planning stage 1, option A).
//
// Generation creates one call-list item PER TASK, and the telemarketer
// workspace groups them into one card per contact target (client + work
// location + D). Every write the workspace makes (call outcome, manual close,
// booking) targets the card's primary item only, which left sibling items of
// the same contact target `pending` next to a closed or booked target.
//
// After any item write, copy its status/outcome to the other items of the same
// contact target in the same list. Item rows stay per task (so the task that
// was actually booked is still traceable through visit_tasks); only their
// state is kept consistent. Task lifecycle is NOT touched here.
// A sibling that is already `booked` is never downgraded by a later call
// outcome on the same target.

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

export async function syncContactTargetSiblingItems(
  db: Queryable,
  taskListId: string,
  itemIds: string | string[],
): Promise<void> {
  const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).filter(Boolean);
  if (!taskListId || ids.length === 0) return;
  await db.query(
    `UPDATE telemarketing_task_list_items sibling
        SET status = source.status,
            call_outcome = source.call_outcome
       FROM telemarketing_task_list_items source
      WHERE source.task_list_id = $1
        AND source.id = ANY($2::text[])
        AND source.contact_target_id IS NOT NULL
        AND sibling.task_list_id = source.task_list_id
        AND sibling.contact_target_id = source.contact_target_id
        AND sibling.id <> ALL($2::text[])
        AND (sibling.status <> 'booked' OR source.status = 'booked')
        AND (sibling.status, sibling.call_outcome)
            IS DISTINCT FROM (source.status, source.call_outcome)`,
    [taskListId, ids],
  );
}
