CREATE TABLE open_task_devices (
    id              BIGSERIAL       PRIMARY KEY,
    task_id         INTEGER         NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
    device_model_id INTEGER         REFERENCES device_models(id) ON DELETE SET NULL,
    device_name_snapshot VARCHAR(255) NOT NULL,
    quantity        INTEGER         NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_open_task_devices_task ON open_task_devices(task_id);
