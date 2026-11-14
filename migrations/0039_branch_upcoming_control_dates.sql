-- Nombre de prochaines dates de contrôle visibles par branche officielle.
-- 1 = comportement actuel. Aucune branche existante ne passe à 2.

ALTER TABLE school_branches ADD COLUMN max_upcoming_control_dates INTEGER NOT NULL DEFAULT 1
  CHECK (max_upcoming_control_dates IN (1, 2));
