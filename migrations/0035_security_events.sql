-- Journal de sécurité (SecurityEvent).
-- Journal opérationnel HORS snapshot métier : jamais exporté dans une sauvegarde,
-- jamais effacé ni remplacé par une restauration (voir campus-backup-tables.ts).
-- Append-only : seuls occurrence_count, last_seen_at et metadata_json d'un agrégat
-- peuvent évoluer. La seule suppression est la purge de rétention (180 jours).
-- Aucune adresse IP brute : source_fingerprint = HMAC tronqué.
CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('TEACHER', 'STUDENT', 'ANONYMOUS', 'SYSTEM')),
  actor_id TEXT,
  target_type TEXT CHECK (target_type IS NULL OR target_type IN ('TEACHER', 'SCHOOL_CLASS')),
  target_id TEXT,
  route TEXT,
  http_method TEXT,
  http_status INTEGER,
  request_id TEXT,
  source_fingerprint TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  aggregation_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_events_last_seen
  ON security_events (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_security_events_severity
  ON security_events (severity, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_security_events_type
  ON security_events (event_type, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_security_events_actor
  ON security_events (actor_id, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_security_events_target
  ON security_events (target_id, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_security_events_source
  ON security_events (source_fingerprint, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_security_events_aggregation
  ON security_events (aggregation_key, last_seen_at);

CREATE TRIGGER IF NOT EXISTS security_events_append_only
BEFORE UPDATE OF id, occurred_at, event_type, category, severity, actor_type, actor_id,
  target_type, target_id, route, http_method, http_status, request_id, source_fingerprint,
  aggregation_key
ON security_events
BEGIN
  SELECT RAISE(ABORT, 'security_events est append-only');
END;
