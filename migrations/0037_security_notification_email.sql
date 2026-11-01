-- Canal EMAIL sur security_notifications (en plus de SMS).
-- Reconstruction non destructive : les lignes SMS existantes sont copiées.
-- Toujours hors snapshot métier. Aucune adresse e-mail, aucun corps de message.

-- CAMPUS:BEGIN ONCE 0037_security_notifications_email.sql
DROP TABLE IF EXISTS security_notifications_email_0037;

CREATE TABLE security_notifications_email_0037 (
  id TEXT PRIMARY KEY,
  security_event_id TEXT,
  event_type TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL')),
  kind TEXT NOT NULL CHECK (kind IN ('ALERT', 'TEST')),
  level TEXT NOT NULL CHECK (level IN ('WARNING', 'CRITICAL', 'TEST')),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED_COOLDOWN', 'SUPPRESSED_RATE_LIMIT', 'DISABLED')
  ),
  deduplication_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  sent_at TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  provider_message_id TEXT,
  failure_category TEXT
);

INSERT INTO security_notifications_email_0037 (
  id, security_event_id, event_type, channel, kind, level, status,
  deduplication_key, created_at, last_seen_at, sent_at, occurrence_count,
  provider_message_id, failure_category
)
SELECT
  id, security_event_id, event_type, channel, kind, level, status,
  deduplication_key, created_at, last_seen_at, sent_at, occurrence_count,
  provider_message_id, failure_category
FROM security_notifications;

DROP TABLE security_notifications;

ALTER TABLE security_notifications_email_0037 RENAME TO security_notifications;
-- CAMPUS:END ONCE 0037_security_notifications_email.sql

CREATE INDEX IF NOT EXISTS idx_security_notifications_created
  ON security_notifications (created_at);

CREATE INDEX IF NOT EXISTS idx_security_notifications_status
  ON security_notifications (status, created_at);

CREATE INDEX IF NOT EXISTS idx_security_notifications_dedup
  ON security_notifications (deduplication_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_security_notifications_channel_dedup
  ON security_notifications (channel, deduplication_key, status, created_at);

CREATE TRIGGER IF NOT EXISTS security_notifications_append_only
BEFORE UPDATE OF id, security_event_id, event_type, channel, kind, level, deduplication_key, created_at
ON security_notifications
BEGIN
  SELECT RAISE(ABORT, 'security_notifications est append-only');
END;

CREATE TRIGGER IF NOT EXISTS security_notifications_status_final
BEFORE UPDATE OF status
ON security_notifications
WHEN OLD.status <> 'PENDING' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'statut de notification définitif');
END;
