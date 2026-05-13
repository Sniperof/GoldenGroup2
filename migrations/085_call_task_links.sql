CREATE TABLE call_task_links (
    call_id     VARCHAR(255) NOT NULL REFERENCES customer_call_logs(id) ON DELETE CASCADE,
    task_id     INTEGER      NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (call_id, task_id)
);

CREATE INDEX idx_call_task_links_task ON call_task_links(task_id);
