"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import type { SchoolBranchRecord, SchoolClassRecord } from "@campus/features/school-catalog";
import { SchoolYearAdminPanel } from "./school-year-admin-panel.tsx";
import type { SchoolCalendarWeek } from "../../lib/api-client.ts";

type AdminTab = "classes" | "branches" | "teachers" | "access" | "weeks";

interface AdministrationPanelProps {
  onCalendarUpdated: (weeks: SchoolCalendarWeek[]) => void;
  onNotice: (message: string) => void;
}

const TAB_LABELS: Record<AdminTab, string> = {
  classes: "Paramétrage des classes",
  branches: "Paramétrage des branches",
  teachers: "Gestion des enseignants",
  access: "Gestion des accès",
  weeks: "Plan des semaines A/B",
};

async function fetchCatalog(activeOnly = false) {
  const response = await fetch(`/api/admin/catalog${activeOnly ? "?active=1" : ""}`, {
    credentials: "include",
  });
  const payload = await response.json() as {
    ok: boolean;
    reason?: string;
    classes?: SchoolClassRecord[];
    branches?: SchoolBranchRecord[];
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.reason ?? "Chargement du référentiel impossible.");
  }
  return {
    classes: payload.classes ?? [],
    branches: payload.branches ?? [],
  };
}

export function AdministrationPanel({ onCalendarUpdated, onNotice }: AdministrationPanelProps) {
  const [tab, setTab] = useState<AdminTab>("classes");
  const [classes, setClasses] = useState<SchoolClassRecord[]>([]);
  const [branches, setBranches] = useState<SchoolBranchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classCode, setClassCode] = useState("");
  const [classLabel, setClassLabel] = useState("");
  const [branchLabel, setBranchLabel] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const catalog = await fetchCatalog(false);
      setClasses(catalog.classes);
      setBranches(catalog.branches);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      }),
    });
    const payload = await response.json() as { ok: boolean; reason?: string };
    if (!response.ok || !payload.ok) {
      setError(payload.reason ?? "Création impossible.");
      return;
    }
    setClassCode("");
    setClassLabel("");
    onNotice("Classe ajoutée au référentiel.");
    await refresh();
  }

  async function submitBranch(event: FormEvent) {
    event.preventDefault();
    const code = branchLabel
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
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

  async function toggleBranchActive(entry: SchoolBranchRecord) {
    const response = await fetch(`/api/admin/catalog/${entry.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "branch", isActive: !entry.isActive }),
    });
    if (!response.ok) {
      setError("Mise à jour impossible.");
      return;
    }
    await refresh();
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
      {loading ? <p className="admin-loading">Chargement…</p> : null}

      {tab === "classes" && !loading ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Paramétrage des classes</h3>
              <p>Liste officielle. Une classe inutilisée peut être désactivée (jamais supprimée).</p>
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
            <button type="submit" className="workspace-action">Ajouter</button>
          </form>
          <ul className="admin-catalog-list">
            {classes.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.code}</strong>
                <span>{entry.label}</span>
                <span className={entry.isActive ? "status-active" : "status-inactive"}>
                  {entry.isActive ? "Active" : "Inactive"}
                </span>
                <button type="button" onClick={() => void toggleClassActive(entry)}>
                  {entry.isActive ? "Désactiver" : "Réactiver"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "branches" && !loading ? (
        <div className="admin-panel-block">
          <header className="config-section-header">
            <div>
              <h3>Paramétrage des branches</h3>
              <p>Branches globales de l’école (Moteur, Électricité…).</p>
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
          <ul className="admin-catalog-list">
            {branches.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.label}</strong>
                <span>{entry.code}</span>
                <span className={entry.isActive ? "status-active" : "status-inactive"}>
                  {entry.isActive ? "Active" : "Inactive"}
                </span>
                <button type="button" onClick={() => void toggleBranchActive(entry)}>
                  {entry.isActive ? "Désactiver" : "Réactiver"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "teachers" ? (
        <div className="admin-panel-block">
          <h3>Gestion des enseignants</h3>
          <p className="admin-placeholder">Prochaine étape : création des comptes enseignant (nom, e-mail, statut).</p>
        </div>
      ) : null}

      {tab === "access" ? (
        <div className="admin-panel-block">
          <h3>Gestion des accès</h3>
          <p className="admin-placeholder">
            Prochaine étape : attribution des rôles Administrateur / Enseignant (contrôle serveur déjà en place).
          </p>
        </div>
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
