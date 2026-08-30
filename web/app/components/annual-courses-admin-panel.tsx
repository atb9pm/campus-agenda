"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ASSIGNMENT_ROLE_LABELS, type AnnualCourse, type AssignmentRole, type TeacherCourseAssignment } from "@campus/features/annual-courses/types.ts";
import { isAssignmentActiveAt, preferredTeachersForBranch } from "@campus/features/annual-courses/assignments.ts";
import type { PedagogicalContextRecord, SchoolProfessionRecord } from "@campus/features/school-catalog";
import type { SchoolBranchRecord, SchoolClassRecord } from "@campus/features/school-catalog";
import {
  BRANCH_TEACHING_TYPE_LABELS,
  TEACHING_TYPE_LABELS,
  type TeachingType,
} from "@campus/features/teaching-types/index.ts";

interface TeacherSummary {
  id: string;
  displayName: string;
  initials: string;
  isActive: boolean;
  isArchived: boolean;
  teachingType: TeachingType | null;
}

interface OverviewPayload {
  ok: boolean;
  reason?: string;
  courses: AnnualCourse[];
  assignments: TeacherCourseAssignment[];
  classes: SchoolClassRecord[];
  branches: SchoolBranchRecord[];
  professions: SchoolProfessionRecord[];
  contexts: PedagogicalContextRecord[];
  teachers: TeacherSummary[];
}

type ViewMode = "class" | "teacher";
type ConflictChoice = "CO_TEACHER" | "REPLACE" | "TEMPORARY" | "CANCEL";

interface PendingAssign {
  schoolClass: SchoolClassRecord;
  context: PedagogicalContextRecord;
  branch: SchoolBranchRecord;
  existing: TeacherCourseAssignment[];
  teacherId: string;
}

interface AnnualCoursesAdminPanelProps {
  onNotice: (message: string) => void;
}

function teacherLabel(teachers: TeacherSummary[], id: string): string {
  const teacher = teachers.find((entry) => entry.id === id);
  return teacher ? teacher.displayName : id;
}

function roleLabel(role: AssignmentRole): string {
  return ASSIGNMENT_ROLE_LABELS[role];
}

function typeBadge(type: TeachingType | null, kind: "teacher" | "branch"): string {
  if (!type) return "Non configuré";
  return kind === "teacher" ? TEACHING_TYPE_LABELS[type] : BRANCH_TEACHING_TYPE_LABELS[type];
}

