import { normalizeMappingClassId } from "./class-mapping.ts";
import { parsePersistedObjectJson } from "./persist-json.ts";
import type { YearTransitionClassMapping } from "./types.ts";

export class YearTransitionSnapshotCorruptedError extends Error {
  constructor(message = "PREVIEW_CORRUPTED") {
    super(message);
    this.name = "YearTransitionSnapshotCorruptedError";
  }
}

function nullableId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new YearTransitionSnapshotCorruptedError();
  }
  return normalizeMappingClassId(value);
}

/**
 * Mappings figés du PREVIEW : extraits du snapshot matériel, jamais de preview_json.
 */
export function extractClassMappingsFromSnapshotJson(snapshotJson: string): YearTransitionClassMapping[] {
  const snapshot = parsePersistedObjectJson(snapshotJson, "snapshot_json");
  const raw = snapshot.classMappings;
  if (!Array.isArray(raw)) {
    throw new YearTransitionSnapshotCorruptedError();
  }
  const mappings: YearTransitionClassMapping[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new YearTransitionSnapshotCorruptedError();
    }
    const record = entry as Record<string, unknown>;
    if (!("sourceClassId" in record) || !("targetClassId" in record)) {
      throw new YearTransitionSnapshotCorruptedError();
    }
    mappings.push({
      sourceClassId: nullableId(record.sourceClassId),
      targetClassId: nullableId(record.targetClassId),
    });
  }
  return mappings;
}
