import {
  createSecurityEmailTransport,
  notifySecurityEmail,
  readSecurityEmailConfig,
  type SecurityEmailConfig,
  type SecurityEmailDeps,
  type SecurityEmailLogFields,
  type SecurityEmailLogName,
  type SecurityEmailTransport,
} from "@campus/features/security-notifications/index.ts";
import { logOperationalError, logOperationalEvent, logOperationalWarning } from "@campus/lib/observability/index.ts";
import { getSecurityNotificationStore, getTeacherAccountStore } from "@campus/lib/persistence/store-factory.ts";

interface SecurityEmailRuntime {
  config: SecurityEmailConfig;
  transport: SecurityEmailTransport | null;
}

let runtime: SecurityEmailRuntime | null = null;

export function getSecurityEmailRuntime(): SecurityEmailRuntime {
  if (runtime) return runtime;
  const config = readSecurityEmailConfig(process.env);
  if (config.status === "misconfigured") {
    logOperationalWarning("security_email_configuration_invalid", { variables: config.invalid.join(",") });
  }
  runtime = { config, transport: createSecurityEmailTransport(config) };
  return runtime;
}

function logSecurityEmail(name: SecurityEmailLogName, fields: SecurityEmailLogFields) {
  if (name === "security_email_delivery_failed") logOperationalError(name, fields);
  else if (name === "security_email_sent" || name === "security_email_disabled") logOperationalEvent(name, fields);
  else logOperationalWarning(name, fields);
}

async function teacherInitials(teacherId: string): Promise<string | null> {
  try {
    const account = await (await getTeacherAccountStore()).findAccount(teacherId);
    const initials = account?.initials?.trim();
    return initials || null;
  } catch {
    return null;
  }
}

export async function securityEmailDeps(): Promise<SecurityEmailDeps> {
  const { config, transport } = getSecurityEmailRuntime();
  return {
    store: await getSecurityNotificationStore(),
    config,
    transport,
    teacherInitials,
    log: logSecurityEmail,
  };
}

export async function dispatchSecurityEmail(event: Parameters<typeof notifySecurityEmail>[1]): Promise<void> {
  await notifySecurityEmail(await securityEmailDeps(), event);
}
