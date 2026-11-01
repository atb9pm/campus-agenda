import {
  createSecuritySmsProvider,
  readSecuritySmsConfig,
  type SecuritySmsConfig,
  type SecuritySmsDeps,
  type SecuritySmsLogFields,
  type SecuritySmsLogName,
  type SecuritySmsProvider,
} from "@campus/features/security-notifications/index.ts";
import { logOperationalError, logOperationalEvent, logOperationalWarning } from "@campus/lib/observability/index.ts";
import { getSecurityNotificationStore } from "@campus/lib/persistence/store-factory.ts";

interface SecuritySmsRuntime {
  config: SecuritySmsConfig;
  provider: SecuritySmsProvider | null;
}

let runtime: SecuritySmsRuntime | null = null;

/**
 * Configuration lue une fois par processus. Une configuration invalide est
 * signalée par le nom des variables, jamais par leur valeur, et ne lève pas.
 */
export function getSecuritySmsRuntime(): SecuritySmsRuntime {
  if (runtime) return runtime;
  const config = readSecuritySmsConfig(process.env);
  if (config.status === "misconfigured") {
    logOperationalWarning("security_sms_config_invalid", { variables: config.invalid.join(",") });
  }
  runtime = { config, provider: createSecuritySmsProvider(config) };
  return runtime;
}

function logSecuritySms(name: SecuritySmsLogName, fields: SecuritySmsLogFields) {
  if (name === "security_sms_failed") logOperationalError(name, fields);
  else if (name === "security_sms_sent" || name === "security_sms_disabled") logOperationalEvent(name, fields);
  else logOperationalWarning(name, fields);
}

export async function securitySmsDeps(): Promise<SecuritySmsDeps> {
  const { config, provider } = getSecuritySmsRuntime();
  return { store: await getSecurityNotificationStore(), config, provider, log: logSecuritySms };
}

