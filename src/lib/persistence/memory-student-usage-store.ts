import type { StudentUsageDayCount, StudentUsageIncrement, StudentUsageStore } from "../../features/student-usage/index.ts";

function rowKey(input: Pick<StudentUsageIncrement, "date" | "schoolYearId" | "schoolClassId">): string {
  return `${input.date}\n${input.schoolYearId}\n${input.schoolClassId}`;
}

/** Compteurs en mémoire (tests, CAMPUS_STORE=memory). L'incrément est synchrone : pas de perte entre deux lectures. */
export class MemoryStudentUsageStore implements StudentUsageStore {
  private readonly rows = new Map<string, StudentUsageDayCount>();

  async increment(input: StudentUsageIncrement): Promise<void> {
    const key = rowKey(input);
    const existing = this.rows.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.rows.set(key, { ...input, count: 1 });
  }

  async listBetween(startDate: string, endDate: string): Promise<StudentUsageDayCount[]> {
    return [...this.rows.values()]
      .filter((row) => row.date >= startDate && row.date <= endDate)
      .map((row) => ({ ...row }));
  }

  async purgeBefore(cutoffDate: string): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.date < cutoffDate) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

let memoryStore: MemoryStudentUsageStore | null = null;

export function getMemoryStudentUsageStore(): MemoryStudentUsageStore {
  memoryStore ??= new MemoryStudentUsageStore();
  return memoryStore;
}

export function resetMemoryStudentUsageStore(): void {
  memoryStore = null;
}
