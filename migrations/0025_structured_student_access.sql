-- Accès apprentis structurés : SchoolClass, version de session, révocation.
-- Une SchoolClass n'a qu'un accès logique courant (index unique partiel).

ALTER TABLE student_accesses ADD COLUMN school_class_id TEXT REFERENCES school_classes(id);
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_accesses_school_class_id
  ON student_accesses(school_class_id)
  WHERE school_class_id IS NOT NULL;
