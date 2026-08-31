import type { ClassAttendanceDay, CourseScheduleSlot } from "../../features/course-schedule/types.ts";

export interface CourseScheduleStore {
  listSlots(): Promise<CourseScheduleSlot[]>;
  listSlotsByAnnualCourse(annualCourseId: string): Promise<CourseScheduleSlot[]>;
  getSlot(id: string): Promise<CourseScheduleSlot | null>;
  createSlot(slot: CourseScheduleSlot): Promise<CourseScheduleSlot>;
  updateSlot(slot: CourseScheduleSlot): Promise<CourseScheduleSlot>;
  deleteSlot(id: string): Promise<boolean>;

  listAttendanceDays(): Promise<ClassAttendanceDay[]>;
  listAttendanceDaysByClass(classId: string): Promise<ClassAttendanceDay[]>;
  replaceAttendanceDaysForClass(classId: string, days: ClassAttendanceDay[]): Promise<ClassAttendanceDay[]>;
}
