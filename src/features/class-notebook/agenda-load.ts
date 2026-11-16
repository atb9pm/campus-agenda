import type { PrototypeAgendaItem } from "../agenda/demo-items.ts";

export const AGENDA_LOADING_LABEL = "Chargement des publications…";
export const AGENDA_EMPTY_LABEL = "Aucune publication pour cette séance.";
export const AGENDA_ERROR_LABEL = "Impossible de charger les publications de cette classe.";
export const AGENDA_RETRY_LABEL = "Réessayer";

export type AgendaLoadPhase = "unknown" | "loading" | "ready" | "error";

export interface AgendaClassroomSlot {
  classroomId: string;
  schoolYearId: string | null;
  phase: AgendaLoadPhase;
  generation: number;
  items: PrototypeAgendaItem[];
  confirmed: boolean;
  /** Publications créées ou modifiées après le départ de la requête en cours. */
  preservedIds: number[];
  /** Publications retirées après le départ de la requête en cours. */
  removedIds: number[];
  /** Génération dont les publications affichées proviennent. Null tant qu’aucune réussite n’est acceptée. */
  acceptedGeneration: number | null;
}

export interface AgendaLoadLedger {
  slots: Record<string, AgendaClassroomSlot>;
}

export interface AgendaClassroomFetchResult {
  classroomId: string;
  schoolYearId: string | null;
  ok: boolean;
  items: PrototypeAgendaItem[];
  error: string | null;
}

export function emptyAgendaLedger(): AgendaLoadLedger {
  return { slots: {} };
}

/** Une réponse lancée sous une session enseignant ne peut plus s’appliquer après un changement de compte. */
export function agendaResultBelongsToSession(startedEpoch: number, currentEpoch: number): boolean {
  return startedEpoch === currentEpoch;
}

/** Une charge utile enseignant n’est conservée que si la session qui l’a demandée est encore là. */
export function keepTeacherSessionPayload<T>(startedEpoch: number, currentEpoch: number, payload: T): T | null {
  return agendaResultBelongsToSession(startedEpoch, currentEpoch) ? payload : null;
}

export function agendaClassroomKey(classroomId: string, schoolYearId?: string | null): string {
  const id = classroomId.trim();
  const year = schoolYearId?.trim() || "";
  return year ? `${id}|${year}` : id;
}

export function classroomAgendaPhase(ledger: AgendaLoadLedger, key: string): AgendaLoadPhase {
  return ledger.slots[key]?.phase ?? "unknown";
}

/** Une classe n’est chargée que lorsqu’une réponse de sa génération courante a réussi. */
export function startAgendaLoad(
  ledger: AgendaLoadLedger,
  classroomId: string,
  schoolYearId?: string | null,
): { ledger: AgendaLoadLedger; key: string; generation: number } {
  const key = agendaClassroomKey(classroomId, schoolYearId);
  const current = ledger.slots[key];
  const generation = (current?.generation ?? 0) + 1;
  const year = schoolYearId?.trim() || null;
  return {
    key,
    generation,
    ledger: {
      slots: {
        ...ledger.slots,
        [key]: {
          classroomId: classroomId.trim(),
          schoolYearId: year,
          phase: "loading",
          generation,
          items: current?.items ?? [],
          confirmed: current?.confirmed ?? false,
          preservedIds: current?.preservedIds ?? [],
          removedIds: current?.removedIds ?? [],
          acceptedGeneration: current?.acceptedGeneration ?? null,
        },
      },
    },
  };
}

/**
 * Ne conserve que les classes de l’année demandée.
 * Ce filtre ne distingue pas les enseignants : le registre doit être vidé au changement de compte.
 */
export function retainAgendaScope(ledger: AgendaLoadLedger, schoolYearId?: string | null): AgendaLoadLedger {
  const year = schoolYearId?.trim() || null;
  const slots: Record<string, AgendaClassroomSlot> = {};
  for (const [key, slot] of Object.entries(ledger.slots)) {
    if (slot.schoolYearId === year) slots[key] = slot;
  }
  return { slots };
}

export interface AgendaLoadLaunch {
  key: string;
  generation: number;
  classroomId: string;
  /** Vrai si un chargement de cette classe est déjà en cours : aucun nouveau numéro n’est émis. */
  joined: boolean;
}

/** Démarre un chargement par classe, dans un ordre stable, sans effacer les publications déjà reçues. */
export function beginAgendaRefresh(
  ledger: AgendaLoadLedger,
  classroomIds: readonly string[],
  schoolYearId?: string | null,
  options?: { replaceScope?: boolean; joinInFlight?: boolean },
): { ledger: AgendaLoadLedger; started: AgendaLoadLaunch[] } {
  let current = options?.replaceScope ? retainAgendaScope(ledger, schoolYearId) : ledger;
  const unique = [...new Set(classroomIds.map((id) => id.trim()).filter(Boolean))];
  const started: AgendaLoadLaunch[] = [];
  for (const classroomId of unique) {
    const key = agendaClassroomKey(classroomId, schoolYearId);
    const existing = current.slots[key];
    if (options?.joinInFlight && existing?.phase === "loading") {
      started.push({ key, generation: existing.generation, classroomId: existing.classroomId, joined: true });
      continue;
    }
    const next = startAgendaLoad(current, classroomId, schoolYearId);
    current = next.ledger;
    started.push({ key: next.key, generation: next.generation, classroomId, joined: false });
  }
  return { ledger: current, started };
}

