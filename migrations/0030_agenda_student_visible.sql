-- Visibilité élève des publications d'agenda.
-- 1 = visible (comportement historique). 0 = brouillon enseignant.
-- Les lignes existantes restent visibles.

ALTER TABLE agenda_items ADD COLUMN student_visible INTEGER NOT NULL DEFAULT 1;
