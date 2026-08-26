-- Phase 2.3 : validité temporelle des affectations enseignant ↔ branche.

ALTER TABLE memberships ADD COLUMN valid_from TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE memberships ADD COLUMN valid_to TEXT;

CREATE INDEX IF NOT EXISTS idx_memberships_validity
  ON memberships (classroom_id, teacher_id, valid_from, valid_to);
