"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  SchoolBranchRecord,
  SchoolClassRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import { trainingYearsForDuration } from "@campus/features/school-catalog";
import { ProfessionsAdminPanel } from "./professions-admin-panel.tsx";
import { SchoolYearAdminPanel } from "./school-year-admin-panel.tsx";
import { TeacherAccountsPanel } from "./teacher-accounts-panel.tsx";
import {
  fetchSchoolYears,
  type SchoolCalendarWeek,
  type SchoolYearSummary,
} from "../../lib/api-client.ts";
import {
  listSelectableSchoolYearsForClassEdit,
  listSelectableSchoolYearsForNewClass,
} from "@campus/features/school-catalog";

type AdminTab = "classes" | "branches" | "professions" | "teachers" | "access" | "weeks";

interface AdministrationPanelProps {
  currentTeacherId: string;
  onCalendarUpdated: (weeks: SchoolCalendarWeek[]) => void;
  onNotice: (message: string) => void;
}

interface BranchEditDraft {
  branchId: string;
  label: string;
}

const TAB_LABELS: Record<AdminTab, string> = {
  classes: "Paramétrage des classes",
  branches: "Paramétrage des branches",
  professions: "Professions et branches",
  teachers: "Gestion des enseignants",
  access: "Gestion des accès",
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
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement du référentiel impossible.");
  }
  return {
    classes: payload.classes ?? [],
    branches: payload.branches ?? [],
    professions: payload.professions ?? [],
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
  const [schoolYears, setSchoolYears] = useState<SchoolYearSummary[]>([]);
  const [classSchoolYearId, setClassSchoolYearId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classCode, setClassCode] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [branchLabel, setBranchLabel] = useState("");
  const [branchEditDraft, setBranchEditDraft] = useState<BranchEditDraft | null>(null);
  const [showArchivedBranches, setShowArchivedBranches] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [catalog, years] = await Promise.all([fetchCatalog(false), fetchSchoolYears()]);
      setClasses(catalog.classes);
      setBranches(catalog.branches);
      setProfessions(catalog.professions);
      setSchoolYears(years);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  async function submitClass(event: FormEvent) {
    event.preventDefault();
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
        schoolYearId: classSchoolYearId || null,
      }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Création impossible.");
      return;
    }
    setClassCode("");
    setClassLabel("");
    setClassSchoolYearId("");
    onNotice("Classe ajoutée au référentiel.");
    await refresh();
  }

  async function submitBranch(event: FormEvent) {
    event.preventDefault();
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
      }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Création impossible.");
      return;
    }
    setBranchLabel("");
    onNotice("Branche ajoutée au référentiel.");
    await refresh();
  }

  async function toggleClassActive(entry: SchoolClassRecord) {
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "class", isActive: !entry.isActive }),
    });
    if (!response.ok) {
      setError("Mise à jour impossible.");
      return;
    }
    await refresh();
  }

  async function patchClassProfession(
    entry: SchoolClassRecord,
    patch: { professionId?: string | null; trainingYear?: number | null },
  ) {
    setError("");
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "class", ...patch }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Mise à jour impossible.");
      return;
    }
    onNotice(`Classe ${entry.code} mise à jour.`);
    await refresh();
  }
  async function patchClassSchoolYear(entry: SchoolClassRecord, schoolYearId: string | null) {
    setError("");
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "class", schoolYearId }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Mise à jour impossible.");
      return;
    }
    onNotice(`Année scolaire de ${entry.code} mise à jour.`);
    await refresh();
  }


  async function patchBranch(
    entry: SchoolBranchRecord,
    patch: { label?: string; code?: string; isActive?: boolean; isArchived?: boolean },
  ) {
    setError("");
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "branch", ...patch }),
    });
    if (!response.ok) {
      setError("Mise à jour impossible.");
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
      setError("Le nom de la branche est requis.");
      return;
    }
    await patchBranch(entry, {
      label: nextLabel,
      code: branchCodeFromLabel(nextLabel),
    });
    onNotice(`Branche « ${nextLabel} » mise à jour.`);
    setBranchEditDraft(null);
  }

  return (
    <section className="teacher-workspace admin-workspace" aria-label="Administration">
      <div className="workspace-intro">
        <p className="eyebrow">ADMINISTRATION ÉCOLE</p>
        <h2>Référentiel et accès</h2>
        <p>
          Créez les données officielles de l’école. Les enseignants sélectionnent ensuite uniquement dans ces
          listes.
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
            onClick={() => setTab(entry)}
          >
            {TAB_LABELS[entry]}
          </button>
        ))}
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {loading && tab !== "professions" ? <p className="admin-loading">Chargement…</p> : null}

      {tab === "classes" && !loading ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Paramétrage des classes</h3>
              <p>
                Liste officielle. Rattachez chaque classe à une année scolaire (ID stable), une profession et une année de formation.
                Une classe inutilisée peut être désactivée (jamais supprimée).
              </p>
            </div>
          </header>
          <form className="admin-inline-form" onSubmit={(event) => void submitClass(event)}>
            <label>
              Code
              <input value={classCode} onChange={(event) => setClassCode(event.target.value)} placeholder="MA2" required />
            </label>
            <label>
              Libellé
              <input value={classLabel} onChange={(event) => setClassLabel(event.target.value)} placeholder="MA2" />
            </label>
            <label>
              Année scolaire
              <select
                value={classSchoolYearId}
                onChange={(event) => setClassSchoolYearId(event.target.value)}
              >
                <option value="">Non renseignée (legacy)</option>
                {listSelectableSchoolYearsForNewClass(schoolYears).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label} ({year.status === "active" ? "active" : "brouillon"})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="workspace-action">Ajouter</button>
          </form>
          <ul className="admin-catalog-list admin-class-list">
            {classes.map((entry) => {
              const linkedProfession = entry.professionId
                ? professionById.get(entry.professionId) ?? null
                : null;
              const yearOptions = linkedProfession
                ? trainingYearsForDuration(linkedProfession.durationYears)
                : [];
              const needsConfig = !entry.professionId || entry.trainingYear === null;
              const selectableProfessions = activeProfessions.slice();
              if (
                linkedProfession &&
                !selectableProfessions.some((profession) => profession.id === linkedProfession.id)
              ) {
                selectableProfessions.unshift(linkedProfession);
              }
              return (
                <li key={entry.id}>
                  <strong>{entry.code}</strong>
                  <span>{entry.label}</span>
                  <div className="admin-class-pedagogy">
                    <label>
                      Année scolaire
                      <select
                        value={entry.schoolYearId ?? ""}
                        onChange={(event) => {
                          void patchClassSchoolYear(entry, event.target.value || null);
                        }}
                      >
                        <option value="">Non renseignée (legacy)</option>
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
                        value={entry.professionId ?? ""}
                        onChange={(event) => {
                          const nextProfessionId = event.target.value || null;
                          const nextProfession = nextProfessionId
                            ? professionById.get(nextProfessionId)
                            : null;
                          const yearStillValid =
                            nextProfession &&
                            entry.trainingYear !== null &&
                            entry.trainingYear >= 1 &&
                            entry.trainingYear <= nextProfession.durationYears;
                          void patchClassProfession(entry, {
                            professionId: nextProfessionId,
                            trainingYear: yearStillValid ? entry.trainingYear : null,
                          });
                        }}
                      >
                        <option value="">À configurer…</option>
                        {selectableProfessions.map((profession) => (
                          <option key={profession.id} value={profession.id}>
                            {profession.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Année
                      <select
                        value={entry.trainingYear ?? ""}
                        disabled={!entry.professionId}
                        onChange={(event) => {
                          const raw = event.target.value;
                          void patchClassProfession(entry, {
                            trainingYear: raw ? Number.parseInt(raw, 10) : null,
                          });
                        }}
                      >
                        <option value="">À configurer…</option>
                        {yearOptions.map((year) => (
                          <option key={year} value={year}>
                            Année {year}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsConfig ? (
                      <span className="admin-class-config-warn">Profession / année à configurer</span>
                    ) : (
                      <span className="admin-class-config-ok">
                        {linkedProfession?.label ?? "Profession"} · année {entry.trainingYear}
                      </span>
                    )}
                  </div>
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
              <h3>Paramétrage des branches</h3>
              <p>
                Branches globales de l’école (Moteur, Électricité…). Édition, activation et
                archivage — une branche archivée n’apparaît plus dans la configuration enseignant.
              </p>
            </div>
          </header>
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
                          <p className="admin-teacher-login-meta">Code&nbsp;: {entry.code}</p>
                          {entry.adminCode ? (
                            <p className="admin-admin-code" title="Code administratif">
                              {entry.adminCode}
                            </p>
                          ) : null}
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
                    </div>

                    <div className="admin-teacher-actions">
                      {!editing ? (
                        <button
                          type="button"
                          onClick={() =>
                            setBranchEditDraft({ branchId: entry.id, label: entry.label })
                          }
                        >
                          Modifier
                        </button>
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
        <TeacherAccountsPanel mode="accounts" currentTeacherId={currentTeacherId} onNotice={onNotice} />
      ) : null}

      {tab === "access" ? (
        <TeacherAccountsPanel mode="roles" currentTeacherId={currentTeacherId} onNotice={onNotice} />
      ) : null}

      {tab === "weeks" ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Plan des semaines A et B</h3>
              <p>Génération et modification du calendrier scolaire par année.</p>
            </div>
          </header>
          <SchoolYearAdminPanel onCalendarUpdated={onCalendarUpdated} onNotice={onNotice} />
        </div>
      ) : null}
    </section>
  );
}
