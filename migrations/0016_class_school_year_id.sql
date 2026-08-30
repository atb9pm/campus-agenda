-- Rattachement stable des classes a une annee scolaire (school_year_id).
-- Migration additive : school_year_label est conserve pour compatibilite.
-- Aucune suppression de donnees. Pas de modification des IDs existants.

ALTER TABLE school_classes ADD COLUMN school_year_id TEXT;
