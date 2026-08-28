-- Comptes enseignant réels : mot de passe personnel haché, activation, première connexion.
-- Les empreintes héritées `demo:...` restent en base mais sont refusées en production.

ALTER TABLE teachers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE teachers ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teachers ADD COLUMN password_updated_at TEXT;

-- L'unicité des initiales est vérifiée côté application : un index unique ferait
-- échouer la migration sur une base existante contenant déjà un doublon.
CREATE INDEX IF NOT EXISTS idx_teachers_initials ON teachers(lower(initials));
