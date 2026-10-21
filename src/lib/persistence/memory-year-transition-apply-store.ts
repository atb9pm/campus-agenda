import type {
  PersistedYearTransitionApply,
  PersistedYearTransitionApplyEntry,
  YearTransitionApplyPlan,
  YearTransitionApplyStore,
} from "../../features/year-transition/apply-types.ts";
import type { PrototypeAgendaItem } from "../../features/agenda/demo-items.ts";
import { getMemoryAgendaStore, MemoryAgendaStore } from "./memory-store.ts";
import { getMemoryAnnualCourseNotesStore, MemoryAnnualCourseNotesStore } from "./memory-pedagogical-path-store.ts";
import { transitionNoteToken } from "./sql/sql-year-transition-apply-store.ts";

function cloneApply(row: PersistedYearTransitionApply): PersistedYearTransitionApply {
  return { ...row };
}

function cloneEntry(row: PersistedYearTransitionApplyEntry): PersistedYearTransitionApplyEntry {
  return { ...row };
}

function cloneItem(item: PrototypeAgendaItem): PrototypeAgendaItem {
  return { ...item };
}

export class MemoryYearTransitionApplyStore implements YearTransitionApplyStore {
  private readonly applies = new Map<string, PersistedYearTransitionApply>();
  private readonly entries = new Map<string, PersistedYearTransitionApplyEntry[]>();
  private readonly agenda: MemoryAgendaStore;
  private readonly notes?: MemoryAnnualCourseNotesStore;

  constructor(agenda: MemoryAgendaStore, notes?: MemoryAnnualCourseNotesStore) {
    this.agenda = agenda;
    this.notes = notes;
  }

  async getByTransitionId(transitionId: string): Promise<PersistedYearTransitionApply | null> {
    const row = this.applies.get(transitionId);
    return row ? cloneApply(row) : null;
  }

  async listEntries(transitionId: string): Promise<PersistedYearTransitionApplyEntry[]> {
    return (this.entries.get(transitionId) ?? []).map(cloneEntry);
  }

  async applyAtomically(plan: YearTransitionApplyPlan): Promise<void> {
    const itemsSnapshot = await this.agenda.exportAllItems();
    const appliesSnapshot = new Map([...this.applies.entries()].map(([id, row]) => [id, cloneApply(row)]));
    const entriesSnapshot = new Map(
      [...this.entries.entries()].map(([id, list]) => [id, list.map(cloneEntry)]),
    );

    try {
      if (this.applies.has(plan.apply.transitionId)) {
        throw new Error("UNIQUE constraint failed: year_transition_applies.transition_id");
      }

      const nextItems = itemsSnapshot.map(cloneItem);
      if (plan.noteGuard) {
        const guard = plan.noteGuard;
        if (!this.notes) throw new Error("Private note store unavailable");
        const current = this.notes.exportAllNotes().filter(n => n.ownerTeacherId === guard.ownerTeacherId
          && [guard.sourceSchoolYearId, guard.targetSchoolYearId].includes(n.schoolYearId));
        if (transitionNoteToken(current) !== transitionNoteToken(guard.expected)) {
          throw new Error("Private notes changed during transition");
        }
      }
      if (plan.notes?.length && !this.notes) throw new Error("Private note store unavailable");
      const publishNotes = this.notes?.stageInsertedNotes(plan.notes ?? []);
      let nextId = Math.max(0, ...nextItems.map((item) => item.id)) + 1;
      for (const insert of plan.items) {
        const annualCourseId = insert.annualCourseId.trim();
        const referenceItemId = insert.referenceItemId?.trim() ?? "";
        if (
          referenceItemId &&
          nextItems.some(
            (item) => item.annualCourseId === annualCourseId && item.referenceItemId === referenceItemId,
          )
        ) {
          throw new Error(
            "UNIQUE constraint failed: agenda_items.annual_course_id, agenda_items.reference_item_id",
          );
        }
        nextItems.push({
          id: nextId,
          classroomId: insert.classroomId,
          subjectId: insert.subjectId,
          authorTeacherId: insert.authorTeacherId ?? "",
          day: insert.day,
          hour: insert.hour,
          weekOffset: insert.weekOffset,
          schoolWeekNumber: insert.schoolWeekNumber,
          type: insert.type,
          title: insert.title,
          detail: insert.detail,
          templateId: insert.templateId,
          schoolYearId: insert.schoolYearId,
          annualCourseId: insert.annualCourseId,
          courseSessionKey: insert.courseSessionKey,
          courseSessionDate: insert.courseSessionDate,
          referenceSessionId: insert.referenceSessionId,
          referenceItemId: insert.referenceItemId,
          studentVisible: false,
          sourceTransitionId: insert.sourceTransitionId,
          sourceAgendaItemId: insert.sourceAgendaItemId,
        });
        nextId += 1;
      }

      this.applies.set(plan.apply.transitionId, cloneApply(plan.apply));
      this.entries.set(
        plan.apply.transitionId,
        [...plan.entries]
          .map(cloneEntry)
          .sort((left, right) => left.sourceAgendaItemId - right.sourceAgendaItemId),
      );
      this.agenda.installExactItemsCopyOnWrite(nextItems);
      publishNotes?.();
    } catch (error) {
      this.applies.clear();
      for (const [id, row] of appliesSnapshot) this.applies.set(id, row);
      this.entries.clear();
      for (const [id, list] of entriesSnapshot) this.entries.set(id, list);
      this.agenda.installExactItemsCopyOnWrite(itemsSnapshot);
      throw error;
    }
  }

