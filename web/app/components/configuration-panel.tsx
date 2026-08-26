"use client";

import { useMemo, useState } from "react";

import type { SchoolWeek } from "@campus/features/calendar";
import {
  createEmptyClassSetup,
  formatBranchInput,
  normalizeTeacherSetup,
  parseBranchInput,
  WEEKDAY_LABELS,
  type TeacherClassSetup,
  type TeacherSetupConfig,
  type WeekdayIndex,
} from "@campus/features/teacher-setup";
import { MaSemaineWeekPlanPreview } from "./ma-semaine-panel.tsx";

interface ConfigurationPanelProps {
  config: TeacherSetupConfig;
  schoolWeeks: SchoolWeek[];
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
  schoolWeeks,
  onChange,
  onReset,
  onNotice,
}: ConfigurationPanelProps) {
  const [showWeekPlan, setShowWeekPlan] = useState(true);
  const classCount = useMemo(
    () => config.classes.filter((entry) => entry.name.trim()).length,
    [config.classes],
  );

  function commit(next: TeacherSetupConfig) {
    onChange(normalizeTeacherSetup(next));
  }

  function patchClass(classId: string, patch: Partial<TeacherClassSetup>) {
    commit({ ...config, classes: updateClass(config.classes, classId, patch) });
  }

  function addClass() {
    commit({
      ...config,
      classes: [...config.classes, createEmptyClassSetup(config.classes.length)],
    });
    onNotice("Nouvelle classe ajoutée.");
  }

  function removeClass(classId: string) {
    commit({ ...config, classes: config.classes.filter((entry) => entry.id !== classId) });
    onNotice("Classe retirée.");
  }

  return (
    <section className="teacher-workspace" aria-label="Configuration">
      <div className="workspace-intro">
        <p className="eyebrow">PARAMÈTRES DE BASE</p>
        <h2>Configuration</h2>
        <p>
          Saisissez vos classes, le jour de cours, les branches enseignées, puis vérifiez le plan des semaines A
          et B.
        </p>
        <div className="config-summary-row">
          <span>
            <strong>{classCount}</strong> classe{classCount > 1 ? "s" : ""} active{classCount > 1 ? "s" : ""}
          </span>
          <button type="button" className="workspace-action secondary" onClick={onReset}>
            Réinitialiser depuis le catalogue
          </button>
        </div>
      </div>

      <div className="config-classes-editor" aria-label="Classes et branches">
        <header className="config-section-header">
          <h3>Mes classes</h3>
          <button type="button" className="workspace-action" onClick={addClass}>
            ＋ Ajouter une classe
          </button>
        </header>

        <div className="config-class-list">
          {config.classes.map((entry) => (
            <article className="config-class-row" key={entry.id}>
              <label className="config-field config-field-icon">
                <span>Icône</span>
                <input
                  value={entry.icon}
                  maxLength={2}
                  onChange={(event) => patchClass(entry.id, { icon: event.target.value || "🔧" })}
                />
              </label>

              <label className="config-field">
                <span>Nom de la classe</span>
                <input
                  value={entry.name}
                  placeholder="Ex. MA2, MMA3A…"
                  onChange={(event) => patchClass(entry.id, { name: event.target.value })}
                />
              </label>

              <label className="config-field">
                <span>Filière</span>
                <input
                  value={entry.programLabel}
                  onChange={(event) => patchClass(entry.id, { programLabel: event.target.value })}
                />
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

              <label className="config-field config-field-wide">
                <span>Branches (séparées par des virgules)</span>
                <input
                  value={formatBranchInput(entry.branchNames)}
                  placeholder="Ex. Con. Prof I, BG"
                  onChange={(event) =>
                    patchClass(entry.id, { branchNames: parseBranchInput(event.target.value) })
                  }
                />
              </label>

              <button
                type="button"
                className="config-remove-class"
                onClick={() => removeClass(entry.id)}
                aria-label={`Retirer ${entry.name || "cette classe"}`}
              >
                Retirer
              </button>
            </article>
          ))}
        </div>
      </div>

      <div className="config-week-plan" aria-label="Plan des semaines A et B">
        <header className="config-section-header">
          <div>
            <h3>Plan des semaines A et B</h3>
            <p>Vérifiez la succession A/B et les jours de cours TMA (lundi en semaine A, lundi + jeudi en B).</p>
          </div>
          <button
            type="button"
            className="workspace-action secondary"
            onClick={() => setShowWeekPlan((current) => !current)}
          >
            {showWeekPlan ? "Masquer" : "Afficher"}
          </button>
        </header>
        {showWeekPlan && <MaSemaineWeekPlanPreview schoolWeeks={schoolWeeks} />}
      </div>
    </section>
  );
}
