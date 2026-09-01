"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolBranchRecord,
  SchoolClassRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import { formatBranchUsageLine, summarizeBranchUsages } from "@campus/features/school-catalog";
import { BRANCH_TEACHING_TYPE_LABELS, type TeachingType } from "@campus/features/teaching-types/index.ts";
import { AnnualCoursesAdminPanel } from "./annual-courses-admin-panel.tsx";
import { ClassScheduleAdminPanel } from "./class-schedule-admin-panel.tsx";
import { ClassesAdminPanel } from "./classes-admin-panel.tsx";
import { ProfessionsAdminPanel } from "./professions-admin-panel.tsx";
import { SchoolYearAdminPanel } from "./school-year-admin-panel.tsx";
import { TeacherAccountsPanel } from "./teacher-accounts-panel.tsx";
import { TrainingPlansAdminPanel } from "./training-plans-admin-panel.tsx";
import {
  fetchSchoolYears,
  type SchoolCalendarWeek,
  type SchoolYearSummary,
} from "../../lib/api-client.ts";

type AdminTab = "classes" | "branches" | "professions" | "plans" | "teachers" | "assignments" | "schedules" | "weeks";

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
  classes: "Classes",
  branches: "Catalogue des branches",
  professions: "Professions",
  plans: "Plans de formation",
  teachers: "Enseignants",
  assignments: "Attributions des cours",
  schedules: "Horaire des classes",
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

function branchUsageText(
  branchId: string,
  professions: SchoolProfessionRecord[],
  contexts: PedagogicalContextRecord[],
): string {
  const usages = summarizeBranchUsages({ branchId, professions, contexts });
  if (usages.length === 0) return "Aucune affectation active.";
  return `Utilisé dans : ${usages.map(formatBranchUsageLine).join(" · ")}`;
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
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const archivedBranchCount = useMemo(
    () => branches.filter((entry) => entry.isArchived).length,
    [branches],
  );

  const visibleBranches = useMemo(
    () => branches.filter((entry) => (showArchivedBranches ? entry.isArchived : !entry.isArchived)),
    [branches, showArchivedBranches],
  );

  function fail(message: string) {
    setSectionError({ tab, message });
  }

  function succeed() {
    setSectionError(null);
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
          Catalogue des branches → professions → plans de formation (CTX) → classes →
          attributions → horaire. Les branches d’une classe viennent du plan, jamais d’une saisie libre.
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

      {loading && tab !== "professions" && tab !== "plans" && tab !== "teachers" && tab !== "schedules" ? (
        <p className="admin-loading">Chargement…</p>
      ) : null}

      {tab === "classes" && !loading ? (
        <ClassesAdminPanel
          classes={classes}
          branches={branches}
          professions={professions}
          contexts={contexts}
          schoolYears={schoolYears}
          error={visibleError}
          onNotice={onNotice}
          onError={fail}
          onClearError={succeed}
          onCreated={refresh}
          onOpenPlans={() => setTab("plans")}
        />
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
                          <p className="admin-branch-usage">
                            {branchUsageText(entry.id, professions, contexts)}
                          </p>
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

      {tab === "plans" ? (
        <TrainingPlansAdminPanel onNotice={onNotice} onOpenBranches={() => setTab("branches")} />
      ) : null}

      {tab === "teachers" ? (
        <TeacherAccountsPanel currentTeacherId={currentTeacherId} onNotice={onNotice} />
      ) : null}

      {tab === "assignments" ? (
        <AnnualCoursesAdminPanel onNotice={onNotice} />
      ) : null}

      {tab === "schedules" ? (
        <ClassScheduleAdminPanel onNotice={onNotice} onOpenAssignments={() => setTab("assignments")} />
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
