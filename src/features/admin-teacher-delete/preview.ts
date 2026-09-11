import {
  LAST_ADMIN_DELETE_REASON,
  TEACHER_DELETE_IRREVERSIBLE,
  TEACHER_DELETE_WILL_KEEP,
  TEACHER_DELETE_WILL_REMOVE,
  type TeacherDeletePlan,
  type TeacherDeletePreview,
} from "./types.ts";

export function previewFromTeacherPlan(plan: TeacherDeletePlan): TeacherDeletePreview {
  const { counts } = plan;
  return {
    ok: true,
    target: plan.target,
    confirmationText: plan.confirmationText,
    lastAdminBlocked: plan.lastAdminBlocked,
    lastAdminReason: plan.lastAdminBlocked ? LAST_ADMIN_DELETE_REASON : undefined,
    warning: TEACHER_DELETE_WILL_KEEP,
    irreversible: TEACHER_DELETE_IRREVERSIBLE,
    willRemove: [...TEACHER_DELETE_WILL_REMOVE],
    willKeep: TEACHER_DELETE_WILL_KEEP,
    counts,
    lines: [
      `Affectations : ${counts.assignments}`,
      `Classes concernées : ${counts.classes}`,
      `Publications conservées : ${counts.publications}`,
    ],
  };
}
