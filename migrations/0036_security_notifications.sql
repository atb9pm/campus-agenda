-- Notifications de sécurité (alertes SMS).
-- Table opérationnelle HORS snapshot métier, comme security_events : jamais exportée,
-- jamais remplacée par une restauration. Une restauration ne peut donc pas remettre
-- le cooldown ou les plafonds SMS dans un état antérieur.
-- Aucun numéro de téléphone, aucun texte de SMS, aucune réponse du fournisseur :
-- uniquement des statuts et une clé de déduplication hachée.
CREATE TABLE IF NOT EXISTS security_notifications (
  id TEXT PRIMARY KEY,
  security_event_id TEXT,
  event_type TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('SMS')),
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

CREATE INDEX IF NOT EXISTS idx_security_notifications_created
  ON security_notifications (created_at);

CREATE INDEX IF NOT EXISTS idx_security_notifications_status
  ON security_notifications (status, created_at);

CREATE INDEX IF NOT EXISTS idx_security_notifications_dedup
  ON security_notifications (deduplication_key, status, created_at);

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
