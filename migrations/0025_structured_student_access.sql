-- Accès apprentis structurés : SchoolClass, version de session, révocation.
-- label n'est plus un secret ni une clé d'unicité : deux SchoolClass
-- distinctes (ex. MA2 2026–2027 et MA2 2027–2028) peuvent partager le même code visible.
-- L'unicité métier est school_class_id (index unique partiel).
-- SQLite ne permet pas de DROP CONSTRAINT : on reconstruit la table une seule fois.

-- Pas de FK SQL vers school_classes (comme classrooms.school_class_id en 0024) :
-- le restore v4 insère student_accesses avant school_classes.
ALTER TABLE student_accesses ADD COLUMN school_class_id TEXT;
ALTER TABLE student_accesses ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE student_accesses ADD COLUMN created_at TEXT;
ALTER TABLE student_accesses ADD COLUMN updated_at TEXT;
ALTER TABLE student_accesses ADD COLUMN revoked_at TEXT;

-- Backfill uniquement lorsque classrooms.school_class_id désigne une SchoolClass sans ambiguïté.
UPDATE student_accesses
SET school_class_id = (
  SELECT classrooms.school_class_id
  FROM classrooms
  WHERE classrooms.id = student_accesses.classroom_id
    AND classrooms.school_class_id IS NOT NULL
    AND TRIM(classrooms.school_class_id) != ''
)
WHERE school_class_id IS NULL;

-- En cas de collision (plusieurs accès → même SchoolClass), ne conserver qu'une ligne.
UPDATE student_accesses
SET school_class_id = NULL
WHERE school_class_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id)
    FROM student_accesses
    WHERE school_class_id IS NOT NULL
    GROUP BY school_class_id
  );

UPDATE student_accesses
SET created_at = COALESCE(created_at, datetime('now')),
    updated_at = COALESCE(updated_at, datetime('now'))
WHERE created_at IS NULL OR updated_at IS NULL;

-- CAMPUS:BEGIN ONCE 0025_structured_student_access.sql
DROP TABLE IF EXISTS student_accesses_structured_0025;

CREATE TABLE student_accesses_structured_0025 (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id),
  school_class_id TEXT,
  label TEXT NOT NULL,
  access_code_hash TEXT NOT NULL,
  access_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  revoked_at TEXT
);

DELETE FROM student_accesses_structured_0025;

INSERT INTO student_accesses_structured_0025 (
  id, classroom_id, school_class_id, label, access_code_hash,
  access_version, created_at, updated_at, revoked_at
)
SELECT
  id,
  classroom_id,
  school_class_id,
  label,
  access_code_hash,
  COALESCE(access_version, 1),
  created_at,
  updated_at,
  revoked_at
FROM student_accesses;

DROP TABLE student_accesses;

ALTER TABLE student_accesses_structured_0025 RENAME TO student_accesses;
-- CAMPUS:END ONCE 0025_structured_student_access.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_accesses_school_class_id
  ON student_accesses(school_class_id)
  WHERE school_class_id IS NOT NULL;
