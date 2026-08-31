"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolBranchRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import {
  formatProfessionOptionLabel,
  formatTrainingYearLabel,
  trainingYearsForDuration,
} from "@campus/features/school-catalog";
import { BRANCH_TEACHING_TYPE_LABELS } from "@campus/features/teaching-types/index.ts";
import { PedagogicalPathPanel } from "./pedagogical-path-panel.tsx";

interface TrainingPlansAdminPanelProps {
  onNotice: (message: string) => void;
}

interface YearAssignDraft {
  [key: string]: string;
}

function yearKey(professionId: string, year: number): string {
  return `${professionId}:${year}`;
}

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

export function TrainingPlansAdminPanel({ onNotice }: TrainingPlansAdminPanelProps) {
  const [branches, setBranches] = useState<SchoolBranchRecord[]>([]);
  const [professions, setProfessions] = useState<SchoolProfessionRecord[]>([]);
  const [contexts, setContexts] = useState<PedagogicalContextRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [assignDraft, setAssignDraft] = useState<YearAssignDraft>({});
  const [pathEditor, setPathEditor] = useState<{
    contextId: string;
    adminCode: string;
    branchLabel: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const catalog = await fetchFullCatalog();
      setBranches(catalog.branches);
      setProfessions(catalog.professions);
      setContexts(catalog.contexts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectableProfessions = useMemo(
    () => professions.filter((entry) => entry.isActive && !entry.isArchived),
    [professions],
  );

  const selectedProfession = useMemo(
    () => professions.find((entry) => entry.id === professionId) ?? null,
    [professionId, professions],
  );

  const branchById = useMemo(() => {
    const map = new Map<string, SchoolBranchRecord>();
    for (const branch of branches) map.set(branch.id, branch);
    return map;
  }, [branches]);

  const assignableBranches = useMemo(
    () => branches.filter((entry) => entry.isActive && !entry.isArchived),
    [branches],
  );

  async function assignBranch(selectedProfessionId: string, trainingYear: number) {
    const key = yearKey(selectedProfessionId, trainingYear);
    const branchId = assignDraft[key]?.trim();
    if (!branchId) {
      setError("Choisissez une branche à affecter.");
      return;
    }
    setError("");
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "context",
        professionId: selectedProfessionId,
        trainingYear,
        branchId,
        isActive: true,
      }),
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Affectation impossible.");
      return;
    }
    setAssignDraft((current) => ({ ...current, [key]: "" }));
    onNotice(`Branche affectée à l’année ${trainingYear}.`);
    await refresh();
  }

  async function removeContext(context: PedagogicalContextRecord) {
    setError("");
    const deleteResponse = await fetch(`/api/admin/catalog/${context.id}?kind=context`, {
      method: "DELETE",
      credentials: "include",
    });
    const deletePayload = (await deleteResponse.json()) as { ok: boolean; reason?: string };
    if (deleteResponse.ok && deletePayload.ok) {
      onNotice(`Affectation ${context.adminCode} retirée.`);
      await refresh();
      return;
    }

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
    onNotice(
      `Affectation ${context.adminCode} archivée` +
        (deletePayload.reason ? ` (${deletePayload.reason})` : "") +
        ".",
    );
    await refresh();
  }

  function contextsForYear(selectedProfessionId: string, year: number) {
    return contexts.filter(
      (entry) =>
        entry.professionId === selectedProfessionId &&
        entry.trainingYear === year &&
        !entry.isArchived,
    );
  }

  if (loading) {
    return <p className="admin-loading">Chargement…</p>;
  }

  const years = selectedProfession ? trainingYearsForDuration(selectedProfession.durationYears) : [];

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Plans de formation</h3>
          <p>
            Choisissez une profession. Les années viennent de sa durée. Chaque branche affectée
            crée ou réutilise un CTX (profession + année + branche). Les classes parallèles
            partagent le même CTX.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <form className="admin-inline-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Profession
          <select
            value={professionId}
            onChange={(event) => setProfessionId(event.target.value)}
          >
            <option value="">Choisir…</option>
            {selectableProfessions.map((profession) => (
              <option key={profession.id} value={profession.id}>
                {formatProfessionOptionLabel(profession)}
              </option>
            ))}
          </select>
        </label>
      </form>

      {!selectedProfession ? (
        <p className="admin-loading">Choisissez une profession pour afficher son plan.</p>
      ) : (
        <div className="admin-training-plan">
          <header className="admin-training-plan-header">
            <div>
              <p className="admin-teacher-name">{selectedProfession.label}</p>
              <p className="admin-teacher-login-meta">
                {selectedProfession.classCodePrefix
                  ? `Abréviation ${selectedProfession.classCodePrefix}`
                  : "Abréviation à configurer"}
                {" · Durée : "}
                {selectedProfession.durationYears} an
                {selectedProfession.durationYears > 1 ? "s" : ""}
                {" · "}
                {selectedProfession.adminCode}
              </p>
            </div>
          </header>

          <div className="admin-profession-years">
            {years.map((year) => {
              const yearContexts = contextsForYear(selectedProfession.id, year);
              const key = yearKey(selectedProfession.id, year);
              const assignedIds = new Set(yearContexts.map((ctx) => ctx.branchId));
              const availableBranches = assignableBranches.filter(
                (branch) => !assignedIds.has(branch.id),
              );
              return (
                <div key={key} className="admin-profession-year">
                  <div className="admin-profession-year-header">
                    <strong>{formatTrainingYearLabel(year)}</strong>
                    <span>
                      {yearContexts.length} branche{yearContexts.length > 1 ? "s" : ""}
                    </span>
                  </div>

                  {yearContexts.length === 0 ? (
                    <p className="admin-profession-empty">Aucune branche affectée.</p>
                  ) : (
                    <ul className="admin-profession-assignments">
                      {yearContexts.map((context) => {
                        const branch = branchById.get(context.branchId);
                        return (
                          <li key={context.id}>
                            <div>
                              <span className="admin-profession-branch-label">
                                {branch?.label ?? context.branchId}
                                {branch?.teachingType
                                  ? ` — ${BRANCH_TEACHING_TYPE_LABELS[branch.teachingType]}`
                                  : ""}
                              </span>
                              <span className="admin-admin-code">{context.adminCode}</span>
                            </div>
                            <div className="admin-profession-context-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  setPathEditor({
                                    contextId: context.id,
                                    adminCode: context.adminCode,
                                    branchLabel: branch?.label ?? context.branchId,
                                  })
                                }
                              >
                                Parcours pédagogique
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeContext(context)}
                              >
                                Retirer
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="admin-profession-assign">
                    <label>
                      Ajouter une branche
                      <select
                        value={assignDraft[key] ?? ""}
                        onChange={(event) =>
                          setAssignDraft((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Choisir…</option>
                        {availableBranches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.label} — {branch.teachingType
                              ? BRANCH_TEACHING_TYPE_LABELS[branch.teachingType]
                              : "Type à configurer"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={!assignDraft[key]}
                      onClick={() => void assignBranch(selectedProfession.id, year)}
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pathEditor ? (
        <PedagogicalPathPanel
          contextId={pathEditor.contextId}
          adminCode={pathEditor.adminCode}
          branchLabel={pathEditor.branchLabel}
          onNotice={onNotice}
          onClose={() => setPathEditor(null)}
        />
      ) : null}
    </div>
  );
}
