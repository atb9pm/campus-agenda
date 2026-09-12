-- Double authentification TOTP des administrateurs.
-- Le secret n'est jamais stocké en clair : uniquement un blob chiffré AES-GCM.
-- Les codes de récupération ne sont stockés que sous forme d'empreintes.

CREATE TABLE IF NOT EXISTS teacher_mfa (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id),
  status TEXT NOT NULL,
  secret_encrypted TEXT,
  pending_secret_encrypted TEXT,
  recovery_hashes TEXT,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
