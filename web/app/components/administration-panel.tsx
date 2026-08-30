"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolBranchRecord,
  SchoolClassRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import {
  listPlannedBranchesForClass,
  listSelectableSchoolYearsForClassEdit,
  listSelectableSchoolYearsForNewClass,
  trainingYearsForDuration,
} from "@campus/features/school-catalog";
import { BRANCH_TEACHING_TYPE_LABELS, type TeachingType } from "@campus/features/teaching-types/index.ts";
import { AnnualCoursesAdminPanel } from "./annual-courses-admin-panel.tsx";
import { ProfessionsAdminPanel } from "./professions-admin-panel.tsx";
import { SchoolYearAdminPanel } from "./school-year-admin-panel.tsx";
import { TeacherAccountsPanel } from "./teacher-accounts-panel.tsx";
import {
  fetchSchoolYears,
  type SchoolCalendarWeek,
  type SchoolYearSummary,
} from "../../lib/api-client.ts";

type AdminTab = "classes" | "branches" | "professions" | "teachers" | "assignments" | "weeks";

interface AdministrationPanelProps {
  currentTeacherId: string;
  onCalendarUpdated: (weeks: SchoolCalendarWeek[]) => void;
  onNotice: (message: string) => void;
}

interface BranchEditDraft {
  branchId: string;
  label: string;
}

interface ClassEditDraft {
  classId: string;
  schoolYearId: string;
  professionId: string;
  trainingYear: string;
}

const TAB_LABELS: Record<AdminTab, string> = {
  classes: "Classes",
  branches: "Catalogue des branches",
  professions: "Professions & plan de formation",
  teachers: "Enseignants",
  assignments: "Attributions des cours",
  weeks: "Plan des semaines A/B",
};

function branchCardClass(entry: SchoolBranchRecord): string {
  if (entry.isArchived) return "admin-teacher-card is-archived";
  if (!entry.isActive) return "admin-teacher-card is-inactive";
  return "admin-teacher-card is-active";
}

function branchCodeFromLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function branchTypeLabel(type: TeachingType | null): string {
  return type ? BRANCH_TEACHING_TYPE_LABELS[type] : "Type à configurer";
}

async function fetchCatalog(activeOnly = false) {
  const response = await fetch(`/api/admin/catalog${activeOnly ? "?active=1" : ""}`, {
    credentials: "include",
  });
  const payload = await response.json() as {
    ok: boolean;
    reason?: string;
    classes?: SchoolClassRecord[];
    branches?: SchoolBranchRecord[];
    professions?: SchoolProfessionRecord[];
    contexts?: PedagogicalContextRecord[];
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement du référentiel impossible.");
  }
  return {
    classes: payload.classes ?? [],
    branches: payload.branches ?? [],
    professions: payload.professions ?? [],
    contexts: payload.contexts ?? [],
  };
}

