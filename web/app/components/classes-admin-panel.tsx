"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolBranchRecord,
  SchoolClassRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import {
  classCardClassName,
  classDisplayMeta,
  classDisplayProfessionLabel,
  classLifecycleLabel,
  classLifecycleStatus,
  countClassesByStatus,
  filterClassesByStatus,
  formatTrainingYearLabel,
  groupSchoolClasses,
  listPlannedBranchesForClass,
  listSelectableSchoolYearsForClassEdit,
  trainingYearsForDuration,
  type ClassGroupBy,
  type ClassStatusFilter,
} from "@campus/features/school-catalog";
import { ClassCreationWizard } from "./class-creation-wizard.tsx";
import type { SchoolYearSummary } from "../../lib/api-client.ts";
import type { StudentAccessMetadata } from "@campus/types/student-access";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { StudentAccessAdminBlock } from "./student-access-admin.tsx";

type ClassConfirmAction =
  | { kind: "regenerate"; entry: SchoolClassRecord }
  | { kind: "revoke"; entry: SchoolClassRecord }
  | { kind: "archive"; entry: SchoolClassRecord }
  | { kind: "delete"; entry: SchoolClassRecord };

function classConfirmCopy(action: ClassConfirmAction): {
  title: string;
  body: string;
  confirmLabel: string;
} {
  switch (action.kind) {
    case "regenerate":
      return {
        title: `Régénérer le code de ${action.entry.code} ?`,
        body: "L’ancien code et les sessions élèves actuellement ouvertes seront immédiatement invalidés.",
        confirmLabel: "Régénérer",
      };
    case "revoke":
      return {
        title: `Désactiver l’accès apprentis de ${action.entry.code} ?`,
        body: "Les élèves actuellement connectés seront déconnectés.",
        confirmLabel: "Désactiver",
      };
    case "archive":
      return {
        title: `Archiver la classe « ${action.entry.code} » ?`,
        body: "Elle sera conservée pour l’historique et retirée des listes opérationnelles.",
        confirmLabel: "Archiver",
      };
    case "delete":
      return {
        title: `Supprimer définitivement la classe « ${action.entry.code} » ?`,
        body: "Cette action est irréversible.",
        confirmLabel: "Supprimer",
      };
  }
}

interface ClassEditDraft {
  classId: string;
  schoolYearId: string;
  professionId: string;
  trainingYear: string;
  parallelCode: string;
}

interface ClassesAdminPanelProps {
  classes: SchoolClassRecord[];
  branches: SchoolBranchRecord[];
  professions: SchoolProfessionRecord[];
  contexts: PedagogicalContextRecord[];
  schoolYears: SchoolYearSummary[];
  error: string | null;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onClearError: () => void;
  onCreated: () => Promise<void>;
  onOpenPlans: () => void;
}

const GROUP_OPTIONS: Array<{ value: ClassGroupBy; label: string }> = [
  { value: "profession", label: "Profession" },
  { value: "schoolYear", label: "Année scolaire" },
  { value: "trainingYear", label: "Année de formation" },
  { value: "code", label: "Code de classe" },
];

