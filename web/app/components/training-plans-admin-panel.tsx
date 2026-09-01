"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolBranchRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import {
  filterProfessionsForPlanSearch,
  findContextForCell,
  formatPedagogicalContextLabel,
  formatProfessionOptionLabel,
  formatTrainingYearLabel,
  projectTrainingPlanMatrix,
  trainingYearsForDuration,
} from "@campus/features/school-catalog";
import { BRANCH_TEACHING_TYPE_LABELS } from "@campus/features/teaching-types/index.ts";
import { PedagogicalPathPanel } from "./pedagogical-path-panel.tsx";

interface TrainingPlansAdminPanelProps {
  onNotice: (message: string) => void;
  onOpenBranches?: () => void;
}

type ViewMode = "matrix" | "list";

async function fetchFullCatalog() {
  const response = await fetch("/api/admin/catalog", { credentials: "include" });
  const payload = (await response.json()) as {
    ok: boolean;
    reason?: string;
    branches?: SchoolBranchRecord[];
    professions?: SchoolProfessionRecord[];
    contexts?: PedagogicalContextRecord[];
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement du référentiel impossible.");
  }
  return {
    branches: payload.branches ?? [],
    professions: payload.professions ?? [],
    contexts: payload.contexts ?? [],
  };
}

function cellKey(branchId: string, year: number): string {
  return `${branchId}:${year}`;
}

