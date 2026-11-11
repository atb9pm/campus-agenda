/**
 * Mémoire locale du navigateur : éviter de recompter un simple rafraîchissement.
 * Ce n'est pas une identité. Le serveur ne s'y fie pas.
 */
export const STUDENT_VISIT_STORAGE_KEY = "campus-agenda:student-visit:v1";

/** Un onglet qui a déjà lancé l'envoi bloque un second onglet pendant ce délai. */
export const STUDENT_VISIT_PENDING_MS = 20_000;

export interface StudentVisitContext {
  date: string;
  schoolYearId: string;
  schoolClassId: string;
}

export interface StudentVisitRecord extends StudentVisitContext {
  state: "counted" | "pending";
  at: number;
}

export function sameVisitContext(record: StudentVisitContext, context: StudentVisitContext): boolean {
  return record.date === context.date
    && record.schoolYearId === context.schoolYearId
    && record.schoolClassId === context.schoolClassId;
}

export function parseStudentVisitRecord(raw: string | null | undefined): StudentVisitRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { date, schoolYearId, schoolClassId, state, at } = parsed as Partial<StudentVisitRecord>;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (typeof schoolYearId !== "string" || !schoolYearId || schoolYearId.length > 80) return null;
    if (typeof schoolClassId !== "string" || !schoolClassId || schoolClassId.length > 80) return null;
    if (state !== "counted" && state !== "pending") return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return { date, schoolYearId, schoolClassId, state, at };
  } catch {
    return null;
  }
}

/** `skip` : déjà compté, ou un envoi est en cours. `post` : demander au serveur. */
export function decideStudentVisit(
  record: StudentVisitRecord | null,
  context: StudentVisitContext,
  nowMs: number,
): "skip" | "post" {
  if (!record || !sameVisitContext(record, context)) return "post";
  if (record.state === "counted") return "skip";
  if (nowMs - record.at < STUDENT_VISIT_PENDING_MS) return "skip";
  return "post";
}

export function readStudentVisitRecord(storage: Pick<Storage, "getItem"> | null | undefined): StudentVisitRecord | null {
  if (!storage) return null;
  try {
    return parseStudentVisitRecord(storage.getItem(STUDENT_VISIT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStudentVisitRecord(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  record: StudentVisitRecord | null,
): void {
  if (!storage) return;
  try {
    if (!record) storage.removeItem(STUDENT_VISIT_STORAGE_KEY);
    else storage.setItem(STUDENT_VISIT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // navigation privée ou stockage plein : l'agenda continue, sans mémoriser
  }
}
