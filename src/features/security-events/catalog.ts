import type { SecurityCategory, SecuritySeverity, SecuritySummaryBucket } from "./types.ts";

/**
 * Types de valeurs de métadonnées acceptés.
 * - `id` : identifiant interne (teacher-…, school-class-…) ;
 * - `code` : code court en majuscules (préfixe de classe) ;
 * - `int` : entier positif borné ;
 * - `bool` ;
 * - liste : énumération fermée.
 */
export type SecurityMetadataSpec = "id" | "code" | "int" | "bool" | readonly string[];

export interface SecurityEventDefinition {
  category: SecurityCategory;
  severity: SecuritySeverity;
  label: string;
  bucket: SecuritySummaryBucket | null;
  metadata: Readonly<Record<string, SecurityMetadataSpec>>;
}

const RATE_LIMIT_SCOPES = ["teacher", "student", "teacher-password", "teacher-mfa"] as const;
const MFA_STEPS = ["login-challenge", "enrollment", "reconfigure", "regenerate-recovery-codes"] as const;
const ANOMALY_METADATA = {
  scope: ["account", "source"],
  observedCount: "int",
  threshold: "int",
  windowMinutes: "int",
} as const satisfies Record<string, SecurityMetadataSpec>;

function define<T extends Record<string, SecurityEventDefinition>>(catalog: T): T {
  return catalog;
}

