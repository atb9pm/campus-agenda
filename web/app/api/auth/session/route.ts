import {
  getRequestSession,
  getTeacherAccountsStore,
  jsonResponse,
  logoutResponse,
} from "../../../../lib/server/api.ts";
import { listRuntimeClassrooms } from "@campus/lib/persistence/store-factory.ts";
import { getAgendaStore } from "@campus/lib/persistence/store-factory.ts";

export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (!session) {
    return jsonResponse({ ok: true, session: null });
  }

  if (session.kind === "teacher") {
    const accounts = await getTeacherAccountsStore();
    const account = await accounts.findAccount(session.teacherId);
    const store = await getAgendaStore();
    const isAdmin = await store.teacherIsAdmin(session.teacherId);
    return jsonResponse({
      ok: true,
      session: {
        kind: "teacher",
        teacherId: session.teacherId,
        displayName: account?.displayName ?? "Enseignant",
        initials: account?.initials ?? "??",
        isAdmin,
        mustChangePassword: Boolean(account?.mustChangePassword),
      },
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
