export type LogLevel = "info" | "warn" | "error";

export interface ApiLogEvent {
  requestId: string;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  actor?: "teacher" | "student" | "anonymous";
}

function write(level: LogLevel, message: string, fields: Record<string, string | number | boolean | undefined>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function logApiEvent(event: ApiLogEvent) {
  write("info", "api_request", {
    requestId: event.requestId,
    route: event.route,
    method: event.method,
    status: event.status,
    durationMs: Math.round(event.durationMs),
    actor: event.actor,
  });
}

export function logOperationalEvent(message: string, fields: Record<string, string | number | boolean> = {}) {
  write("info", message, fields);
}

export function logOperationalWarning(message: string, fields: Record<string, string | number | boolean> = {}) {
  write("warn", message, fields);
}

export function logOperationalError(message: string, fields: Record<string, string | number | boolean> = {}) {
  write("error", message, fields);
}
