import type { CourseScheduleSlot } from "../../features/course-schedule/types.ts";
import type { CourseScheduleStore } from "./course-schedule-types.ts";

export class MemoryCourseScheduleStore implements CourseScheduleStore {
  private readonly slots = new Map<string, CourseScheduleSlot>();

  async listSlots(): Promise<CourseScheduleSlot[]> {
    return [...this.slots.values()]
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listSlotsByAnnualCourse(annualCourseId: string): Promise<CourseScheduleSlot[]> {
    return (await this.listSlots()).filter((entry) => entry.annualCourseId === annualCourseId);
  }

  async getSlot(id: string): Promise<CourseScheduleSlot | null> {
    const slot = this.slots.get(id);
    return slot ? { ...slot } : null;
  }

  async createSlot(slot: CourseScheduleSlot): Promise<CourseScheduleSlot> {
    this.slots.set(slot.id, { ...slot });
    return { ...slot };
  }

  async updateSlot(slot: CourseScheduleSlot): Promise<CourseScheduleSlot> {
    this.slots.set(slot.id, { ...slot });
    return { ...slot };
  }

  async deleteSlot(id: string): Promise<boolean> {
    return this.slots.delete(id);
  }
}

let memoryCourseScheduleStore: MemoryCourseScheduleStore | null = null;

export function getMemoryCourseScheduleStore(): MemoryCourseScheduleStore {
  memoryCourseScheduleStore ??= new MemoryCourseScheduleStore();
  return memoryCourseScheduleStore;
}

export function resetMemoryCourseScheduleStore(): void {
  memoryCourseScheduleStore = null;
}
