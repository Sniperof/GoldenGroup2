-- Alerts for visits whose scheduled window ended without start/cancellation.
-- Recipient follows DEC-007 D47: standard team supervisor, emergency technician.
CREATE TABLE IF NOT EXISTS visit_scheduled_alerts (
  id                   BIGSERIAL PRIMARY KEY,
  visit_id             BIGINT NOT NULL REFERENCES field_visits(id) ON DELETE CASCADE,
  responsible_user_id  INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  alerted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at          TIMESTAMPTZ,
  UNIQUE (visit_id)
);

CREATE INDEX IF NOT EXISTS idx_visit_scheduled_alerts_pending_recipient
  ON visit_scheduled_alerts (responsible_user_id, alerted_at)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE visit_scheduled_alerts IS
  'Pending alerts for scheduled field visits whose appointment window elapsed without start or cancellation.';

COMMENT ON COLUMN visit_scheduled_alerts.responsible_user_id IS
  'field_visits.team_responsible_user_id snapshot: supervisor for a standard team, technician for an emergency team.';

INSERT INTO system_settings (key, value, value_type, category, description, is_editable, updated_at)
VALUES (
  'visit_escalation_job_interval_minutes', '15', 'integer', 'visits',
  'عدد الدقائق بين دورات فحص تنبيهات الزيارات المعلقة وغير الموثقة.', TRUE, NOW()
)
ON CONFLICT (key) DO NOTHING;