  exportBackupTables(): {
    year_transition_applies: Array<Record<string, unknown>>;
    year_transition_apply_entries: Array<Record<string, unknown>>;
  } {
    const applies = [...this.applies.values()]
      .sort((left, right) => left.appliedAt.localeCompare(right.appliedAt) || left.transitionId.localeCompare(right.transitionId))
      .map((row) => ({
        transition_id: row.transitionId,
        fingerprint: row.fingerprint,
        engine_version: row.engineVersion,
        app_version: row.appVersion,
        applied_at: row.appliedAt,
      }));
    const entries = [...this.applies.keys()]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((id) =>
        (this.entries.get(id) ?? []).map((entry) => ({
          transition_id: entry.transitionId,
          source_agenda_item_id: entry.sourceAgendaItemId,
          preview_reason: entry.previewReason,
          apply_result: entry.applyResult,
          target_annual_course_id: entry.targetAnnualCourseId,
          reference_item_id: entry.referenceItemId,
          created_at: entry.createdAt,
        })),
      );
    return { year_transition_applies: applies, year_transition_apply_entries: entries };
  }

  importBackupTables(tables: {
    year_transition_applies?: Array<Record<string, unknown>>;
    year_transition_apply_entries?: Array<Record<string, unknown>>;
  }): void {
    this.applies.clear();
    this.entries.clear();
    for (const row of tables.year_transition_applies ?? []) {
      const apply: PersistedYearTransitionApply = {
        transitionId: String(row.transition_id ?? ""),
        fingerprint: String(row.fingerprint ?? ""),
        engineVersion: Number(row.engine_version),
        appVersion: String(row.app_version ?? ""),
        appliedAt: String(row.applied_at ?? ""),
      };
      this.applies.set(apply.transitionId, apply);
      this.entries.set(apply.transitionId, []);
    }
    for (const row of tables.year_transition_apply_entries ?? []) {
      const transitionId = String(row.transition_id ?? "");
      const list = this.entries.get(transitionId) ?? [];
      list.push({
        transitionId,
        sourceAgendaItemId: Number(row.source_agenda_item_id),
        previewReason: String(row.preview_reason ?? ""),
        applyResult: String(row.apply_result ?? "") as PersistedYearTransitionApplyEntry["applyResult"],
        targetAnnualCourseId:
          row.target_annual_course_id === undefined || row.target_annual_course_id === null
            ? null
            : String(row.target_annual_course_id),
        referenceItemId:
          row.reference_item_id === undefined || row.reference_item_id === null
            ? null
            : String(row.reference_item_id),
        createdAt: String(row.created_at ?? ""),
      });
      this.entries.set(transitionId, list);
    }
  }
}

let memoryYearTransitionApplyStore: MemoryYearTransitionApplyStore | null = null;

export function getMemoryYearTransitionApplyStore(): MemoryYearTransitionApplyStore {
  memoryYearTransitionApplyStore ??= new MemoryYearTransitionApplyStore(getMemoryAgendaStore(), getMemoryAnnualCourseNotesStore());
  return memoryYearTransitionApplyStore;
}

export function resetMemoryYearTransitionApplyStore(): void {
  memoryYearTransitionApplyStore = null;
}

export function exportMemoryYearTransitionApplyTables(): ReturnType<
  MemoryYearTransitionApplyStore["exportBackupTables"]
> {
  return getMemoryYearTransitionApplyStore().exportBackupTables();
}

export function replaceMemoryYearTransitionApplyTables(tables: {
  year_transition_applies?: Array<Record<string, unknown>>;
  year_transition_apply_entries?: Array<Record<string, unknown>>;
}): void {
  getMemoryYearTransitionApplyStore().importBackupTables(tables);
}
