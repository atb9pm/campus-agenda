"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  formatProfessionPrefixBadge,
  type SchoolClassRecord,
  type SchoolProfessionRecord,
} from "@campus/features/school-catalog";

interface ProfessionsAdminPanelProps {
  onNotice: (message: string) => void;
}

interface ProfessionEditDraft {
  professionId: string;
  label: string;
  durationYears: string;
  classCodePrefix: string;
}

function professionCardClass(entry: SchoolProfessionRecord): string {
  if (entry.isArchived) return "admin-teacher-card is-archived";
  if (!entry.isActive) return "admin-teacher-card is-inactive";
  return "admin-teacher-card is-active";
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

async function fetchProfessionsCatalog() {
  const response = await fetch("/api/admin/catalog", { credentials: "include" });
  const payload = (await response.json()) as {
    ok: boolean;
    reason?: string;
    classes?: SchoolClassRecord[];
    professions?: SchoolProfessionRecord[];
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement du référentiel impossible.");
  }
  return {
    classes: payload.classes ?? [],
    professions: payload.professions ?? [],
  };
}

export function ProfessionsAdminPanel({ onNotice }: ProfessionsAdminPanelProps) {
  const [classes, setClasses] = useState<SchoolClassRecord[]>([]);
  const [professions, setProfessions] = useState<SchoolProfessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [classCodePrefix, setClassCodePrefix] = useState("");
  const [durationYears, setDurationYears] = useState("3");
  const [showArchived, setShowArchived] = useState(false);
  const [editDraft, setEditDraft] = useState<ProfessionEditDraft | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const catalog = await fetchProfessionsCatalog();
      setClasses(catalog.classes);
      setProfessions(catalog.professions);
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
        classCodePrefix,
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
    setClassCodePrefix("");
    setDurationYears("3");
    onNotice("Profession ajoutée au référentiel.");
    await refresh();
  }

  async function patchProfession(
    entry: SchoolProfessionRecord,
    patch: {
      label?: string;
      durationYears?: number;
      classCodePrefix?: string | null;
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
    const nextPrefix = editDraft.classCodePrefix.trim();
    if (!nextPrefix && !entry.classCodePrefix) {
      setError("L'abréviation des classes est obligatoire.");
      return;
    }
    const linkedClassCount = classes.filter((schoolClass) => schoolClass.professionId === entry.id).length;
    if (
      nextPrefix &&
      entry.classCodePrefix &&
      nextPrefix.toUpperCase().replace(/[^A-Z0-9]/g, "") !== entry.classCodePrefix &&
      linkedClassCount > 0
    ) {
      const confirmed = window.confirm(
        `Modifier l’abréviation n’a aucun effet sur les ${linkedClassCount} classe${linkedClassCount > 1 ? "s" : ""} déjà créée${linkedClassCount > 1 ? "s" : ""}. Le nouveau préfixe s’applique uniquement aux nouvelles classes. Continuer ?`,
      );
      if (!confirmed) return;
    }
    const ok = await patchProfession(entry, {
      label: nextLabel,
      durationYears: nextDuration,
      classCodePrefix: nextPrefix || entry.classCodePrefix,
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

  async function handleCopy(code: string) {
    const ok = await copyText(code);
    onNotice(ok ? `Code ${code} copié.` : `Impossible de copier ${code}.`);
  }

  if (loading) {
    return <p className="admin-loading">Chargement…</p>;
  }

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>Professions</h3>
          <p>
            Catalogue des métiers. L’abréviation (MMA, MA) sert à générer les codes de classe.
            L’identifiant système (PRF-0001) n’est pas une abréviation métier.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      <form className="admin-inline-form" onSubmit={(event) => void submitProfession(event)}>
        <label>
          Nom officiel
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Mécanicien en maintenance"
            required
          />
        </label>
        <label>
          Abréviation des classes
          <input
            value={classCodePrefix}
            onChange={(event) => setClassCodePrefix(event.target.value)}
            placeholder="MMA"
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
            const linkedClassCount = classes.filter(
              (schoolClass) => schoolClass.professionId === entry.id,
            ).length;
            return (
              <li key={entry.id} className={`${professionCardClass(entry)} admin-profession-card`}>
                <div className="admin-teacher-identity">
                  <strong className="admin-teacher-initials is-class-prefix">
                    {formatProfessionPrefixBadge(entry.classCodePrefix, entry.label)}
                  </strong>
                  {editing && editDraft ? (
                    <form
                      className="admin-teacher-edit-form"
                      onSubmit={(event) => void saveEdit(event)}
                    >
                      <label>
                        Nom officiel
                        <input
                          value={editDraft.label}
                          onChange={(event) =>
                            setEditDraft({ ...editDraft, label: event.target.value })
                          }
                          required
                        />
                      </label>
                      <label>
                        Abréviation des classes
                        <input
                          value={editDraft.classCodePrefix}
                          onChange={(event) =>
                            setEditDraft({
                              ...editDraft,
                              classCodePrefix: event.target.value,
                            })
                          }
                          placeholder="MMA"
                          required={!entry.classCodePrefix}
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
                      {linkedClassCount > 0 ? (
                        <p className="admin-class-config-warn">
                          Modifier l’abréviation ne renomme pas les {linkedClassCount} classe
                          {linkedClassCount > 1 ? "s" : ""} déjà créée{linkedClassCount > 1 ? "s" : ""}.
                        </p>
                      ) : null}
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
                        Abréviation des classes :{" "}
                        {entry.classCodePrefix ?? "Abréviation à configurer"}
                        {" · "}
                        {entry.durationYears} an{entry.durationYears > 1 ? "s" : ""}
                        {linkedClassCount > 0
                          ? ` · ${linkedClassCount} classe${linkedClassCount > 1 ? "s" : ""}`
                          : ""}
                      </p>
                      <div className="admin-code-row">
                        <span className="admin-admin-code" title="Identifiant système">
                          Identifiant système : {entry.adminCode}
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
                  {!entry.classCodePrefix ? (
                    <span className="badge-status is-off">Abréviation à configurer</span>
                  ) : null}
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
                          classCodePrefix: entry.classCodePrefix ?? "",
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
