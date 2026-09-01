import { jsonResponse, requireTeacherSession } from "../../../../lib/server/api.ts";
import { listRuntimeClassrooms } from "@campus/lib/persistence/store-factory.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireTeacherSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const classrooms = await listRuntimeClassrooms();
  const accessible = [];
  for (const classroom of classrooms) {
    if (await auth.store!.teacherCanAccessClassroom(auth.session!.teacherId, classroom.id)) {
      accessible.push(classroom);
    }
  }
  return jsonResponse({ ok: true, classrooms: accessible });
}

export const GET = withApiObservability("/api/teacher/classrooms", handleGet);
