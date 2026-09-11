-- Semaines scolaires : l'alternance A/B devient facultative.
-- Les semaines générées depuis le plan de scolarité officiel n'ont pas de kind.
-- Reconstruction non destructive : toutes les lignes A/B existantes sont copiées.
-- Le bloc CAMPUS:BEGIN/END ONCE n'est exécuté qu'une seule fois.

-- CAMPUS:BEGIN ONCE 0028_school_weeks_kind_nullable.sql
DROP TABLE IF EXISTS school_weeks_kind_0028;

CREATE TABLE school_weeks_kind_0028 (
  school_year_id TEXT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 38),
  week_kind TEXT CHECK (week_kind IS NULL OR week_kind IN ('A', 'B')),
  monday TEXT NOT NULL,
  PRIMARY KEY (school_year_id, week_number)
);

INSERT INTO school_weeks_kind_0028 (school_year_id, week_number, week_kind, monday)
SELECT school_year_id, week_number, week_kind, monday
FROM school_weeks;

DROP TABLE school_weeks;

ALTER TABLE school_weeks_kind_0028 RENAME TO school_weeks;
-- CAMPUS:END ONCE 0028_school_weeks_kind_nullable.sql
