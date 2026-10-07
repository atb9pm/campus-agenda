-- Rôle administrateur (phase 2.4) : peut modifier/supprimer les publications des autres enseignants.

ALTER TABLE teachers ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
