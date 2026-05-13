CREATE TABLE task_activity_log (
    id              BIGSERIAL       PRIMARY KEY,
    task_id         INTEGER         NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
    event_type      VARCHAR(50)     NOT NULL
                        CHECK (event_type IN (
                            'status_change', 'note_added', 'rescheduled', 'assigned',
                            'reassigned', 'call_made', 'priority_changed', 'team_assigned'
                        )),
    performed_by    INTEGER         REFERENCES hr_users(id) ON DELETE SET NULL,
    role            VARCHAR(50),
    old_value       TEXT,
    new_value       TEXT,
    reason          TEXT,
    reference_id    BIGINT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_activity_log_task ON task_activity_log(task_id);
CREATE INDEX idx_task_activity_log_created ON task_activity_log(created_at);
