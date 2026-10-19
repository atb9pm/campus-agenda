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

export function assertPersistedPreviewJson(preview: { snapshotJson: string; previewJson: string }): void {
  parsePersistedObjectJson(preview.snapshotJson, "snapshot_json");
  parsePersistedObjectJson(preview.previewJson, "preview_json");
}

export function assertPersistedEntryJson(entry: { entryJson: string }): void {
  parsePersistedObjectJson(entry.entryJson, "entry_json");
}

/** Invariants create() communs Memory / SQLite — à appeler avant toute écriture. */
export function assertCreatePreviewEntries(
  previewId: string,
  entries: readonly { transitionId: string; sourceAgendaItemId: number }[],
): void {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (entry.transitionId !== previewId) {
      throw new Error("transition_id d’entrée incohérent.");
    }
    if (seen.has(entry.sourceAgendaItemId)) {
      throw new Error("source_agenda_item_id en double pour ce PREVIEW.");
    }
    seen.add(entry.sourceAgendaItemId);
  }
}
