import {
  getRequestSession,
  jsonResponse,
  logoutResponse,
} from "../../../../lib/server/api.ts";
import { getAgendaStore } from "@campus/lib/persistence/store-factory.ts";
import { getTeacherById } from "@campus/features/classes/queries.ts";
import { DEMO_CATALOG } from "@campus/features/classes/demo-data.ts";
import { getClassroomById } from "@campus/features/classes/queries.ts";

export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    return jsonResponse({ ok: true, session: null });
  }

  if (session.kind === "teacher") {
    const teacher = getTeacherById(DEMO_CATALOG, session.teacherId);
    const store = await getAgendaStore();
    const isAdmin = await store.teacherIsAdmin(session.teacherId);
    return jsonResponse({
      ok: true,
      session: {
        kind: "teacher",
        teacherId: session.teacherId,
        displayName: teacher?.displayName ?? "Enseignant · démo",
        initials: teacher?.initials ?? "??",
        isAdmin,
      },
    });
  }

  const classroom = getClassroomById(DEMO_CATALOG, session.classroomId);
  return jsonResponse({
    ok: true,
    session: {
      kind: "student",
      label: session.label,
      classroomId: session.classroomId,
      classroomName: classroom?.name ?? "Classe",
    },
  });
}

export async function DELETE() {
  return logoutResponse();
}