export function AdministrationPanel({
  currentTeacherId,
  onCalendarUpdated,
  onNotice,
}: AdministrationPanelProps) {
  const [tab, setTab] = useState<AdminTab>("classes");
  const [classes, setClasses] = useState<SchoolClassRecord[]>([]);
  const [branches, setBranches] = useState<SchoolBranchRecord[]>([]);
  const [professions, setProfessions] = useState<SchoolProfessionRecord[]>([]);
  const [contexts, setContexts] = useState<PedagogicalContextRecord[]>([]);
  const [schoolYears, setSchoolYears] = useState<SchoolYearSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionError, setSectionError] = useState<{ tab: AdminTab; message: string } | null>(null);

  const [classCode, setClassCode] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [classSchoolYearId, setClassSchoolYearId] = useState("");
  const [classProfessionId, setClassProfessionId] = useState("");
  const [classTrainingYear, setClassTrainingYear] = useState("");
  const [classDraft, setClassDraft] = useState<ClassEditDraft | null>(null);

  const [branchLabel, setBranchLabel] = useState("");
  const [branchTeachingType, setBranchTeachingType] = useState<TeachingType | "">("");
  const [branchEditDraft, setBranchEditDraft] = useState<BranchEditDraft | null>(null);
  const [showArchivedBranches, setShowArchivedBranches] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, years] = await Promise.all([fetchCatalog(false), fetchSchoolYears()]);
      setClasses(catalog.classes);
      setBranches(catalog.branches);
      setProfessions(catalog.professions);
      setContexts(catalog.contexts);
      setSchoolYears(years);
    } catch (loadError) {
      setSectionError({
        tab,
        message: loadError instanceof Error ? loadError.message : "Chargement impossible.",
      });
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const archivedBranchCount = useMemo(
    () => branches.filter((entry) => entry.isArchived).length,
    [branches],
  );

  const visibleBranches = useMemo(
    () => branches.filter((entry) => (showArchivedBranches ? entry.isArchived : !entry.isArchived)),
    [branches, showArchivedBranches],
  );

  const activeProfessions = useMemo(
    () => professions.filter((entry) => entry.isActive && !entry.isArchived),
    [professions],
  );

  const professionById = useMemo(() => {
    const map = new Map<string, SchoolProfessionRecord>();
    for (const profession of professions) map.set(profession.id, profession);
    return map;
  }, [professions]);

  const newClassYears = useMemo(() => {
    const profession = professionById.get(classProfessionId);
    return profession ? trainingYearsForDuration(profession.durationYears) : [];
  }, [classProfessionId, professionById]);

  function fail(message: string) {
    setSectionError({ tab, message });
  }

  function succeed() {
    setSectionError(null);
  }

  async function submitClass(event: FormEvent) {
    event.preventDefault();
    succeed();
    if (!classSchoolYearId || !classProfessionId || !classTrainingYear) {
      fail("Année scolaire, profession et année de formation sont obligatoires.");
      return;
    }
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "class",
        code: classCode,
        label: classLabel || classCode,
        sortOrder: classes.length + 1,
        isActive: true,
        schoolYearId: classSchoolYearId,
        professionId: classProfessionId,
        trainingYear: Number.parseInt(classTrainingYear, 10),
      }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      fail(payload.reason ?? "Création impossible.");
      return;
    }
    setClassCode("");
    setClassLabel("");
    setClassSchoolYearId("");
    setClassProfessionId("");
    setClassTrainingYear("");
    onNotice("Classe ajoutée au référentiel.");
    await refresh();
  }

  async function saveClassDraft(event: FormEvent) {
    event.preventDefault();
    if (!classDraft) return;
    succeed();
    if (!classDraft.schoolYearId || !classDraft.professionId || !classDraft.trainingYear) {
      fail("Année scolaire, profession et année de formation doivent être enregistrées ensemble.");
      return;
    }
    const response = await fetch(`/api/admin/catalog/${classDraft.classId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "class",
        schoolYearId: classDraft.schoolYearId,
        professionId: classDraft.professionId,
        trainingYear: Number.parseInt(classDraft.trainingYear, 10),
      }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      fail(payload.reason ?? "Mise à jour impossible.");
      return;
    }
    const entry = classes.find((item) => item.id === classDraft.classId);
    onNotice(`Classe ${entry?.code ?? ""} mise à jour.`);
    setClassDraft(null);
    await refresh();
  }

  async function submitBranch(event: FormEvent) {
    event.preventDefault();
    succeed();
    if (!branchTeachingType) {
      fail("Le type de la branche est obligatoire.");
      return;
    }
    const code = branchCodeFromLabel(branchLabel);
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "branch",
        code,
        label: branchLabel,
        sortOrder: branches.length + 1,
        isActive: true,
        teachingType: branchTeachingType,
      }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      fail(payload.reason ?? "Création impossible.");
      return;
    }
    setBranchLabel("");
    setBranchTeachingType("");
    onNotice("Branche ajoutée au catalogue.");
    await refresh();
  }

  async function toggleClassActive(entry: SchoolClassRecord) {
    succeed();
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "class", isActive: !entry.isActive }),
    });
    if (!response.ok) {
      fail("Mise à jour impossible.");
      return;
    }
    await refresh();
  }

  async function patchBranch(
    entry: SchoolBranchRecord,
    patch: {
      label?: string;
      code?: string;
      isActive?: boolean;
      isArchived?: boolean;
      teachingType?: TeachingType | null;
    },
  ) {
    succeed();
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "branch", ...patch }),
    });
    if (!response.ok) {
      fail("Mise à jour impossible.");
      return;
    }
    if (patch.isArchived === true) onNotice(`Branche « ${entry.label} » archivée.`);
    if (patch.isArchived === false) onNotice(`Branche « ${entry.label} » désarchivée.`);
    await refresh();
  }

  async function saveBranchEdit(event: FormEvent) {
    event.preventDefault();
    if (!branchEditDraft) return;
    const entry = branches.find((branch) => branch.id === branchEditDraft.branchId);
    if (!entry) return;
    const nextLabel = branchEditDraft.label.trim();
    if (!nextLabel) {
      fail("Le nom de la branche est requis.");
      return;
    }
    await patchBranch(entry, {
      label: nextLabel,
      code: branchCodeFromLabel(nextLabel),
    });
    onNotice(`Branche « ${nextLabel} » mise à jour.`);
    setBranchEditDraft(null);
  }

  const visibleError = sectionError?.tab === tab ? sectionError.message : null;

  return (
    <section className="teacher-workspace admin-workspace" aria-label="Administration">
      <div className="workspace-intro">
        <p className="eyebrow">ADMINISTRATION ÉCOLE</p>
        <h2>Référentiel pédagogique</h2>
        <p>
          Catalogue des branches, professions et plan de formation (CTX), puis classes.
          Les branches d’une classe sont déduites automatiquement du plan.
        </p>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Sections administration">
        {(Object.keys(TAB_LABELS) as AdminTab[]).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={tab === entry ? "active" : ""}
            onClick={() => {
              setTab(entry);
              setSectionError(null);
            }}
          >
            {TAB_LABELS[entry]}
          </button>
        ))}
      </div>

      {loading && tab !== "professions" && tab !== "teachers" ? (
        <p className="admin-loading">Chargement…</p>
      ) : null}

      {tab === "classes" && !loading ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Classes</h3>
              <p>
                Une classe = année scolaire + profession + année de formation.
                Les branches prévues viennent du plan de formation (CTX), jamais d’une saisie libre.
              </p>
            </div>
          </header>
          {visibleError ? <p className="admin-error">{visibleError}</p> : null}
          <form className="admin-inline-form" onSubmit={(event) => void submitClass(event)}>
            <label>
              Code
              <input value={classCode} onChange={(event) => setClassCode(event.target.value)} placeholder="MMA1A" required />
            </label>
            <label>
              Libellé
              <input value={classLabel} onChange={(event) => setClassLabel(event.target.value)} placeholder="MMA1A" />
            </label>
            <label>
              Année scolaire
              <select
                value={classSchoolYearId}
                onChange={(event) => setClassSchoolYearId(event.target.value)}
                required
              >
                <option value="">Choisir…</option>
                {listSelectableSchoolYearsForNewClass(schoolYears).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}{year.status === "active" ? " (active)" : year.status === "draft" ? " (brouillon)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Profession
              <select
                value={classProfessionId}
                onChange={(event) => {
                  setClassProfessionId(event.target.value);
                  setClassTrainingYear("");
                }}
                required
              >
                <option value="">Choisir…</option>
                {activeProfessions.map((profession) => (
                  <option key={profession.id} value={profession.id}>
                    {profession.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Année de formation
              <select
                value={classTrainingYear}
                onChange={(event) => setClassTrainingYear(event.target.value)}
                disabled={!classProfessionId}
                required
              >
                <option value="">{classProfessionId ? "Choisir…" : "Choisir d’abord une profession"}</option>
                {newClassYears.map((year) => (
                  <option key={year} value={year}>Année {year}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="workspace-action">Ajouter la classe</button>
          </form>
          <ul className="admin-catalog-list admin-class-list">
            {classes.map((entry) => {
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
              const structured = Boolean(entry.schoolYearId && entry.professionId && entry.trainingYear !== null);
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
                <li key={entry.id}>
                  <strong>{entry.code}</strong>
                  <span>{entry.label}</span>
                  {editing && classDraft ? (
                    <form className="admin-class-pedagogy" onSubmit={(event) => void saveClassDraft(event)}>
                      <label>
                        Année scolaire
                        <select
                          value={classDraft.schoolYearId}
                          onChange={(event) =>
                            setClassDraft({ ...classDraft, schoolYearId: event.target.value })
                          }
                          required
                        >
                          {listSelectableSchoolYearsForClassEdit(schoolYears, entry.schoolYearId).map((year) => (
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
                          required
                        >
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
                          required
                        >
                          <option value="">Choisir…</option>
                          {yearOptions.map((year) => (
                            <option key={year} value={year}>Année {year}</option>
                          ))}
                        </select>
                      </label>
                      <button type="submit">Enregistrer</button>
                      <button type="button" onClick={() => setClassDraft(null)}>Annuler</button>
                    </form>
                  ) : (
                    <div className="admin-class-pedagogy">
                      <p className="admin-teacher-login-meta">
                        {entry.schoolYearLabel ?? (entry.schoolYearId ? entry.schoolYearId : "Année scolaire non renseignée (legacy)")}
                        {" · "}
                        {linkedProfession?.label ?? "Profession à configurer"}
                        {" · "}
                        {entry.trainingYear !== null ? `Année ${entry.trainingYear}` : "Année de formation à configurer"}
                      </p>
                      {structured ? (
                        planned.length > 0 ? (
                          <p className="admin-planned-branches">
                            <strong>Branches prévues</strong>
                            {" — "}
                            {planned.map((branch) => branch.label).join(", ")}
                          </p>
                        ) : (
                          <p className="admin-class-config-warn">
                            Aucune branche n’est encore définie dans le plan de formation pour cette profession et cette année.
                            <button type="button" className="admin-link-button" onClick={() => setTab("professions")}>
                              Ouvrir le plan de formation
                            </button>
                          </p>
                        )
                      ) : (
                        <span className="admin-class-config-warn">Classe legacy : année scolaire / profession / année de formation à configurer</span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setClassDraft({
                            classId: entry.id,
                            schoolYearId: entry.schoolYearId ?? "",
                            professionId: entry.professionId ?? "",
                            trainingYear: entry.trainingYear !== null ? String(entry.trainingYear) : "",
                          })
                        }
                      >
                        Modifier
                      </button>
                    </div>
                  )}
                  <span className={entry.isActive ? "status-active" : "status-inactive"}>
                    {entry.isActive ? "Active" : "Inactive"}
                  </span>
                  <button type="button" onClick={() => void toggleClassActive(entry)}>
                    {entry.isActive ? "Désactiver" : "Réactiver"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {tab === "branches" && !loading ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Catalogue des branches</h3>
              <p>
                Liste globale des branches enseignées dans l’école. Une branche est créée une seule fois,
                puis peut être utilisée dans plusieurs professions et années de formation.
              </p>
            </div>
          </header>
          {visibleError ? <p className="admin-error">{visibleError}</p> : null}
          <form className="admin-inline-form" onSubmit={(event) => void submitBranch(event)}>
            <label>
              Nom de la branche
              <input
                value={branchLabel}
                onChange={(event) => setBranchLabel(event.target.value)}
                placeholder="Moteur"
                required
              />
            </label>
            <label>
              Type
              <select
                value={branchTeachingType}
                onChange={(event) => setBranchTeachingType(event.target.value as TeachingType | "")}
                required
              >
                <option value="">Choisir…</option>
                <option value="TECHNICAL">Technique</option>
                <option value="GENERAL">Branche générale</option>
              </select>
            </label>
            <button type="submit" className="workspace-action">Ajouter</button>
          </form>

          <div className="admin-teacher-toolbar">
            <button
              type="button"
              className={!showArchivedBranches ? "is-selected" : undefined}
              onClick={() => setShowArchivedBranches(false)}
            >
              Branches ({branches.length - archivedBranchCount})
            </button>
            <button
              type="button"
              className={showArchivedBranches ? "is-selected" : undefined}
              onClick={() => setShowArchivedBranches(true)}
            >
              Archives ({archivedBranchCount})
            </button>
          </div>

          {visibleBranches.length === 0 ? (
            <p className="admin-loading">
              {showArchivedBranches ? "Aucune branche archivée." : "Aucune branche dans cette liste."}
            </p>
          ) : (
            <ul className="admin-teacher-access-list">
              {visibleBranches.map((entry) => {
                const editing = branchEditDraft?.branchId === entry.id;
                return (
                  <li key={entry.id} className={branchCardClass(entry)}>
                    <div className="admin-teacher-identity">
                      <strong className="admin-teacher-initials">{entry.code.slice(0, 4)}</strong>
                      {editing && branchEditDraft ? (
                        <form
                          className="admin-teacher-edit-form"
                          onSubmit={(event) => void saveBranchEdit(event)}
                        >
                          <label>
                            Nom
                            <input
                              value={branchEditDraft.label}
                              onChange={(event) =>
                                setBranchEditDraft({
                                  ...branchEditDraft,
                                  label: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <div className="admin-teacher-edit-actions">
                            <button type="submit">Enregistrer</button>
                            <button type="button" onClick={() => setBranchEditDraft(null)}>
                              Annuler
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div>
                          <p className="admin-teacher-name">{entry.label}</p>
                          {entry.adminCode ? (
                            <p className="admin-admin-code" title="Code administratif">
                              {entry.adminCode}
                            </p>
                          ) : null}
                          <p className="admin-teacher-login-meta">{branchTypeLabel(entry.teachingType)}</p>
                        </div>
                      )}
                    </div>

                    <div className="admin-teacher-badges" aria-label="État de la branche">
                      <span
                        className={
                          entry.isArchived || !entry.isActive
                            ? "badge-status is-off"
                            : "badge-status is-on"
                        }
                      >
                        {entry.isArchived ? "Archivée" : entry.isActive ? "Active" : "Désactivée"}
                      </span>
                      {!entry.teachingType ? (
                        <span className="badge-status is-off">Type à configurer</span>
                      ) : null}
                    </div>

                    <div className="admin-teacher-actions">
                      {!editing ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setBranchEditDraft({ branchId: entry.id, label: entry.label })
                            }
                          >
                            Modifier
                          </button>
                          {!entry.teachingType ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void patchBranch(entry, { teachingType: "TECHNICAL" })}
                              >
                                Technique
                              </button>
                              <button
                                type="button"
                                onClick={() => void patchBranch(entry, { teachingType: "GENERAL" })}
                              >
                                Branche générale
                              </button>
                            </>
                          ) : null}
                        </>
                      ) : null}
                      <button
                        type="button"
                        disabled={entry.isArchived}
                        onClick={() => void patchBranch(entry, { isActive: !entry.isActive })}
                      >
                        {entry.isActive ? "Désactiver" : "Réactiver"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void patchBranch(entry, { isArchived: !entry.isArchived })}
                      >
                        {entry.isArchived ? "Désarchiver" : "Archiver"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "professions" ? (
        <ProfessionsAdminPanel onNotice={onNotice} />
      ) : null}

      {tab === "teachers" ? (
        <TeacherAccountsPanel currentTeacherId={currentTeacherId} onNotice={onNotice} />
      ) : null}

      {tab === "assignments" ? (
        <AnnualCoursesAdminPanel onNotice={onNotice} />
      ) : null}

      {tab === "weeks" ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Plan des semaines A/B</h3>
              <p>Génération et modification du calendrier scolaire par année.</p>
            </div>
          </header>
          <SchoolYearAdminPanel onCalendarUpdated={onCalendarUpdated} onNotice={onNotice} />
        </div>
      ) : null}
    </section>
  );
}
