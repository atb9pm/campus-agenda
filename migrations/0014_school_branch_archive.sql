-- Archivage des branches du référentiel école.
-- archived_at NULL = branche visible dans la liste courante.

ALTER TABLE school_branches ADD COLUMN archived_at TEXT;