export const SECURITY_EVENT_CATALOG = define({
  TEACHER_LOGIN_SUCCEEDED: {
    category: "AUTH",
    severity: "INFO",
    label: "Connexion réussie",
    bucket: "loginSucceeded",
    metadata: { mfaRequired: "bool", passwordChangeRequired: "bool" },
  },
  TEACHER_LOGIN_FAILED: {
    category: "AUTH",
    severity: "INFO",
    label: "Connexion refusée",
    bucket: "loginFailed",
    metadata: { accountKnown: "bool", reason: ["invalid-credentials", "malformed-request"] },
  },
  TEACHER_LOGIN_ACCOUNT_BLOCKED: {
    category: "AUTH",
    severity: "WARNING",
    label: "Connexion d’un compte désactivé ou archivé",
    bucket: "loginFailed",
    metadata: { accountState: ["disabled", "archived"] },
  },
  STUDENT_LOGIN_FAILED: {
    category: "AUTH",
    severity: "INFO",
    label: "Connexion apprenti refusée",
    bucket: "loginFailed",
    metadata: { classPrefix: "code", codeFormatValid: "bool" },
  },
  SESSION_REJECTED: {
    category: "AUTH",
    severity: "INFO",
    label: "Session révoquée refusée",
    bucket: null,
    metadata: { sessionKind: ["teacher", "student"] },
  },
  TEACHER_PASSWORD_CHANGED: {
    category: "AUTH",
    severity: "INFO",
    label: "Mot de passe modifié par son titulaire",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_PASSWORD_CHANGE_FAILED: {
    category: "AUTH",
    severity: "INFO",
    label: "Changement de mot de passe refusé",
    bucket: "loginFailed",
    metadata: { reason: ["wrong-current-password", "rejected"] },
  },
  MFA_VERIFY_SUCCEEDED: {
    category: "MFA",
    severity: "INFO",
    label: "Double authentification validée",
    bucket: null,
    metadata: { usedRecovery: "bool" },
  },
  MFA_VERIFY_FAILED: {
    category: "MFA",
    severity: "INFO",
    label: "Code de double authentification incorrect",
    bucket: "loginFailed",
    metadata: { step: MFA_STEPS },
  },
  MFA_RECOVERY_CODE_USED: {
    category: "MFA",
    severity: "WARNING",
    label: "Code de récupération MFA utilisé",
    bucket: "sensitive",
    metadata: { context: ["login-challenge", "lost-device-reconfigure"], recoveryRemaining: "int" },
  },
  MFA_ENABLED: {
    category: "MFA",
    severity: "INFO",
    label: "Double authentification activée",
    bucket: "sensitive",
    metadata: {},
  },
  MFA_RECONFIGURED: {
    category: "MFA",
    severity: "WARNING",
    label: "Double authentification reconfigurée",
    bucket: "sensitive",
    metadata: {},
  },
  MFA_RECOVERY_CODES_REGENERATED: {
    category: "MFA",
    severity: "WARNING",
    label: "Codes de récupération MFA régénérés",
    bucket: "sensitive",
    metadata: {},
  },
  MFA_SENSITIVE_ACTION_DENIED: {
    category: "MFA",
    severity: "WARNING",
    label: "Modification MFA refusée",
    bucket: "denied",
    metadata: { step: MFA_STEPS, reason: ["wrong-password", "wrong-code", "rejected"] },
  },
  MFA_RESET: {
    category: "MFA",
    severity: "WARNING",
    label: "Double authentification réinitialisée",
    bucket: "sensitive",
    metadata: { via: ["server-script"] },
  },
  RATE_LIMIT_TRIGGERED: {
    category: "RATE_LIMIT",
    severity: "WARNING",
    label: "Blocage automatique (trop de tentatives)",
    bucket: "blocked",
    metadata: { scope: RATE_LIMIT_SCOPES, layer: ["ip", "target"], targetKnown: "bool" },
  },
  ADMIN_ACCESS_DENIED: {
    category: "AUTHZ",
    severity: "WARNING",
    label: "Accès administrateur refusé",
    bucket: "denied",
    metadata: { reason: ["anonymous", "student", "not-admin", "untrusted-origin", "session-revoked"] },
  },
  TEACHER_ACCOUNT_CREATED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Compte enseignant créé",
    bucket: "sensitive",
    metadata: { isAdmin: "bool", teachingType: ["TECHNICAL", "GENERAL"] },
  },
  TEACHER_ACCOUNT_ENABLED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Compte enseignant réactivé",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_ACCOUNT_DISABLED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Compte enseignant désactivé",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_ACCOUNT_ARCHIVED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Compte enseignant archivé",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_ACCOUNT_UNARCHIVED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Compte enseignant désarchivé",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_ADMIN_ROLE_GRANTED: {
    category: "ADMIN",
    severity: "WARNING",
    label: "Rôle administrateur attribué",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_ADMIN_ROLE_REVOKED: {
    category: "ADMIN",
    severity: "WARNING",
    label: "Rôle administrateur retiré",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_LOGIN_IDENTIFIER_CHANGED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Initiales de connexion modifiées",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_ACCOUNT_DELETED: {
    category: "ADMIN",
    severity: "WARNING",
    label: "Compte enseignant supprimé définitivement",
    bucket: "sensitive",
    metadata: {},
  },
  TEACHER_PASSWORD_RESET: {
    category: "ADMIN",
    severity: "WARNING",
    label: "Mot de passe réinitialisé par un administrateur",
    bucket: "sensitive",
    metadata: { via: ["admin-ui", "server-script"] },
  },
  STUDENT_ACCESS_ROTATED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Code apprentis généré ou renouvelé",
    bucket: "sensitive",
    metadata: {},
  },
  STUDENT_ACCESS_REVOKED: {
    category: "ADMIN",
    severity: "INFO",
    label: "Code apprentis désactivé",
    bucket: "sensitive",
    metadata: {},
  },
  SECURITY_SMS_TEST_REQUESTED: {
    category: "ADMIN",
    severity: "INFO",
    label: "SMS de test des alertes de sécurité",
    bucket: "sensitive",
    metadata: { outcome: ["sent", "failed", "suppressed-cooldown", "suppressed-quota", "disabled"] },
  },
  SECURITY_EMAIL_TEST_REQUESTED: {
    category: "ADMIN",
    severity: "INFO",
    label: "E-mail de test des alertes de sécurité",
    bucket: "sensitive",
    metadata: { outcome: ["sent", "failed", "suppressed-cooldown", "disabled"] },
  },
  BACKUP_DOWNLOADED: {
    category: "BACKUP",
    severity: "INFO",
    label: "Sauvegarde téléchargée (opération sensible)",
    bucket: "sensitive",
    metadata: { formatVersion: "int", tableCount: "int" },
  },
  BACKUP_RESTORE_STARTED: {
    category: "BACKUP",
    severity: "WARNING",
    label: "Restauration lancée",
    bucket: "sensitive",
    metadata: {},
  },
  BACKUP_RESTORE_SUCCEEDED: {
    category: "BACKUP",
    severity: "WARNING",
    label: "Restauration réussie",
    bucket: "sensitive",
    metadata: { formatVersion: "int", restoredTables: "bool" },
  },
  BACKUP_RESTORE_FAILED: {
    category: "BACKUP",
    severity: "WARNING",
    label: "Restauration échouée",
    bucket: "sensitive",
    metadata: { failure: ["validation", "unexpected-error"] },
  },
  DATA_EXPORTED: {
    category: "EXPORT",
    severity: "INFO",
    label: "Export de données (opération sensible)",
    bucket: "sensitive",
    metadata: { exportKind: ["school-year"], format: ["json", "csv"], itemCount: "int" },
  },
  ANOMALY_REPEATED_LOGIN_FAILURES: {
    category: "ANOMALY",
    severity: "WARNING",
    label: "Échecs de connexion répétés",
    bucket: "alerts",
    metadata: ANOMALY_METADATA,
  },
  ANOMALY_REPEATED_STUDENT_LOGIN_FAILURES: {
    category: "ANOMALY",
    severity: "WARNING",
    label: "Échecs de connexion apprentis répétés",
    bucket: "alerts",
    metadata: ANOMALY_METADATA,
  },
  ANOMALY_REPEATED_MFA_FAILURES: {
    category: "ANOMALY",
    severity: "WARNING",
    label: "Échecs de double authentification répétés",
    bucket: "alerts",
    metadata: ANOMALY_METADATA,
  },
  ANOMALY_REPEATED_ACCESS_DENIED: {
    category: "ANOMALY",
    severity: "WARNING",
    label: "Accès refusés répétés",
    bucket: "alerts",
    metadata: ANOMALY_METADATA,
  },
  ANOMALY_HIGH_READ_VOLUME: {
    category: "ANOMALY",
    severity: "WARNING",
    label: "Volume inhabituel de lectures API",
    bucket: "alerts",
    metadata: ANOMALY_METADATA,
  },
});

export type SecurityEventType = keyof typeof SECURITY_EVENT_CATALOG;

export const SECURITY_EVENT_TYPES = Object.keys(SECURITY_EVENT_CATALOG) as SecurityEventType[];

export function isSecurityEventType(value: unknown): value is SecurityEventType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SECURITY_EVENT_CATALOG, value);
}

export function securityEventDefinition(type: SecurityEventType): SecurityEventDefinition {
  return SECURITY_EVENT_CATALOG[type];
}

export function securityEventTypesInBucket(bucket: SecuritySummaryBucket): SecurityEventType[] {
  return SECURITY_EVENT_TYPES.filter((type) => SECURITY_EVENT_CATALOG[type].bucket === bucket);
}