export function ClassesAdminPanel({
  classes,
  branches,
  professions,
  contexts,
  schoolYears,
  error,
  onNotice,
  onError,
  onClearError,
  onCreated,
  onOpenPlans,
}: ClassesAdminPanelProps) {
  const [statusFilter, setStatusFilter] = useState<ClassStatusFilter>("active");
  const [groupBy, setGroupBy] = useState<ClassGroupBy>("profession");
  const [classDraft, setClassDraft] = useState<ClassEditDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const [accesses, setAccesses] = useState<Record<string, StudentAccessMetadata>>({});
  const [revealedCodeByClass, setRevealedCodeByClass] = useState<Record<string, string>>({});
  const [accessErrorByClass, setAccessErrorByClass] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<ClassConfirmAction | null>(null);
  const accessMutationLock = useRef(false);

  const counts = useMemo(() => countClassesByStatus(classes), [classes]);
  const visibleClasses = useMemo(
    () => filterClassesByStatus(classes, statusFilter),
    [classes, statusFilter],
  );
  const groups = useMemo(
    () => groupSchoolClasses({ classes: visibleClasses, professions, groupBy }),
    [visibleClasses, professions, groupBy],
  );

  const professionById = useMemo(() => {
    const map = new Map<string, SchoolProfessionRecord>();
    for (const profession of professions) map.set(profession.id, profession);
    return map;
  }, [professions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/student-access", { credentials: "include" });
        let payload: { ok?: boolean; accesses?: StudentAccessMetadata[] } = {};
        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          return;
        }
        if (cancelled || !response.ok || !payload.ok) return;
        const next: Record<string, StudentAccessMetadata> = {};
        for (const access of payload.accesses ?? []) {
          next[access.schoolClassId] = access;
        }
        setAccesses(next);
      } catch {
        // Le bandeau « Aucun accès » reste affiché ; la génération affichera l'erreur sur la carte.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classes]);

  const activeProfessions = useMemo(
    () => professions.filter((entry) => entry.isActive && !entry.isArchived),
    [professions],
  );

  async function generateStudentAccess(entry: SchoolClassRecord, isRegenerate: boolean) {
    if (accessMutationLock.current) return;
    if (isRegenerate) {
      setConfirmAction({ kind: "regenerate", entry });
      return;
    }
    await applyGenerateStudentAccess(entry, false);
  }

  async function applyGenerateStudentAccess(entry: SchoolClassRecord, isRegenerate: boolean) {
    if (accessMutationLock.current) return;
    accessMutationLock.current = true;
    onClearError();
    setAccessErrorByClass((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setPending(true);
    setPendingClassId(entry.id);
    try {
      const response = await fetch("/api/admin/student-access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolClassId: entry.id }),
      });
      let payload: {
        ok?: boolean;
        reason?: string;
        access?: StudentAccessMetadata;
        code?: string;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = { ok: false, reason: "Génération impossible. Réessayez." };
      }
      if (!response.ok || !payload.ok || !payload.access || !payload.code) {
        const message = payload.reason ?? "Génération impossible.";
        setAccessErrorByClass((current) => ({ ...current, [entry.id]: message }));
        onError(message);
        return;
      }
      setAccesses((current) => ({
        ...current,
        [entry.id]: {
          ...payload.access!,
          currentCode: payload.access!.currentCode ?? payload.code!,
        },
      }));
      setRevealedCodeByClass((current) => ({ ...current, [entry.id]: payload.code! }));
      onNotice(isRegenerate ? `Nouveau code apprentis pour ${entry.code}.` : `Code apprentis généré pour ${entry.code}.`);
    } catch {
      const message = "Génération impossible. Réessayez.";
      setAccessErrorByClass((current) => ({ ...current, [entry.id]: message }));
      onError(message);
    } finally {
      accessMutationLock.current = false;
      setPending(false);
      setPendingClassId(null);
    }
  }

  async function revokeStudentAccess(entry: SchoolClassRecord) {
    if (accessMutationLock.current) return;
    setConfirmAction({ kind: "revoke", entry });
  }

  async function applyRevokeStudentAccess(entry: SchoolClassRecord) {
    if (accessMutationLock.current) return;
    accessMutationLock.current = true;
    onClearError();
    setAccessErrorByClass((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setPending(true);
    setPendingClassId(entry.id);
    try {
      const response = await fetch(`/api/admin/student-access?schoolClassId=${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      let payload: {
        ok?: boolean;
        reason?: string;
        access?: StudentAccessMetadata;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = { ok: false, reason: "Désactivation impossible. Réessayez." };
      }
      if (!response.ok || !payload.ok || !payload.access) {
        const message = payload.reason ?? "Désactivation impossible.";
        setAccessErrorByClass((current) => ({ ...current, [entry.id]: message }));
        onError(message);
        return;
      }
      setAccesses((current) => ({ ...current, [entry.id]: payload.access! }));
      setRevealedCodeByClass((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
      onNotice(`Accès apprentis de ${entry.code} désactivé.`);
    } catch {
      const message = "Désactivation impossible. Réessayez.";
      setAccessErrorByClass((current) => ({ ...current, [entry.id]: message }));
      onError(message);
    } finally {
      accessMutationLock.current = false;
      setPending(false);
      setPendingClassId(null);
    }
  }

  async function patchClass(
    entry: SchoolClassRecord,
    patch: Record<string, unknown>,
  ): Promise<boolean> {
    onClearError();
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "class", ...patch }),
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      onError(payload.reason ?? "Mise à jour impossible.");
      return false;
    }
    await onCreated();
    return true;
  }

  async function saveClassDraft(event: FormEvent) {
    event.preventDefault();
    if (!classDraft) return;
    const pedagogyComplete = Boolean(
      classDraft.schoolYearId && classDraft.professionId && classDraft.trainingYear,
    );
    const pedagogyPartial = Boolean(
      classDraft.schoolYearId || classDraft.professionId || classDraft.trainingYear,
    );
    if (pedagogyPartial && !pedagogyComplete) {
      onError("Année scolaire, profession et année de formation doivent être enregistrées ensemble.");
      return;
    }
    const entry = classes.find((item) => item.id === classDraft.classId);
    if (!entry) return;
    const ok = await patchClass(entry, {
      ...(pedagogyComplete
        ? {
            schoolYearId: classDraft.schoolYearId,
            professionId: classDraft.professionId,
            trainingYear: Number.parseInt(classDraft.trainingYear, 10),
          }
        : {}),
      parallelCode: classDraft.parallelCode.trim() === "" ? null : classDraft.parallelCode,
    });
    if (!ok) return;
    onNotice(`Classe ${entry.code} mise à jour.`);
    setClassDraft(null);
  }

  function runConfirmedAction(action: ClassConfirmAction) {
    setConfirmAction(null);
    if (action.kind === "regenerate") {
      void applyGenerateStudentAccess(action.entry, true);
      return;
    }
    if (action.kind === "revoke") {
      void applyRevokeStudentAccess(action.entry);
      return;
    }
    if (action.kind === "archive") {
      void applyArchiveClass(action.entry);
      return;
    }
    void applyDeleteClass(action.entry);
  }

  async function archiveClass(entry: SchoolClassRecord) {
    setConfirmAction({ kind: "archive", entry });
  }

  async function applyArchiveClass(entry: SchoolClassRecord) {
    setPending(true);
    try {
      const ok = await patchClass(entry, { isArchived: true });
      if (ok) onNotice(`Classe « ${entry.code} » archivée.`);
    } finally {
      setPending(false);
    }
  }

  async function unarchiveClass(entry: SchoolClassRecord) {
    setPending(true);
    try {
      const ok = await patchClass(entry, { isArchived: false });
      if (ok) onNotice(`Classe « ${entry.code} » désarchivée (désactivée).`);
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(entry: SchoolClassRecord) {
    setPending(true);
    try {
      const ok = await patchClass(entry, { isActive: !entry.isActive });
      if (ok) {
        onNotice(
          entry.isActive
            ? `Classe « ${entry.code} » désactivée.`
            : `Classe « ${entry.code} » réactivée.`,
        );
      }
    } finally {
      setPending(false);
    }
  }

  async function deleteClass(entry: SchoolClassRecord) {
    setConfirmAction({ kind: "delete", entry });
  }

  async function applyDeleteClass(entry: SchoolClassRecord) {
    setPending(true);
    onClearError();
    try {
      const response = await fetch(`/api/admin/catalog/${entry.id}?kind=class`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = (await response.json()) as { ok: boolean; reason?: string };
      if (!response.ok || !payload.ok) {
        onError(payload.reason ?? "Suppression impossible.");
        return;
      }
      onNotice(`Classe « ${entry.code} » supprimée.`);
      await onCreated();
    } finally {
      setPending(false);
    }
  }

  const emptyLabel =
    statusFilter === "archived"
      ? "Aucune classe archivée."
      : statusFilter === "inactive"
        ? "Aucune classe désactivée."
        : "Aucune classe active.";
  const confirmCopy = confirmAction ? classConfirmCopy(confirmAction) : null;

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Classes</h3>
          <p>
            La création de classes est l’étape finale : elle exploite le référentiel déjà configuré.
            Les branches prévues viennent du plan de formation (CTX).
          </p>
        </div>
      </header>
      {error ? <p className="admin-error">{error}</p> : null}
      <ClassCreationWizard
        classes={classes}
        professions={professions}
        contexts={contexts}
        schoolYears={schoolYears}
        onNotice={onNotice}
        onCreated={onCreated}
        onError={onError}
        onOpenPlans={onOpenPlans}
      />

      <div className="admin-class-toolbar">
        <div className="admin-teacher-toolbar" role="tablist" aria-label="Filtrer les classes par état">
          <button
            type="button"
            className={statusFilter === "active" ? "is-selected" : undefined}
            aria-pressed={statusFilter === "active"}
            onClick={() => setStatusFilter("active")}
          >
            Actives ({counts.active})
          </button>
          <button
            type="button"
            className={statusFilter === "inactive" ? "is-selected" : undefined}
            aria-pressed={statusFilter === "inactive"}
            onClick={() => setStatusFilter("inactive")}
          >
            Désactivées ({counts.inactive})
          </button>
          <button
            type="button"
            className={statusFilter === "archived" ? "is-selected" : undefined}
            aria-pressed={statusFilter === "archived"}
            onClick={() => setStatusFilter("archived")}
          >
            Archivées ({counts.archived})
          </button>
        </div>
        <label className="admin-class-group-by">
          Regrouper par
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as ClassGroupBy)}
          >
            {GROUP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visibleClasses.length === 0 ? (
        <p className="admin-loading">{emptyLabel}</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="admin-class-group">
            {group.title ? <h4>{group.title}</h4> : null}
            <ul className="admin-teacher-access-list">
              {group.classes.map((entry) => {
                const status = classLifecycleStatus(entry);
                const linkedProfession = entry.professionId
                  ? professionById.get(entry.professionId) ?? null
                  : null;
                const editing = classDraft?.classId === entry.id;
                const draftProfession = editing
                  ? professionById.get(classDraft.professionId) ?? null
                  : linkedProfession;
                const yearOptions = draftProfession
                  ? trainingYearsForDuration(draftProfession.durationYears)
                  : [];
                const structured = Boolean(
                  entry.schoolYearId && entry.professionId && entry.trainingYear !== null,
                );
                const planned = structured
                  ? listPlannedBranchesForClass({ schoolClass: entry, branches, contexts })
                  : [];
                const selectableProfessions = activeProfessions.slice();
                if (
                  draftProfession &&
                  !selectableProfessions.some((profession) => profession.id === draftProfession.id)
                ) {
                  selectableProfessions.unshift(draftProfession);
                }
                return (
                  <li key={entry.id} className={classCardClassName(status)}>
                    <div className="admin-teacher-identity">
                      <strong className="admin-teacher-initials is-class-prefix">{entry.code}</strong>
                      {editing && classDraft ? (
                        <form
                          className="admin-teacher-edit-form"
                          onSubmit={(event) => void saveClassDraft(event)}
                        >
                          <label>
                            Année scolaire
                            <select
                              value={classDraft.schoolYearId}
                              onChange={(event) =>
                                setClassDraft({ ...classDraft, schoolYearId: event.target.value })
                              }
                            >
                              <option value="">Non renseignée (legacy)</option>
                              {listSelectableSchoolYearsForClassEdit(
                                schoolYears,
                                entry.schoolYearId,
                              ).map((year) => (
                                <option key={year.id} value={year.id}>
                                  {year.label}
                                  {year.status === "archived" ? " (archivée)" : ""}
                                  {year.status === "active" ? " (active)" : ""}
                                  {year.status === "draft" ? " (brouillon)" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Profession
                            <select
                              value={classDraft.professionId}
                              onChange={(event) =>
                                setClassDraft({
                                  ...classDraft,
                                  professionId: event.target.value,
                                  trainingYear: "",
                                })
                              }
                            >
                              <option value="">Profession à configurer</option>
                              {selectableProfessions.map((profession) => (
                                <option key={profession.id} value={profession.id}>
                                  {profession.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Année de formation
                            <select
                              value={classDraft.trainingYear}
                              onChange={(event) =>
                                setClassDraft({ ...classDraft, trainingYear: event.target.value })
                              }
                              disabled={!classDraft.professionId}
                            >
                              <option value="">Choisir…</option>
                              {yearOptions.map((year) => (
                                <option key={year} value={year}>
                                  {formatTrainingYearLabel(year)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Groupe parallèle
                            <select
                              value={classDraft.parallelCode}
                              onChange={(event) =>
                                setClassDraft({ ...classDraft, parallelCode: event.target.value })
                              }
                            >
                              <option value="">Aucun</option>
                              {["A", "B", "C", "D", "E", "F"].map((letter) => (
                                <option key={letter} value={letter}>
                                  {letter}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="admin-class-config-warn">
                            Modifier la profession ou le groupe ne renomme pas le code {entry.code}.
                          </p>
                          <div className="admin-teacher-edit-actions">
                            <button type="submit">Enregistrer</button>
                            <button type="button" onClick={() => setClassDraft(null)}>
                              Annuler
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div>
                          <p className="admin-teacher-name">
                            {classDisplayProfessionLabel(entry, linkedProfession)}
                          </p>
                          <p className="admin-teacher-login-meta">{classDisplayMeta(entry)}</p>
                          {structured ? (
                            planned.length > 0 ? (
                              <p className="admin-planned-branches">
                                <strong>Branches prévues</strong>
                                {" — "}
                                {planned.map((branch) => branch.label).join(", ")}
                              </p>
                            ) : (
                              <p className="admin-class-config-warn">
                                Aucune branche n’est encore définie dans le plan de formation pour cette
                                profession et cette année.
                                <button
                                  type="button"
                                  className="admin-link-button"
                                  onClick={onOpenPlans}
                                >
                                  Ouvrir le plan de formation
                                </button>
                              </p>
                            )
                          ) : (
                            <p className="admin-class-config-warn">
                              Classe legacy : année scolaire / profession / année de formation à
                              configurer
                            </p>
                          )}
                          <StudentAccessAdminBlock
                            schoolClass={entry}
                            schoolYears={schoolYears}
                            access={accesses[entry.id] ?? null}
                            revealedCode={revealedCodeByClass[entry.id] ?? null}
                            pending={pending && pendingClassId === entry.id}
                            error={accessErrorByClass[entry.id] ?? null}
                            onGenerate={(schoolClass, isRegenerate) =>
                              void generateStudentAccess(schoolClass, isRegenerate)
                            }
                            onRevoke={(schoolClass) => void revokeStudentAccess(schoolClass)}
                            onDismissCode={() =>
                              setRevealedCodeByClass((current) => {
                                const next = { ...current };
                                delete next[entry.id];
                                return next;
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                    <div className="admin-teacher-badges" aria-label="État de la classe">
                      <span
                        className={
                          status === "active" ? "badge-status is-on" : "badge-status is-off"
                        }
                      >
                        {classLifecycleLabel(status)}
                      </span>
                    </div>
                    <div className="admin-teacher-actions">
                      {status === "archived" ? (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void unarchiveClass(entry)}
                          >
                            Désarchiver
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void deleteClass(entry)}
                          >
                            Supprimer
                          </button>
                        </>
                      ) : (
                        <>
                          {!editing ? (
                            <button
                              type="button"
                              onClick={() =>
                                setClassDraft({
                                  classId: entry.id,
                                  schoolYearId: entry.schoolYearId ?? "",
                                  professionId: entry.professionId ?? "",
                                  trainingYear:
                                    entry.trainingYear !== null ? String(entry.trainingYear) : "",
                                  parallelCode: entry.parallelCode ?? "",
                                })
                              }
                            >
                              Modifier
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void toggleActive(entry)}
                          >
                            {status === "active" ? "Désactiver" : "Réactiver"}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void archiveClass(entry)}
                          >
                            Archiver
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void deleteClass(entry)}
                          >
                            Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {confirmCopy && confirmAction ? (
        <ConfirmDialog
          open
          title={confirmCopy.title}
          body={confirmCopy.body}
          confirmLabel={confirmCopy.confirmLabel}
          danger
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => runConfirmedAction(confirmAction)}
        />
      ) : null}
    </div>
  );
}
