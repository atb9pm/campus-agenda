export class YearTransitionPreviewJsonError extends Error {
  constructor(label: string) {
    super(`${label} JSON invalide.`);
    this.name = "YearTransitionPreviewJsonError";
  }
}

export function parsePersistedObjectJson(raw: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new YearTransitionPreviewJsonError(label);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new YearTransitionPreviewJsonError(label);
  }
  return value as Record<string, unknown>;
}
