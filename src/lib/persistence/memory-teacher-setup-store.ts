import { normalizeTeacherSetup } from "../../features/teacher-setup/queries.ts";
import type { TeacherSetupConfig } from "../../features/teacher-setup/types.ts";
import type { TeacherSetupStore } from "./teacher-setup-types.ts";

export class MemoryTeacherSetupStore implements TeacherSetupStore {
  private readonly setups = new Map<string, TeacherSetupConfig>();

  async getSetup(teacherId: string): Promise<TeacherSetupConfig | null> {
    const stored = this.setups.get(teacherId);
    return stored ? structuredClone(stored) : null;
  }

  async saveSetup(teacherId: string, config: TeacherSetupConfig): Promise<TeacherSetupConfig> {
    const normalized = normalizeTeacherSetup(config);
    this.setups.set(teacherId, structuredClone(normalized));
    return structuredClone(normalized);
  }
}

let memoryTeacherSetupStore: MemoryTeacherSetupStore | null = null;

export function getMemoryTeacherSetupStore(): MemoryTeacherSetupStore {
  memoryTeacherSetupStore ??= new MemoryTeacherSetupStore();
  return memoryTeacherSetupStore;
}

export function resetMemoryTeacherSetupStore(): void {
  memoryTeacherSetupStore = null;
}