function acceptAgendaItems(
  current: AgendaClassroomSlot,
  incoming: readonly PrototypeAgendaItem[],
  acceptedGeneration: number,
  clearLocalMarks: boolean,
): AgendaClassroomSlot {
  const removed = new Set(current.removedIds);
  const preserved = new Set(current.preservedIds);
  const byId = new Map<number, PrototypeAgendaItem>();
  for (const item of incoming) {
    if (item.classroomId !== current.classroomId || removed.has(item.id) || preserved.has(item.id)) continue;
    byId.set(item.id, item);
  }
  for (const item of current.items) {
    if (preserved.has(item.id) && !removed.has(item.id)) byId.set(item.id, item);
  }
  return {
    ...current,
    phase: "ready",
    items: [...byId.values()].sort((left, right) => left.id - right.id),
    confirmed: true,
    acceptedGeneration,
    preservedIds: clearLocalMarks ? [] : current.preservedIds,
    removedIds: clearLocalMarks ? [] : current.removedIds,
  };
}

/**
 * Une réussite n’est écartée que si une génération plus récente a déjà réussi.
 * L’échec d’un chargement plus récent ne laisse donc pas le Carnet en erreur
 * lorsqu’une requête encore en vol a récupéré les publications.
 * Un échec ne remplace jamais les publications par une liste vide.
 */
export function applyAgendaLoadResult(
  ledger: AgendaLoadLedger,
  key: string,
  generation: number,
  result: { ok: true; items: readonly PrototypeAgendaItem[] } | { ok: false },
): { ledger: AgendaLoadLedger; applied: boolean } {
  const current = ledger.slots[key];
  if (!current || generation > current.generation) return { ledger, applied: false };
  if (result.ok) {
    if (generation < current.generation && current.phase === "ready") return { ledger, applied: false };
    const slot = acceptAgendaItems(
      current,
      result.items,
      generation,
      generation === current.generation || current.phase === "error",
    );
    return { applied: true, ledger: { slots: { ...ledger.slots, [key]: slot } } };
  }
  if (current.generation !== generation) return { ledger, applied: false };
  if (current.phase === "ready") return { ledger, applied: false };
  return {
    applied: true,
    ledger: {
      slots: {
        ...ledger.slots,
        [key]: { ...current, phase: "error" },
      },
    },
  };
}

/** Applique un lot terminé sur l’état le plus récent. Une réussite plus ancienne reste valable si la génération récente a échoué. */
export function commitAgendaLoadResults(
  ledger: AgendaLoadLedger,
  started: readonly AgendaLoadLaunch[],
  results: readonly AgendaClassroomFetchResult[],
  onDiagnostic?: (event: { kind: NotebookDiagnosticKind; classroomId: string }) => void,
): AgendaLoadLedger {
  let current = ledger;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]!;
    const launch = started[index];
    if (!launch) continue;
    const applied = applyAgendaLoadResult(
      current,
      launch.key,
      launch.generation,
      result.ok ? { ok: true, items: result.items } : { ok: false },
    );
    if (applied.applied) current = applied.ledger;
    else onDiagnostic?.({ kind: "stale-response", classroomId: result.classroomId });
    if (applied.applied && !result.ok) {
      onDiagnostic?.({ kind: "load-failed", classroomId: result.classroomId });
    }
  }
  return current;
}

function slotKeyForClassroom(
  ledger: AgendaLoadLedger,
  classroomId: string,
  schoolYearId?: string | null,
): string {
  const id = classroomId.trim();
  const year = schoolYearId?.trim() || null;
  const exact = agendaClassroomKey(id, year);
  if (ledger.slots[exact]) return exact;
  const matches = Object.entries(ledger.slots).filter(([, slot]) => slot.classroomId === id);
  if (year) {
    const sameYear = matches.find(([, slot]) => slot.schoolYearId === year);
    if (sameYear) return sameYear[0];
  }
  if (matches.length === 1) return matches[0][0];
  const active = matches.find(([, slot]) => slot.schoolYearId == null);
  if (active) return active[0];
  return exact;
}

function withClassroomSlot(
  ledger: AgendaLoadLedger,
  classroomId: string,
  schoolYearId: string | null,
  update: (slot: AgendaClassroomSlot) => AgendaClassroomSlot,
): AgendaLoadLedger {
  const key = slotKeyForClassroom(ledger, classroomId, schoolYearId);
  const current = ledger.slots[key] ?? {
    classroomId: classroomId.trim(),
    schoolYearId,
    phase: "unknown" as const,
    generation: 0,
    items: [],
    confirmed: false,
    preservedIds: [],
    removedIds: [],
    acceptedGeneration: null,
  };
  return { slots: { ...ledger.slots, [key]: update(current) } };
}

