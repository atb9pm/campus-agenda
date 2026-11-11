-- Compteurs agrégés de fréquentation de l'espace élève.
-- Une ligne = un jour (Europe/Zurich) + une année scolaire + une classe.
-- Aucun élève, aucune adresse, aucun jeton, aucun contenu pédagogique.

CREATE TABLE IF NOT EXISTS student_daily_visits (
  visit_date TEXT NOT NULL,
  school_year_id TEXT NOT NULL,
  school_class_id TEXT NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  PRIMARY KEY (visit_date, school_year_id, school_class_id)
);

CREATE INDEX IF NOT EXISTS idx_student_daily_visits_date
  ON student_daily_visits (visit_date);
