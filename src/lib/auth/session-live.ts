import type { AppSession } from "../persistence/types.ts";
import type { TeacherAccountRecord } from "../../features/teacher-accounts/types.ts";

export interface LiveSessionLookup {
  findAccount(teacherId: string): Promise<TeacherAccountRecord | null>;
  findStudentAccessById(
    accessId: string,
  ): Promise<{ id: string; classroomId: string; label: string } | undefined>;
}

/**
 * Une signature HMAC valide ne suffit pas : le compte ou l'accès doit encore
 * exister et être utilisable au moment de la requête.
 */
export async function revalidateLiveSession(
  session: AppSession,
  lookup: LiveSessionLookup,
): Promise<AppSession | null> {
  try {
    if (session.kind === "teacher") {
      const account = await lookup.findAccount(session.teacherId);
      if (!account || !account.isActive || account.isArchived) return null;
      return session;
    }
    const access = await lookup.findStudentAccessById(session.accessId);
    if (!access || access.classroomId !== session.classroomId) return null;
    return session;
  } catch {
    return null;
  }
}
