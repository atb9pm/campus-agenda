"use client";

import {
  NOTEBOOK_WEEK_COUNT_OPTIONS,
  notebookWeekCountPreference,
  withNotebookWeekCount,
  type TeacherSetupConfig,
} from "@campus/features/teacher-setup";

interface ConfigurationPanelProps {
  config: TeacherSetupConfig;
  onChange: (config: TeacherSetupConfig) => void;
}

export function ConfigurationPanel({ config, onChange }: ConfigurationPanelProps) {
  const notebookWeekCount = notebookWeekCountPreference(config);

  return (
    <section className="teacher-workspace" aria-label="Préférences">
      <div className="workspace-intro">
        <p className="eyebrow">PARAMÈTRES PERSONNELS</p>
        <h2>Préférences</h2>
        <p>
          Réglages d’affichage qui ne concernent que vous. Les jours de cours et les attributions
          sont gérés dans l’administration.
        </p>
      </div>

      <div className="config-classes-editor" aria-label="Préférences du carnet">
        <header className="config-section-header">
          <div>
            <h3>Carnet</h3>
            <p>
              Nombre de semaines affichées à l’ouverture du carnet. Vous pouvez toujours changer
              l’affichage dans le carnet. Sur smartphone, le carnet affiche une semaine.
            </p>
          </div>
        </header>

        <fieldset className="config-choice-group">
          <legend>Semaines affichées par défaut</legend>
          {NOTEBOOK_WEEK_COUNT_OPTIONS.map((count) => (
            <label key={count}>
              <input
                type="radio"
                name="notebook-week-count"
                value={count}
                checked={notebookWeekCount === count}
                onChange={() => onChange(withNotebookWeekCount(config, count))}
              />
              {count} semaine{count > 1 ? "s" : ""}
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}