export function TrainingPlansAdminPanel({ onNotice, onOpenBranches }: TrainingPlansAdminPanelProps) {
  const [branches, setBranches] = useState<SchoolBranchRecord[]>([]);
  const [professions, setProfessions] = useState<SchoolProfessionRecord[]>([]);
  const [contexts, setContexts] = useState<PedagogicalContextRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [professionQuery, setProfessionQuery] = useState("");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("matrix");
  const [pendingCell, setPendingCell] = useState("");
  const [pathEditor, setPathEditor] = useState<{
    contextId: string;
    adminCode: string;
    contextLabel: string;
  } | null>(null);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError("");
    try {
      const catalog = await fetchFullCatalog();
      setBranches(catalog.branches);
      setProfessions(catalog.professions);
      setContexts(catalog.contexts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const listedProfessions = useMemo(
    () => filterProfessionsForPlanSearch(professions, professionQuery),
    [professionQuery, professions],
  );

  useEffect(() => {
    if (professionId) return;
    const first =
      listedProfessions.find((entry) => entry.isActive && !entry.isArchived) ?? listedProfessions[0];
    if (!first) return;
    queueMicrotask(() => setProfessionId(first.id));
  }, [listedProfessions, professionId]);

  const selectedProfession = useMemo(
    () => professions.find((entry) => entry.id === professionId) ?? null,
    [professionId, professions],
  );

  const matrix = useMemo(() => {
    if (!selectedProfession) return null;
    return projectTrainingPlanMatrix({
      profession: selectedProfession,
      branches,
      contexts,
    });
  }, [branches, contexts, selectedProfession]);

  const visibleYears = useMemo(() => {
    if (!matrix) return [];
    if (yearFilter === "all") return matrix.years;
    return matrix.years.filter((year) => year === yearFilter);
  }, [matrix, yearFilter]);

  const readOnly = Boolean(selectedProfession?.isArchived);
  const activeContextCount = useMemo(() => {
    if (!selectedProfession) return 0;
    return contexts.filter(
      (entry) =>
        entry.professionId === selectedProfession.id && entry.isActive && !entry.isArchived,
    ).length;
  }, [contexts, selectedProfession]);

  async function createAssignment(branch: SchoolBranchRecord, trainingYear: number) {
    if (!selectedProfession) return;
    const key = cellKey(branch.id, trainingYear);
    setPendingCell(key);
    setError("");
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "context",
          professionId: selectedProfession.id,
          trainingYear,
          branchId: branch.id,
          isActive: true,
        }),
      });
      const payload = (await response.json()) as { ok: boolean; reason?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Affectation impossible.");
        return;
      }
      onNotice("Enregistré");
      await refresh({ silent: true });
    } finally {
      setPendingCell("");
    }
  }

  async function restoreAssignment(context: PedagogicalContextRecord, branchLabel: string) {
    const key = cellKey(context.branchId, context.trainingYear);
    const confirmed = window.confirm(
      `Cette affectation existe déjà en archive (${context.adminCode}). ` +
        `Elle ne peut pas être recréée : l’identité pédagogique est conservée.\n\n` +
        `Restaurer ${formatPedagogicalContextLabel({
          branchLabel,
          trainingYear: context.trainingYear,
          mode: "short",
        })} ?`,
    );
    if (!confirmed) return;
    setPendingCell(key);
    setError("");
    try {
      const response = await fetch(`/api/admin/catalog/${context.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "context", isArchived: false, isActive: true }),
      });
      const payload = (await response.json()) as { ok: boolean; reason?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Restauration impossible.");
        return;
      }
      onNotice("Enregistré");
      await refresh({ silent: true });
    } finally {
      setPendingCell("");
    }
  }

  async function removeAssignment(context: PedagogicalContextRecord, branchLabel: string) {
    const key = cellKey(context.branchId, context.trainingYear);
    setPendingCell(key);
    setError("");
    try {
      const deleteResponse = await fetch(`/api/admin/catalog/${context.id}?kind=context`, {
        method: "DELETE",
        credentials: "include",
      });
      const deletePayload = (await deleteResponse.json()) as { ok: boolean; reason?: string };
      if (deleteResponse.ok && deletePayload.ok) {
        onNotice("Enregistré");
        await refresh({ silent: true });
        return;
      }

      const confirmed = window.confirm(
        `Cette affectation est déjà utilisée par des cours ou un parcours pédagogique. ` +
          `Elle ne peut pas être supprimée définitivement.\n\n` +
          `Archiver ${formatPedagogicalContextLabel({
            branchLabel,
            trainingYear: context.trainingYear,
            mode: "short",
          })} ?`,
      );
      if (!confirmed) return;

      const archiveResponse = await fetch(`/api/admin/catalog/${context.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "context", isArchived: true }),
      });
      const archivePayload = (await archiveResponse.json()) as { ok: boolean; reason?: string };
      if (!archiveResponse.ok || !archivePayload.ok) {
        setError(
          deletePayload.reason ??
            archivePayload.reason ??
            "Retrait impossible. Archivez l’affectation manuellement.",
        );
        return;
      }
      onNotice("Affectation archivée. L’historique pédagogique est conservé.");
      await refresh({ silent: true });
    } finally {
      setPendingCell("");
    }
  }

  async function toggleCell(branch: SchoolBranchRecord, trainingYear: number, checked: boolean) {
    if (!selectedProfession || readOnly) return;
    const rowLocked = branch.isArchived || !branch.isActive;
    if (!checked && rowLocked) return;
    const context = contexts.find(
      (entry) =>
        entry.professionId === selectedProfession.id &&
        entry.trainingYear === trainingYear &&
        entry.branchId === branch.id &&
        entry.isActive &&
        !entry.isArchived,
    );
    if (checked) {
      if (context) return;
      const existing = findContextForCell({
        contexts,
        professionId: selectedProfession.id,
        trainingYear,
        branchId: branch.id,
      });
      if (existing) {
        await restoreAssignment(existing, branch.label);
        return;
      }
      await createAssignment(branch, trainingYear);
      return;
    }
    if (!context) return;
    await removeAssignment(context, branch.label);
  }

  if (loading) {
    return <p className="admin-loading">Chargement…</p>;
  }

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Plan de formation</h3>
          <p>
            Définissez pour chaque profession les branches enseignées selon l’année de formation.
          </p>
          <p className="admin-training-plan-hint">
            Une case cochée crée une affectation pédagogique Profession + Année + Branche.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-training-layout">
        <aside className="admin-training-professions" aria-label="Professions">
          <h4>Professions</h4>
          <label className="admin-training-search">
            Recherche
            <input
              type="search"
              value={professionQuery}
              onChange={(event) => setProfessionQuery(event.target.value)}
              placeholder="Recherche…"
            />
          </label>
          <ul className="admin-training-profession-list">
            {listedProfessions.map((profession) => {
              const selected = profession.id === professionId;
              return (
                <li key={profession.id}>
                  <button
                    type="button"
                    className={selected ? "is-selected" : undefined}
                    onClick={() => {
                      setProfessionId(profession.id);
                      setYearFilter("all");
                    }}
                  >
                    <strong>{profession.label}</strong>
                    <span>
                      Durée : {profession.durationYears} an
                      {profession.durationYears > 1 ? "s" : ""}
                      {profession.classCodePrefix ? ` · ${profession.classCodePrefix}` : ""}
                      {profession.isArchived ? " · Archivée" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="admin-training-main">
          {!selectedProfession || !matrix ? (
            <p className="admin-loading">Choisissez une profession pour afficher son plan.</p>
          ) : (
            <>
              <header className="admin-training-plan-header">
                <div>
                  <p className="admin-teacher-name">{selectedProfession.label}</p>
                  <p className="admin-teacher-login-meta">
                    {formatProfessionOptionLabel(selectedProfession)}
                    {" · Durée : "}
                    {selectedProfession.durationYears} an
                    {selectedProfession.durationYears > 1 ? "s" : ""}
                    {" · "}
                    {selectedProfession.adminCode}
                  </p>
                </div>
                {onOpenBranches ? (
                  <button type="button" className="admin-link-button" onClick={onOpenBranches}>
                    + Nouvelle branche
                  </button>
                ) : null}
              </header>

              {readOnly ? (
                <p className="admin-class-config-warn">
                  Profession archivée : consultation uniquement, aucune nouvelle affectation.
                </p>
              ) : null}

              <div className="admin-training-toolbar">
                <label>
                  Années
                  <select
                    value={yearFilter === "all" ? "all" : String(yearFilter)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setYearFilter(value === "all" ? "all" : Number(value));
                    }}
                  >
                    <option value="all">Toutes les années</option>
                    {trainingYearsForDuration(selectedProfession.durationYears).map((year) => (
                      <option key={year} value={year}>
                        {formatTrainingYearLabel(year)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="admin-teacher-toolbar" role="group" aria-label="Présentation">
                  <button
                    type="button"
                    className={viewMode === "matrix" ? "is-selected" : undefined}
                    onClick={() => setViewMode("matrix")}
                  >
                    Matrice
                  </button>
                  <button
                    type="button"
                    className={viewMode === "list" ? "is-selected" : undefined}
                    onClick={() => setViewMode("list")}
                  >
                    Liste
                  </button>
                </div>
              </div>

              {viewMode === "matrix" ? (
                <div className="admin-training-matrix-wrap">
                  <table className="admin-training-matrix">
                    <thead>
                      <tr>
                        <th scope="col">Branches</th>
                        {visibleYears.map((year) => (
                          <th key={year} scope="col">
                            {year === 1 ? "1re" : `${year}e`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map((row) => (
                        <tr key={row.branch.id}>
                          <th scope="row">
                            <span className="admin-profession-branch-label">{row.branch.label}</span>
                            <span className="admin-admin-code">{row.branch.adminCode}</span>
                            {row.branch.teachingType ? (
                              <span className="admin-training-type">
                                {BRANCH_TEACHING_TYPE_LABELS[row.branch.teachingType]}
                              </span>
                            ) : null}
                          </th>
                          {row.cells
                            .filter((cell) => visibleYears.includes(cell.trainingYear))
                            .map((cell) => {
                              const key = cellKey(row.branch.id, cell.trainingYear);
                              const disabled =
                                pendingCell === key ||
                                readOnly ||
                                (row.assignmentLocked && !cell.checked);
                              return (
                                <td key={cell.trainingYear}>
                                  <label className="admin-training-check">
                                    <input
                                      type="checkbox"
                                      checked={cell.checked}
                                      disabled={disabled}
                                      aria-label={`${row.branch.label} — ${formatTrainingYearLabel(cell.trainingYear)}`}
                                      onChange={(event) =>
                                        void toggleCell(row.branch, cell.trainingYear, event.target.checked)
                                      }
                                    />
                                  </label>
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="admin-profession-years">
                  {visibleYears.map((year) => {
                    const assigned = matrix.rows.filter((row) =>
                      row.cells.some((cell) => cell.trainingYear === year && cell.checked),
                    );
                    return (
                      <div key={year} className="admin-profession-year">
                        <div className="admin-profession-year-header">
                          <strong>{formatTrainingYearLabel(year)}</strong>
                          <span>
                            {assigned.length} branche{assigned.length > 1 ? "s" : ""}
                          </span>
                        </div>
                        {assigned.length === 0 ? (
                          <p className="admin-profession-empty">Aucune branche affectée.</p>
                        ) : (
                          <ul className="admin-profession-assignments">
                            {assigned.map((row) => {
                              const cell = row.cells.find((entry) => entry.trainingYear === year);
                              return (
                                <li key={row.branch.id}>
                                  <div>
                                    <span className="admin-profession-branch-label">
                                      {formatPedagogicalContextLabel({
                                        branchLabel: row.branch.label,
                                        trainingYear: year,
                                        mode: "short",
                                      })}
                                    </span>
                                    <span className="admin-admin-code">
                                      {cell?.context?.adminCode ?? row.branch.adminCode}
                                    </span>
                                  </div>
                                  {cell?.context ? (
                                    <div className="admin-profession-context-actions">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPathEditor({
                                            contextId: cell.context!.id,
                                            adminCode: cell.context!.adminCode,
                                            contextLabel: formatPedagogicalContextLabel({
                                              branchLabel: row.branch.label,
                                              trainingYear: year,
                                              mode: "short",
                                            }),
                                          })
                                        }
                                      >
                                        Parcours pédagogique
                                      </button>
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="admin-training-summary">
                {activeContextCount} affectation{activeContextCount > 1 ? "s" : ""} pédagogique
                {activeContextCount > 1 ? "s" : ""} active{activeContextCount > 1 ? "s" : ""} pour cette
                profession.
              </p>
            </>
          )}
        </div>
      </div>

      {pathEditor ? (
        <PedagogicalPathPanel
          contextId={pathEditor.contextId}
          adminCode={pathEditor.adminCode}
          branchLabel={pathEditor.contextLabel}
          onNotice={onNotice}
          onClose={() => setPathEditor(null)}
        />
      ) : null}
    </div>
  );
}
