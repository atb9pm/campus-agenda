"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolBranchRecord,
  SchoolClassRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import { trainingYearsForDuration } from "@campus/features/school-catalog";

interface ProfessionsAdminPanelProps {
  onNotice: (message: string) => void;
}

interface ProfessionEditDraft {
  professionId: string;
  label: string;
  durationYears: string;
}

interface YearAssignDraft {
  [key: string]: string;
}

function professionCardClass(entry: SchoolProfessionRecord): string {
  if (entry.isArchived) return "admin-teacher-card is-archived";
  if (!entry.isActive) return "admin-teacher-card is-inactive";
  return "admin-teacher-card is-active";
}

function yearKey(professionId: string, year: number): string {
  return `${professionId}:${year}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

async function fetchFullCatalog() {
  const response = await fetch("/api/admin/catalog", { credentials: "include" });
  const payload = (await response.json()) as {
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

export function ProfessionsAdminPanel({ onNotice }: ProfessionsAdminPanelProps) {
  const [classes, setClasses] = useState<SchoolClassRecord[]>([]);
  const [branches, setBranches] = useState<SchoolBranchRecord[]>([]);
  const [professions, setProfessions] = useState<SchoolProfessionRecord[]>([]);
  const [contexts, setContexts] = useState<PedagogicalContextRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [durationYears, setDurationYears] = useState("3");
  const [showArchived, setShowArchived] = useState(false);
  const [editDraft, setEditDraft] = useState<ProfessionEditDraft | null>(null);
  const [assignDraft, setAssignDraft] = useState<YearAssignDraft>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const catalog = await fetchFullCatalog();
      setClasses(catalog.classes);
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

  const archivedCount = useMemo(
    () => professions.filter((entry) => entry.isArchived).length,
    [professions],
  );

  const visibleProfessions = useMemo(
    () => professions.filter((entry) => (showArchived ? entry.isArchived : !entry.isArchived)),
    [professions, showArchived],
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

  async function submitProfession(event: FormEvent) {
    event.preventDefault();
    setError("");
    const duration = Number.parseInt(durationYears, 10);
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "profession",
        label,
        durationYears: duration,
        sortOrder: professions.length + 1,
        isActive: true,
      }),
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Création impossible.");
      return;
    }
    setLabel("");
    setDurationYears("3");
    onNotice("Profession ajoutée au référentiel.");
    await refresh();
  }

  async function patchProfession(
    entry: SchoolProfessionRecord,
    patch: {
      label?: string;
      durationYears?: number;
      isActive?: boolean;
      isArchived?: boolean;
    },
  ) {
    setError("");
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "profession", ...patch }),
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Mise à jour impossible.");
      return false;
    }
    if (patch.isArchived === true) onNotice(`Profession « ${entry.label} » archivée.`);
    if (patch.isArchived === false) onNotice(`Profession « ${entry.label} » désarchivée.`);
    await refresh();
    return true;
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editDraft) return;
    const entry = professions.find((profession) => profession.id === editDraft.professionId);
    if (!entry) return;
    const nextLabel = editDraft.label.trim();
    const nextDuration = Number.parseInt(editDraft.durationYears, 10);
    if (!nextLabel) {
      setError("Le nom de la profession est requis.");
      return;
    }
    if (!Number.isInteger(nextDuration) || nextDuration < 1) {
      setError("La durée de formation doit être un entier ≥ 1.");
      return;
    }
    const ok = await patchProfession(entry, {
      label: nextLabel,
      durationYears: nextDuration,
    });
    if (!ok) return;
    onNotice(`Profession « ${nextLabel} » mise à jour.`);
    setEditDraft(null);
  }

  async function deleteProfession(entry: SchoolProfessionRecord) {
    const confirmed = window.confirm(
      `Supprimer définitivement la profession « ${entry.label} » (${entry.adminCode}) ?`,
    );
    if (!confirmed) return;
    setError("");
    const response = await fetch(`/api/admin/catalog/${entry.id}?kind=profession`, {
      method: "DELETE",
      credentials: "include",
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(
        (payload.reason ?? "Suppression impossible.") +
          " Vous pouvez archiver la profession à la place.",
      );
      return;
    }
    onNotice(`Profession « ${entry.label} » supprimée.`);
    await refresh();
  }

  async function assignBranch(professionId: string, trainingYear: number) {
    const key = yearKey(professionId, trainingYear);
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
        professionId,
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

  async function handleCopy(code: string) {
    const ok = await copyText(code);
    onNotice(ok ? `Code ${code} copié.` : `Impossible de copier ${code}.`);
  }

  function contextsForYear(professionId: string, year: number, includeArchived = false) {
    return contexts.filter(
      (entry) =>
        entry.professionId === professionId &&
        entry.trainingYear === year &&
        (includeArchived || !entry.isArchived),
    );
  }

  if (loading) {
    return <p className="admin-loading">Chargement…</p>;
  }

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Professions et branches</h3>
          <p>
            Définissez les professions, leur durée, puis rattachez les branches par année de
            formation. Les codes PRF / CTX sont stables et peuvent être copiés pour le support.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <form className="admin-inline-form" onSubmit={(event) => void submitProfession(event)}>
        <label>
          Nom de la profession
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Informaticien-ne"
            required
          />
        </label>
        <label>
          Durée (années)
          <input
            type="number"
            min={1}
            max={10}
            value={durationYears}
            onChange={(event) => setDurationYears(event.target.value)}
            required
          />
        </label>
        <button type="submit" className="workspace-action">
          Ajouter
        </button>
      </form>

      <div className="admin-teacher-toolbar">
        <button
          type="button"
          className={!showArchived ? "is-selected" : undefined}
          onClick={() => setShowArchived(false)}
        >
          Professions ({professions.length - archivedCount})
        </button>
        <button
          type="button"
          className={showArchived ? "is-selected" : undefined}
          onClick={() => setShowArchived(true)}
        >
          Archives ({archivedCount})
        </button>
      </div>

      {visibleProfessions.length === 0 ? (
        <p className="admin-loading">
          {showArchived ? "Aucune profession archivée." : "Aucune profession dans cette liste."}
        </p>
      ) : (
        <ul className="admin-teacher-access-list">
          {visibleProfessions.map((entry) => {
            const editing = editDraft?.professionId === entry.id;
            const years = trainingYearsForDuration(entry.durationYears);
            const linkedClassCount = classes.filter(
              (schoolClass) => schoolClass.professionId === entry.id,
            ).length;
            return (
              <li key={entry.id} className={`${professionCardClass(entry)} admin-profession-card`}>
                <div className="admin-teacher-identity">
                  <strong className="admin-teacher-initials">
                    {entry.label.slice(0, 3).toUpperCase()}
                  </strong>
                  {editing && editDraft ? (
                    <form
                      className="admin-teacher-edit-form"
                      onSubmit={(event) => void saveEdit(event)}
                    >
                      <label>
                        Nom
                        <input
                          value={editDraft.label}
                          onChange={(event) =>
                            setEditDraft({ ...editDraft, label: event.target.value })
                          }
                          required
                        />
                      </label>
                      <label>
                        Durée (années)
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={editDraft.durationYears}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              durationYears: event.target.value,
                            })
                          }
                          required
                        />
                      </label>
                      <div className="admin-teacher-edit-actions">
                        <button type="submit">Enregistrer</button>
                        <button type="button" onClick={() => setEditDraft(null)}>
                          Annuler
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div>
                      <p className="admin-teacher-name">{entry.label}</p>
                      <p className="admin-teacher-login-meta">
                        {entry.durationYears} an{entry.durationYears > 1 ? "s" : ""} de formation
                        {linkedClassCount > 0
                          ? ` · ${linkedClassCount} classe${linkedClassCount > 1 ? "s" : ""}`
                          : ""}
                      </p>
                      <div className="admin-code-row">
                        <span className="admin-admin-code" title="Code administratif">
                          {entry.adminCode}
                        </span>
                        <button
                          type="button"
                          className="admin-code-copy"
                          onClick={() => void handleCopy(entry.adminCode)}
                        >
                          Copier
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="admin-teacher-badges" aria-label="État de la profession">
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
                        setEditDraft({
                          professionId: entry.id,
                          label: entry.label,
                          durationYears: String(entry.durationYears),
                        })
                      }
                    >
                      Modifier
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={entry.isArchived}
                    onClick={() => void patchProfession(entry, { isActive: !entry.isActive })}
                  >
                    {entry.isActive ? "Désactiver" : "Réactiver"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void patchProfession(entry, { isArchived: !entry.isArchived })}
                  >
                    {entry.isArchived ? "Désarchiver" : "Archiver"}
                  </button>
                  <button type="button" onClick={() => void deleteProfession(entry)}>
                    Supprimer
                  </button>
                </div>

                {!entry.isArchived ? (
                  <div className="admin-profession-years">
                    {years.map((year) => {
                      const yearContexts = contextsForYear(entry.id, year);
                      const key = yearKey(entry.id, year);
                      const assignedIds = new Set(yearContexts.map((ctx) => ctx.branchId));
                      const availableBranches = assignableBranches.filter(
                        (branch) => !assignedIds.has(branch.id),
                      );
                      return (
                        <div key={key} className="admin-profession-year">
                          <div className="admin-profession-year-header">
                            <strong>Année {year}</strong>
                            <span>
                              {yearContexts.length} branche
                              {yearContexts.length > 1 ? "s" : ""}
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
                                      </span>
                                      <span className="admin-admin-code">{context.adminCode}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void removeContext(context)}
                                    >
                                      Retirer
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          <div className="admin-profession-assign">
                            <label>
                              Affecter une branche
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
                                    {branch.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              disabled={!assignDraft[key]}
                              onClick={() => void assignBranch(entry.id, year)}
                            >
                              Affecter
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
