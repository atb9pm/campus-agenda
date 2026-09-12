import {
  getRequestSession,
  jsonResponse,
  logoutResponse,
} from "../../../../lib/server/api.ts";
import { buildTeacherClientSession } from "../../../../lib/server/teacher-session.ts";
import { listRuntimeClassrooms } from "@campus/lib/persistence/store-factory.ts";

export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    return jsonResponse({ ok: true, session: null });
  }

  if (session.kind === "teacher") {
    return jsonResponse({
      ok: true,
      session: await buildTeacherClientSession(session.teacherId, session),
    });
  }

  const classrooms = await listRuntimeClassrooms();
  const classroom = classrooms.find((entry) => entry.id === session.classroomId);
  return jsonResponse({
    ok: true,
    session: {
      kind: "student",
      accessId: session.accessId,
      label: session.label,
      classroomId: session.classroomId,
      classroomName: classroom?.name ?? "Classe",
    },
  });
}

export async function DELETE() {
  return logoutResponse();
}
