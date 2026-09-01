import type { ClassAttendanceDay, CourseScheduleSlot } from "../../features/course-schedule/types.ts";
import type { CourseScheduleStore } from "./course-schedule-types.ts";

export class MemoryCourseScheduleStore implements CourseScheduleStore {
  private readonly slots = new Map<string, CourseScheduleSlot>();
  private attendanceDays = new Map<string, ClassAttendanceDay>();

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

  async listAttendanceDays(): Promise<ClassAttendanceDay[]> {
    return [...this.attendanceDays.values()]
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listAttendanceDaysByClass(classId: string): Promise<ClassAttendanceDay[]> {
    return (await this.listAttendanceDays()).filter((entry) => entry.classId === classId);
  }

  async replaceAttendanceDaysForClass(
    classId: string,
    days: ClassAttendanceDay[],
  ): Promise<ClassAttendanceDay[]> {
    const next = new Map(this.attendanceDays);
    for (const [id, day] of next) {
      if (day.classId === classId) next.delete(id);
    }
    for (const day of days) next.set(day.id, { ...day });
    this.attendanceDays = next;
    return this.listAttendanceDaysByClass(classId);
  }

  replaceSnapshot(slots: CourseScheduleSlot[], days: ClassAttendanceDay[]): void {
    this.slots.clear();
    for (const slot of slots) this.slots.set(slot.id, { ...slot });
    this.attendanceDays = new Map(days.map((day) => [day.id, { ...day }]));
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