export function AnnualCoursesAdminPanel({ onNotice }: AnnualCoursesAdminPanelProps) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("class");
  const [includeMismatched, setIncludeMismatched] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [pending, setPending] = useState<PendingAssign | null>(null);
  const [conflictChoice, setConflictChoice] = useState<ConflictChoice>("CANCEL");
  const [forceStep, setForceStep] = useState<"none" | "warn" | "confirm">("none");
  const [overrideReason, setOverrideReason] = useState("");
  const [tempFrom, setTempFrom] = useState("");
  const [tempTo, setTempTo] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/annual-courses", { credentials: "include" });
    const payload = (await response.json()) as OverviewPayload;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.reason ?? "Chargement des cours annuels impossible.");
    }
    setData(payload);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const structuredClasses = useMemo(() => {
    if (!data) return [];
    return data.classes.filter(
      (entry) => entry.schoolYearId && entry.professionId && entry.trainingYear !== null,
    );
  }, [data]);

  const currentClass = structuredClasses.find((entry) => entry.id === selectedClassId) ?? structuredClasses[0] ?? null;

  const classContexts = useMemo(() => {
    if (!data || !currentClass) return [];
    return data.contexts.filter(
      (entry) =>
        entry.professionId === currentClass.professionId &&
        entry.trainingYear === currentClass.trainingYear &&
        !entry.isArchived,
    );
  }, [data, currentClass]);

  async function postAction(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/annual-courses", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      ok: boolean;
      reason?: string;
      code?: string;
    };
    if (!response.ok || !payload.ok) {
      throw Object.assign(new Error(payload.reason ?? "Action impossible."), { code: payload.code, status: response.status });
    }
    return payload;
  }

  async function ensureCourse(schoolClass: SchoolClassRecord, contextId: string) {
    const existing = data?.courses.find(
      (course) =>
        course.schoolYearId === schoolClass.schoolYearId &&
        course.classId === schoolClass.id &&
        course.contextId === contextId,
    );
    if (existing) return existing;
    await postAction({
      action: "create",
      ensure: true,
      schoolYearId: schoolClass.schoolYearId,
      classId: schoolClass.id,
      contextId,
    });
    await refresh();
    const latest = await fetch("/api/admin/annual-courses", { credentials: "include" }).then((res) => res.json()) as OverviewPayload;
    return latest.courses.find(
      (course) =>
        course.schoolYearId === schoolClass.schoolYearId &&
        course.classId === schoolClass.id &&
        course.contextId === contextId,
    ) ?? null;
  }

  function startAssign(
    schoolClass: SchoolClassRecord,
    context: PedagogicalContextRecord,
    branch: SchoolBranchRecord,
    teacherId: string,
  ) {
    if (!data) return;
    const course = data.courses.find(
      (entry) =>
        entry.schoolYearId === schoolClass.schoolYearId &&
        entry.classId === schoolClass.id &&
        entry.contextId === context.id,
    );
    const existing = course
      ? data.assignments.filter((entry) => entry.annualCourseId === course.id && isAssignmentActiveAt(entry))
      : [];
    const teacher = data.teachers.find((entry) => entry.id === teacherId);
    const mismatch =
      branch.teachingType &&
      teacher?.teachingType &&
      branch.teachingType !== teacher.teachingType;
    const draft = { schoolClass, context, branch, existing, teacherId };
    setConflictChoice(existing.length > 0 ? "CANCEL" : "CO_TEACHER");
    setForceStep(mismatch ? "warn" : "none");
    setOverrideReason("");
    setTempFrom("");
    setTempTo("");
    setEffectiveAt(new Date().toISOString().slice(0, 10));
    if (existing.length === 0 && !mismatch) {
      void completeAssign(draft, "PRIMARY", false);
      return;
    }
    setPending(draft);
  }

  async function completeAssign(
    target: PendingAssign,
    role: AssignmentRole,
    forceIncompatible: boolean,
    extra: { validFrom?: string; validTo?: string; outgoingTeacherId?: string; action?: string } = {},
  ) {
    setError("");
    try {
      const course = await ensureCourse(target.schoolClass, target.context.id);
      if (!course) throw new Error("Cours annuel introuvable.");
      const action = extra.action ?? (role === "REPLACEMENT" && extra.validTo ? "temporary" : extra.outgoingTeacherId ? "replace" : "assign");
      await postAction({
        action,
        annualCourseId: course.id,
        teacherId: target.teacherId,
        incomingTeacherId: target.teacherId,
        outgoingTeacherId: extra.outgoingTeacherId,
        role,
        validFrom: extra.validFrom,
        validTo: extra.validTo,
        effectiveAt: extra.validFrom,
        forceIncompatible,
        overrideReason: forceIncompatible ? overrideReason || "Forçage administrateur" : null,
      });
      onNotice("Attribution enregistrée. Les données du cours restent intactes.");
      setPending(null);
      setForceStep("none");
      await refresh();
    } catch (assignError) {
      const message = assignError instanceof Error ? assignError.message : "Attribution impossible.";
      if (message.includes("technique") || message.includes("générale")) {
        setForceStep("warn");
        setError(message);
        return;
      }
      setError(message);
    }
  }

  async function submitConflict(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    if (conflictChoice === "CANCEL") {
      setPending(null);
      return;
    }
    const force = forceStep === "confirm";
    if (forceStep === "warn") {
      setError("Confirmez le forçage : cette attribution est incompatible.");
      return;
    }
    const primary = pending.existing.find((entry) => entry.role === "PRIMARY") ?? pending.existing[0];
    if (conflictChoice === "CO_TEACHER") {
      await completeAssign(pending, "CO_TEACHER", force);
      return;
    }
    if (conflictChoice === "REPLACE" && primary) {
      await completeAssign(pending, "PRIMARY", force, {
        action: "replace",
        outgoingTeacherId: primary.teacherId,
        validFrom: effectiveAt,
      });
      return;
    }
    if (conflictChoice === "TEMPORARY") {
      if (!tempFrom || !tempTo) {
        setError("Indiquez le début et la fin du remplacement temporaire.");
        return;
      }
      await completeAssign(pending, "REPLACEMENT", force, {
        action: "temporary",
        validFrom: tempFrom,
        validTo: tempTo,
      });
    }
  }

  if (loading) return <p className="admin-loading">Chargement des cours annuels…</p>;
  if (!data) return <p className="admin-error">{error || "Données indisponibles."}</p>;

  const profession = currentClass
    ? data.professions.find((entry) => entry.id === currentClass.professionId)
    : null;

  return (
    <div className="admin-panel-block annual-courses-admin">
      <header className="config-section-header">
        <div>
          <h3>Cours annuels et attributions</h3>
          <p>
            Le cours (année + classe + CTX) porte les données. Les enseignants reçoivent un droit,
            jamais la propriété. Seul l’administrateur attribue.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-teacher-toolbar">
        <button type="button" className={view === "class" ? "is-selected" : undefined} onClick={() => setView("class")}>
          Vue par classe
        </button>
        <button type="button" className={view === "teacher" ? "is-selected" : undefined} onClick={() => setView("teacher")}>
          Vue par enseignant
        </button>
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={includeMismatched}
            onChange={(event) => setIncludeMismatched(event.target.checked)}
          />
          <span>Afficher les enseignants non correspondants</span>
        </label>
      </div>

      {view === "class" ? (
        <>
          <label className="annual-course-class-select">
            Classe
            <select
              value={currentClass?.id ?? ""}
              onChange={(event) => setSelectedClassId(event.target.value)}
            >
              {structuredClasses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} — {entry.schoolYearLabel ?? entry.schoolYearId}
                </option>
              ))}
            </select>
          </label>

          {currentClass ? (
            <p className="admin-teacher-login-meta">
              {currentClass.label} — {profession?.label ?? "Profession"} —{" "}
              {currentClass.trainingYear}
              {currentClass.trainingYear === 1 ? "re" : "e"} année — {currentClass.schoolYearLabel}
            </p>
          ) : (
            <p className="admin-loading">
              Aucune classe structurée (année scolaire + profession + année de formation).
            </p>
          )}

          {currentClass ? (
            <table className="annual-course-table">
              <thead>
                <tr>
                  <th>Branche</th>
                  <th>Enseignant(s)</th>
                  <th>Attribuer</th>
                </tr>
              </thead>
              <tbody>
                {classContexts.map((context) => {
                  const branch = data.branches.find((entry) => entry.id === context.branchId);
                  if (!branch) return null;
                  const course = data.courses.find(
                    (entry) =>
                      entry.classId === currentClass.id &&
                      entry.contextId === context.id &&
                      entry.schoolYearId === currentClass.schoolYearId,
                  );
                  const assigned = course
                    ? data.assignments.filter((entry) => entry.annualCourseId === course.id && isAssignmentActiveAt(entry))
                    : [];
                  const candidates = preferredTeachersForBranch(
                    data.teachers.filter((entry) => entry.isActive && !entry.isArchived && entry.teachingType),
                    branch.teachingType,
                    includeMismatched,
                  );
                  const hasReplacement = assigned.some((entry) => entry.role === "REPLACEMENT");
                  const hasOverride = assigned.some((entry) => entry.overrideReason);
                  const status =
                    assigned.length === 0
                      ? "none"
                      : hasOverride
                        ? "override"
                        : hasReplacement
                          ? "replacement"
                          : assigned.length > 1
                            ? "multi"
                            : "ok";
                  return (
                    <tr key={context.id} className={`annual-course-row is-${status}`}>
                      <td>
                        <strong>{branch.label}</strong>
                        <div className="admin-teacher-login-meta">{typeBadge(branch.teachingType, "branch")}</div>
                      </td>
                      <td>
                        {assigned.length === 0 ? (
                          <span className="badge-status is-off">Aucun professeur</span>
                        ) : (
                          <ul className="annual-course-teachers">
                            {assigned.map((entry) => {
                              const teacher = data.teachers.find((item) => item.id === entry.teacherId);
                              return (
                                <li key={entry.id}>
                                  {teacherLabel(data.teachers, entry.teacherId)} — {roleLabel(entry.role)}
                                  {teacher && !teacher.teachingType ? " · Non configuré" : ""}
                                  {entry.overrideReason ? " · Type forcé" : ""}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                      <td>
                        <select
                          defaultValue=""
                          onChange={(event) => {
                            const teacherId = event.target.value;
                            event.target.value = "";
                            if (teacherId) startAssign(currentClass, context, branch, teacherId);
                          }}
                        >
                          <option value="">Choisir…</option>
                          {candidates.map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.displayName} ({typeBadge(teacher.teachingType, "teacher")})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </>
      ) : (
        <ul className="admin-teacher-access-list">
          {data.teachers.map((teacher) => {
            const rows = data.assignments.filter((entry) => entry.teacherId === teacher.id);
            return (
              <li key={teacher.id} className={teacher.isArchived ? "admin-teacher-card is-archived" : "admin-teacher-card"}>
                <div>
                  <p className="admin-teacher-name">{teacher.displayName}</p>
                  <p className="admin-teacher-login-meta">
                    {typeBadge(teacher.teachingType, "teacher")}
                    {teacher.isArchived ? " · Archivé" : teacher.isActive ? "" : " · Désactivé"}
                  </p>
                  {rows.length === 0 ? (
                    <p className="admin-loading">Aucune attribution.</p>
                  ) : (
                    <ul className="annual-course-teachers">
                      {rows.map((entry) => {
                        const course = data.courses.find((item) => item.id === entry.annualCourseId);
                        const schoolClass = data.classes.find((item) => item.id === course?.classId);
                        const context = data.contexts.find((item) => item.id === course?.contextId);
                        const branch = data.branches.find((item) => item.id === context?.branchId);
                        return (
                          <li key={entry.id}>
                            {schoolClass?.label ?? "Classe"} → {branch?.label ?? "Branche"} → {roleLabel(entry.role)}
                            {isAssignmentActiveAt(entry) ? "" : " (terminée)"}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pending ? (
        <form className="annual-course-dialog" onSubmit={(event) => void submitConflict(event)}>
          <h4>
            {pending.existing.length > 0
              ? `Cette branche est déjà attribuée à ${teacherLabel(data.teachers, pending.existing[0]!.teacherId)}.`
              : "Confirmer l’attribution"}
          </h4>
          {forceStep !== "none" ? (
            <p className="admin-error" role="alert">
              Cette branche est {pending.branch.teachingType === "TECHNICAL" ? "technique" : "générale"} mais
              l’enseignant sélectionné est enregistré comme{" "}
              {TEACHING_TYPE_LABELS[(data.teachers.find((entry) => entry.id === pending.teacherId)?.teachingType ?? "GENERAL") as TeachingType]}.
            </p>
          ) : null}

          {pending.existing.length > 0 ? (
            <fieldset>
              <legend>Choix</legend>
              <label>
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictChoice === "CO_TEACHER"}
                  onChange={() => setConflictChoice("CO_TEACHER")}
                />
                Ajouter comme coenseignant
              </label>
              <label>
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictChoice === "REPLACE"}
                  onChange={() => setConflictChoice("REPLACE")}
                />
                Remplacer définitivement
              </label>
              {conflictChoice === "REPLACE" ? (
                <label>
                  À partir du
                  <input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required />
                </label>
              ) : null}
              <label>
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictChoice === "TEMPORARY"}
                  onChange={() => setConflictChoice("TEMPORARY")}
                />
                Ajouter comme remplaçant temporaire
              </label>
              {conflictChoice === "TEMPORARY" ? (
                <div className="annual-course-dates">
                  <label>
                    Du
                    <input type="date" value={tempFrom} onChange={(event) => setTempFrom(event.target.value)} required />
                  </label>
                  <label>
                    Au
                    <input type="date" value={tempTo} onChange={(event) => setTempTo(event.target.value)} required />
                  </label>
                </div>
              ) : null}
              <label>
                <input
                  type="radio"
                  name="conflict"
                  checked={conflictChoice === "CANCEL"}
                  onChange={() => setConflictChoice("CANCEL")}
                />
                Annuler
              </label>
            </fieldset>
          ) : null}

          {forceStep === "warn" ? (
            <button type="button" onClick={() => setForceStep("confirm")}>
              Forcer l’attribution
            </button>
          ) : null}
          {forceStep === "confirm" ? (
            <label>
              Raison du forçage
              <input
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Raison administrative"
                required
              />
            </label>
          ) : null}

          <div className="admin-teacher-edit-actions">
            <button
              type="submit"
              disabled={forceStep === "warn" || (conflictChoice === "CANCEL" && pending.existing.length > 0)}
            >
              {forceStep === "confirm" ? "Confirmer le forçage" : "Valider"}
            </button>
            <button type="button" onClick={() => { setPending(null); setForceStep("none"); }}>
              Fermer
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
