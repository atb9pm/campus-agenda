-- Code apprentis consultable par l'enseignant attribué (chiffré au repos).
-- L'authentification élève reste access_code_hash (PBKDF2). Le backup v4
-- transporte le chiffré, jamais le secret en clair.
ALTER TABLE student_accesses ADD COLUMN access_code_ciphertext TEXT;
