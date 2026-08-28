"use client";

import { useEffect, useMemo, useState } from "react";

import type { SchoolBranchRecord, SchoolClassRecord } from "@campus/features/school-catalog";
import {
  createEmptyClassSetup,
  WEEKDAY_LABELS,
  type TeacherClassSetup,
  type TeacherSetupConfig,
  type WeekdayIndex,
} from "@campus/features/teacher-setup";

interface ConfigurationPanelProps {
  config: TeacherSetupConfig;
  onChange: (config: TeacherSetupConfig) => void;
  onReset: () => void;
  onNotice: (message: string) => void;
}

function updateClass(
  classes: TeacherClassSetup[],
  classId: string,
  patch: Partial<TeacherClassSetup>,
): TeacherClassSetup[] {
  return classes.map((entry) => (entry.id === classId ? { ...entry, ...patch } : entry));
}

export function ConfigurationPanel({
  config,
  onChange,
  onReset,
  onNotice,
}: ConfigurationPanelProps) {
  const [schoolClasses, setSchoolClasses] = useState<SchoolClassRecord[]>([]);
  const [schoolBranches, setSchoolBranches] = useState<SchoolBranchRecord[]>([]);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/catalog?active=1", { credentials: "include" });
        const payload = await response.json() as {
          ok: boolean;
          reason?: string;
          classes?: SchoolClassRecord[];
          branches?: SchoolBranchRecord[];
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.reason ?? "Référentiel indisponible.");
        }
        if (!cancelled) {
          setSchoolClasses(payload.classes ?? []);
          setSchoolBranches(payload.branches ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : "Référentiel indisponible.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const classCount = useMemo(
    () => config.classes.filter((entry) => entry.name.trim()).length,
    [config.classes],
  );

  function patchClass(classId: string, patch: Partial<TeacherClassSetup>) {
    onChange({ ...config, classes: updateClass(config.classes, classId, patch) });
  }

  function addClass() {
    const firstClass = schoolClasses[0];
    const firstBranch = schoolBranches[0];
    const next = createEmptyClassSetup(config.classes.length);
    onChange({
      ...config,
      classes: [
        ...config.classes,
        {
          ...next,
          name: firstClass?.code ?? "",
          programLabel: "",
          icon: "•",
          branchNames: firstBranch ? [firstBranch.label] : [],
        },
      ],
    });
    onNotice("Nouvelle affectation ajoutée.");
  }

  function removeClass(classId: string) {
    onChange({ ...config, classes: config.classes.filter((entry) => entry.id !== classId) });
    onNotice("Affectation retirée.");
  }

  return (
    <section className="teacher-workspace" aria-label="Configuration">
      <div className="workspace-intro">
        <p className="eyebrow">PARAMÈTRES PERSONNELS</p>
        <h2>Configuration</h2>
        <p>Choisissez vos affectations dans le référentiel école : classe, jour de cours et branche.</p>
        <div className="config-summary-row">
          <span>
            <strong>{classCount}</strong> affectation{classCount > 1 ? "s" : ""}
          </span>
          <button type="button" className="workspace-action secondary" onClick={onReset}>
            Réinitialiser depuis le catalogue
          </button>
        </div>
        {catalogError ? <p className="admin-error">{catalogError}</p> : null}
      </div>

      <div className="config-classes-editor" aria-label="Affectations">
        <header className="config-section-header">
          <h3>Mes affectations</h3>
          <button type="button" className="workspace-action" onClick={addClass}>
            ＋ Ajouter une classe
          </button>
        </header>

        <div className="config-class-list">
          {config.classes.map((entry) => (
            <article className="config-class-row config-class-row-simple" key={entry.id}>
              <label className="config-field">
                <span>Nom de la classe</span>
                <select
                  value={entry.name}
                  onChange={(event) =>
                    patchClass(entry.id, {
                      name: event.target.value,
                      programLabel: "",
                      icon: "•",
                    })
                  }
                >
                  <option value="">Choisir…</option>
                  {schoolClasses.map((schoolClass) => (
                    <option key={schoolClass.id} value={schoolClass.code}>
                      {schoolClass.code}
                    </option>
                  ))}
                  {entry.name && !schoolClasses.some((schoolClass) => schoolClass.code === entry.name) ? (
                    <option value={entry.name}>{entry.name} (ancien)</option>
                  ) : null}
                </select>
              </label>

              <label className="config-field">
                <span>Jour de cours</span>
                <select
                  value={entry.dayOfWeek}
                  onChange={(event) =>
                    patchClass(entry.id, { dayOfWeek: Number(event.target.value) as WeekdayIndex })
                  }
                >
                  {(Object.entries(WEEKDAY_LABELS) as Array<[string, string]>).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="config-field">
                <span>Branche</span>
                <select
                  value={entry.branchNames[0] ?? ""}
                  onChange={(event) =>
                    patchClass(entry.id, {
                      branchNames: event.target.value ? [event.target.value] : [],
                    })
                  }
                >
                  <option value="">Choisir…</option>
                  {schoolBranches.map((branch) => (
                    <option key={branch.id} value={branch.label}>
                      {branch.label}
                    </option>
                  ))}
                  {entry.branchNames[0] &&
                  !schoolBranches.some((branch) => branch.label === entry.branchNames[0]) ? (
                    <option value={entry.branchNames[0]}>{entry.branchNames[0]} (ancien)</option>
                  ) : null}
                </select>
              </label>

              <button
                type="button"
                className="config-remove-class"
                onClick={() => removeClass(entry.id)}
                aria-label={`Retirer ${entry.name || "cette affectation"}`}
              >
                Retirer
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
