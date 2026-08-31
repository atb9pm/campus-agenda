-- Cycle de vie des classes : Active / Desactivee / Archivee.
-- Migration additive et rejouable. Aucune reconstruction de table.
-- Les classes existantes restent is_archived = 0, archived_at = NULL.
-- Pas de ON DELETE CASCADE. Les IDs, codes et rattachements restent inchanges.

ALTER TABLE school_classes ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE school_classes ADD COLUMN archived_at TEXT;