/** Garde une publication locale jusqu’à ce qu’une réponse de la génération courante l’ait prise en compte. */
export function rememberAgendaItem(ledger: AgendaLoadLedger, item: PrototypeAgendaItem): AgendaLoadLedger {
  return withClassroomSlot(ledger, item.classroomId, item.schoolYearId?.trim() || null, (slot) => {
    const preserved = new Set(slot.preservedIds);
    preserved.add(item.id);
    const index = slot.items.findIndex((entry) => entry.id === item.id);
    const items = index >= 0
      ? slot.items.map((entry, position) => (position === index ? item : entry))
      : [...slot.items, item];
    return {
      ...slot,
      items,
      preservedIds: [...preserved],
      removedIds: slot.removedIds.filter((id) => id !== item.id),
    };
  });
}

/** Une suppression locale ne doit pas être réintroduite par une réponse partie avant elle. */
export function forgetAgendaItem(ledger: AgendaLoadLedger, item: PrototypeAgendaItem): AgendaLoadLedger {
  return withClassroomSlot(ledger, item.classroomId, item.schoolYearId?.trim() || null, (slot) => ({
    ...slot,
    items: slot.items.filter((entry) => entry.id !== item.id),
    preservedIds: slot.preservedIds.filter((id) => id !== item.id),
    removedIds: slot.removedIds.includes(item.id) ? slot.removedIds : [...slot.removedIds, item.id],
  }));
}

/** Reporte les créations, modifications et suppressions locales dans le suivi de la classe. */
export function projectAgendaMutations(
  ledger: AgendaLoadLedger,
  previous: readonly PrototypeAgendaItem[],
  next: readonly PrototypeAgendaItem[],
): AgendaLoadLedger {
  const before = new Map(previous.map((item) => [item.id, item]));
  const after = new Map(next.map((item) => [item.id, item]));
  let current = ledger;
  for (const [id, item] of after) {
    const prior = before.get(id);
    if (!prior || JSON.stringify(prior) !== JSON.stringify(item)) current = rememberAgendaItem(current, item);
  }
  for (const item of before.values()) {
    if (!after.has(item.id)) current = forgetAgendaItem(current, item);
  }
  return current;
}

export function agendaItemsFromLedger(ledger: AgendaLoadLedger): PrototypeAgendaItem[] {
  const merged = new Map<number, PrototypeAgendaItem>();
  for (const key of Object.keys(ledger.slots).sort()) {
    for (const item of ledger.slots[key]!.items) merged.set(item.id, item);
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
}

export async function loadAgendaClassrooms(
  requests: readonly { classroomId: string; schoolYearId?: string | null }[],
  fetchItems: (classroomId: string, schoolYearId: string | null) => Promise<PrototypeAgendaItem[]>,
): Promise<AgendaClassroomFetchResult[]> {
  const settled = await Promise.allSettled(
    requests.map(async (request) => {
      const schoolYearId = request.schoolYearId?.trim() || null;
      const items = await fetchItems(request.classroomId, schoolYearId);
      return { classroomId: request.classroomId.trim(), schoolYearId, items };
    }),
  );
  return settled.map((entry, index) => {
    const request = requests[index]!;
    const schoolYearId = request.schoolYearId?.trim() || null;
    if (entry.status === "fulfilled") {
      return {
        classroomId: request.classroomId.trim(),
        schoolYearId,
        ok: true,
        items: entry.value.items,
        error: null,
      };
    }
    const reason = entry.reason;
    return {
      classroomId: request.classroomId.trim(),
      schoolYearId,
      ok: false,
      items: [],
      error: reason instanceof Error ? reason.message : "Impossible de charger l'agenda.",
    };
  });
}

export function notebookPublicationPlaceholder(input: {
  phase: AgendaLoadPhase;
  visibleCount: number;
}): "loading" | "error" | "content" {
  if (input.visibleCount > 0 || input.phase === "ready") return "content";
  if (input.phase === "error") return "error";
  return "loading";
}

export type NotebookDiagnosticKind = "load-failed" | "stale-response" | "retry" | "notes-conflict";

/** Champs sûrs : aucune publication, aucun contrôle et aucune note. */
export function notebookDiagnosticFields(event: {
  kind: NotebookDiagnosticKind;
  classroomId?: string | null;
}): { message: "notebook_diagnostic"; kind: NotebookDiagnosticKind; classroomId: string | null } {
  return {
    message: "notebook_diagnostic",
    kind: event.kind,
    classroomId: event.classroomId?.trim() || null,
  };
}

export function reportNotebookDiagnostic(
  event: { kind: NotebookDiagnosticKind; classroomId?: string | null },
  sink: (fields: ReturnType<typeof notebookDiagnosticFields>) => void = (fields) => {
    console.info(JSON.stringify(fields));
  },
): void {
  sink(notebookDiagnosticFields(event));
}
