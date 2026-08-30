-- Types d'enseignement (branches + enseignants) et garde-fou CTX.
-- Migration additive : aucune suppression ni remplissage automatique.

ALTER TABLE teachers ADD COLUMN teaching_type TEXT CHECK (
  teaching_type IS NULL OR teaching_type IN ('TECHNICAL', 'GENERAL')
);

ALTER TABLE school_branches ADD COLUMN teaching_type TEXT CHECK (
  teaching_type IS NULL OR teaching_type IN ('TECHNICAL', 'GENERAL')
);

CREATE TRIGGER IF NOT EXISTS pedagogical_contexts_delete_guard
BEFORE DELETE ON pedagogical_contexts
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CTX used archive instead')
  WHERE EXISTS (SELECT 1 FROM pedagogical_paths WHERE context_id = OLD.id)
     OR EXISTS (SELECT 1 FROM annual_course_notes WHERE context_id = OLD.id);
END;
