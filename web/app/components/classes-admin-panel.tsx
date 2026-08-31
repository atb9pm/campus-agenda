"use client";

import { FormEvent, useMemo, useState } from "react";

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

  const activeProfessions = useMemo(
    () => professions.filter((entry) => entry.isActive && !entry.isArchived),
    [professions],
  );

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

  async function archiveClass(entry: SchoolClassRecord) {
    if (
      !window.confirm(
        `Archiver la classe « ${entry.code} » ?\nElle sera conservée pour l’historique et retirée des listes opérationnelles.`,
      )
    ) {
      return;
    }
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
    if (
      !window.confirm(
        `Supprimer définitivement la classe « ${entry.code} » ?\nCette action est irréversible.`,
      )
    ) {
      return;
    }
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
    </div>
  );
}
