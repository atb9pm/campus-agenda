import type { YearTransitionClassMapping, YearTransitionClassMappingSummary } from "./types.ts";

export type ResolvedClassMapping =
  | { status: "one_to_one"; targetClassId: string }
  | { status: "no_continuation" }
  | { status: "missing" }
  | { status: "unsupported"; sourceClassIds: string[]; targetClassIds: string[] };

export interface MappingIndex {
  sourcesToTargets: Map<string, Set<string | null>>;
  targetsToSources: Map<string, Set<string>>;
  summary: YearTransitionClassMappingSummary;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function indexClassMappings(mappings: readonly YearTransitionClassMapping[]): MappingIndex {
  const sourcesToTargets = new Map<string, Set<string | null>>();
  const targetsToSources = new Map<string, Set<string>>();

  for (const mapping of mappings) {
    const source = mapping.sourceClassId?.trim() || null;
    const target = mapping.targetClassId?.trim() || null;
    if (!source && !target) continue;

    if (source) {
      const targets = sourcesToTargets.get(source) ?? new Set<string | null>();
      targets.add(target);
      sourcesToTargets.set(source, targets);
    }
    if (source && target) {
      const sources = targetsToSources.get(target) ?? new Set<string>();
      sources.add(source);
      targetsToSources.set(target, sources);
    }
  }

  const oneToOne: YearTransitionClassMappingSummary["oneToOne"] = [];
  const noContinuation: string[] = [];
  const unsupported: YearTransitionClassMappingSummary["unsupported"] = [];
  const seenUnsupported = new Set<string>();

  for (const sourceClassId of sortedUnique(sourcesToTargets.keys())) {
    const resolved = resolveIndexedMapping(sourceClassId, sourcesToTargets, targetsToSources);
    if (resolved.status === "one_to_one") {
      oneToOne.push({ sourceClassId, targetClassId: resolved.targetClassId });
    } else if (resolved.status === "no_continuation") {
      noContinuation.push(sourceClassId);
    } else if (resolved.status === "unsupported") {
      const key = `${resolved.sourceClassIds.join(",")}>${resolved.targetClassIds.join(",")}`;
      if (!seenUnsupported.has(key)) {
        seenUnsupported.add(key);
        unsupported.push({
          sourceClassIds: resolved.sourceClassIds,
          targetClassIds: resolved.targetClassIds,
        });
      }
    }
  }

  const targetOnly = sortedUnique(
    mappings
      .filter((mapping) => !(mapping.sourceClassId?.trim()) && Boolean(mapping.targetClassId?.trim()))
      .map((mapping) => mapping.targetClassId!.trim()),
  );

  return {
    sourcesToTargets,
    targetsToSources,
    summary: {
      oneToOne: oneToOne.sort(
        (left, right) =>
          left.sourceClassId.localeCompare(right.sourceClassId) ||
          left.targetClassId.localeCompare(right.targetClassId),
      ),
      noContinuation,
      targetOnly,
      unsupported,
    },
  };
}

function resolveIndexedMapping(
  sourceClassId: string,
  sourcesToTargets: Map<string, Set<string | null>>,
  targetsToSources: Map<string, Set<string>>,
): ResolvedClassMapping {
  const targets = sourcesToTargets.get(sourceClassId);
  if (!targets || targets.size === 0) return { status: "missing" };

  const concreteTargets = [...targets].filter((value): value is string => Boolean(value));
  if (concreteTargets.length === 0) return { status: "no_continuation" };
  if (concreteTargets.length > 1 || targets.size > 1) {
    const involvedSources = new Set<string>([sourceClassId]);
    for (const targetId of concreteTargets) {
      for (const sourceId of targetsToSources.get(targetId) ?? []) involvedSources.add(sourceId);
    }
    return {
      status: "unsupported",
      sourceClassIds: sortedUnique(involvedSources),
      targetClassIds: sortedUnique(concreteTargets),
    };
  }

  const targetClassId = concreteTargets[0]!;
  const sourcesForTarget = targetsToSources.get(targetClassId) ?? new Set<string>();
  if (sourcesForTarget.size > 1) {
    return {
      status: "unsupported",
      sourceClassIds: sortedUnique(sourcesForTarget),
      targetClassIds: [targetClassId],
    };
  }

  return { status: "one_to_one", targetClassId };
}

export function resolveClassMapping(sourceClassId: string, index: MappingIndex): ResolvedClassMapping {
  if (!index.sourcesToTargets.has(sourceClassId)) return { status: "missing" };
  return resolveIndexedMapping(sourceClassId, index.sourcesToTargets, index.targetsToSources);
}
