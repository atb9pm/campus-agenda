-- Métadonnées d'accès enseignant : archivage et dernière connexion.
-- archived_at NULL = compte visible dans la liste courante.
-- last_login_at NULL = jamais connecté depuis l'activation de cette colonne.

ALTER TABLE teachers ADD COLUMN archived_at TEXT;
ALTER TABLE teachers ADD COLUMN last_login_at TEXT;
