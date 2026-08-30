"use client";

import { FormEvent, useMemo, useState } from "react";

import type {
  PedagogicalContextRecord,
  SchoolClassRecord,
  SchoolProfessionRecord,
} from "@campus/features/school-catalog";
import {
  buildStructuredClassBatch,
  countActiveContextsForYear,
  defaultParallelCodes,
  formatProfessionOptionLabel,
  formatTrainingYearLabel,
  listSelectableSchoolYearsForNewClass,
  trainingYearsForDuration,
} from "@campus/features/school-catalog";
import type { SchoolYearSummary } from "../../lib/api-client.ts";

interface ClassCreationWizardProps {
  classes: SchoolClassRecord[];
  professions: SchoolProfessionRecord[];
  contexts: PedagogicalContextRecord[];
  schoolYears: SchoolYearSummary[];
  onNotice: (message: string) => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
  onOpenPlans: () => void;
}

export function ClassCreationWizard({
  classes,
  professions,
  contexts,
  schoolYears,
  onNotice,
  onCreated,
  onError,
  onOpenPlans,
}: ClassCreationWizardProps) {
  const [schoolYearId, setSchoolYearId] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [trainingYear, setTrainingYear] = useState("");
  const [organization, setOrganization] = useState<"unique" | "parallel">("unique");
  const [parallelCount, setParallelCount] = useState("3");
  const [parallelCodes, setParallelCodes] = useState<string[]>(defaultParallelCodes(3));
  const [busy, setBusy] = useState(false);

  const selectableYears = useMemo(
    () => listSelectableSchoolYearsForNewClass(schoolYears),
    [schoolYears],
  );

  const activeProfessions = useMemo(
    () => professions.filter((entry) => entry.isActive && !entry.isArchived),
    [professions],
  );

  const selectedProfession = useMemo(
    () => professions.find((entry) => entry.id === professionId) ?? null,
    [professionId, professions],
  );

  const yearOptions = selectedProfession
    ? trainingYearsForDuration(selectedProfession.durationYears)
    : [];

  const plannedCount =
    selectedProfession && trainingYear
      ? countActiveContextsForYear({
          professionId: selectedProfession.id,
          trainingYear: Number.parseInt(trainingYear, 10),
          contexts,
        })
      : 0;

  const drafts = useMemo(() => {
    if (!selectedProfession?.classCodePrefix || !trainingYear) return [];
    const codes = organization === "unique" ? [null] : parallelCodes;
    const built = buildStructuredClassBatch({
      prefix: selectedProfession.classCodePrefix,
      trainingYear: Number.parseInt(trainingYear, 10),
      parallelCodes: codes,
    });
    return built.ok ? built.value : [];
  }, [organization, parallelCodes, selectedProfession, trainingYear]);

  function changeParallelCount(nextCount: string) {
    setParallelCount(nextCount);
    const count = Number.parseInt(nextCount, 10);
    if (!Number.isInteger(count) || count < 2) return;
    setParallelCodes(defaultParallelCodes(count));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!schoolYearId || !professionId || !trainingYear) {
      onError("Année scolaire, profession et année de formation sont obligatoires.");
      return;
    }
    if (!selectedProfession?.classCodePrefix) {
      onError("Configurez d’abord l’abréviation de cette profession dans l’onglet Professions.");
      return;
    }
    if (plannedCount === 0) {
      onError(
        "Aucune branche n’est encore définie pour cette année de formation. Configurez d’abord le plan de formation.",
      );
      return;
    }
    setBusy(true);
    const response = await fetch("/api/admin/catalog", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "structured-classes",
        schoolYearId,
        professionId,
        trainingYear: Number.parseInt(trainingYear, 10),
        organization,
        parallelCodes: organization === "parallel" ? parallelCodes : undefined,
        sortOrder: classes.length + 1,
      }),
    });
    const payload = (await response.json()) as { ok: boolean; reason?: string; classes?: SchoolClassRecord[] };
    setBusy(false);
    if (!response.ok || !payload.ok) {
      onError(payload.reason ?? "Création impossible.");
      return;
    }
    const created = payload.classes ?? [];
    onNotice(
      created.length > 1
        ? `${created.length} classes créées (${created.map((entry) => entry.code).join(", ")}).`
        : `Classe ${created[0]?.code ?? ""} créée.`,
    );
    setSchoolYearId("");
    setProfessionId("");
    setTrainingYear("");
    setOrganization("unique");
    setParallelCount("3");
    setParallelCodes(defaultParallelCodes(3));
    await onCreated();
  }

  return (
    <form className="class-wizard" onSubmit={(event) => void submit(event)}>
      <h3>Créer une ou plusieurs classes</h3>
      <p className="class-wizard-lead">
        Les classes exploitent le référentiel déjà configuré. Les branches ne se choisissent pas ici :
        elles viennent du plan de formation.
      </p>

      <section className="class-wizard-section">
        <h4>1. Informations générales</h4>
        <div className="class-wizard-grid">
          <label>
            Année scolaire
            <select
              value={schoolYearId}
              onChange={(event) => setSchoolYearId(event.target.value)}
              required
            >
              <option value="">Choisir…</option>
              {selectableYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                  {year.status === "active" ? " (active)" : year.status === "draft" ? " (brouillon)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Profession
            <select
              value={professionId}
              onChange={(event) => {
                setProfessionId(event.target.value);
                setTrainingYear("");
              }}
              required
            >
              <option value="">Choisir…</option>
              {activeProfessions.map((profession) => (
                <option key={profession.id} value={profession.id}>
                  {formatProfessionOptionLabel(profession)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Année de formation
            <select
              value={trainingYear}
              onChange={(event) => setTrainingYear(event.target.value)}
              disabled={!professionId}
              required
            >
              <option value="">{professionId ? "Choisir…" : "Choisir d’abord une profession"}</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{formatTrainingYearLabel(year)}</option>
              ))}
            </select>
          </label>
        </div>
        {selectedProfession && !selectedProfession.classCodePrefix ? (
          <p className="admin-class-config-warn">
            Configurez d’abord l’abréviation de cette profession dans l’onglet Professions.
          </p>
        ) : null}
      </section>

      <section className="class-wizard-section">
        <h4>2. Organisation des classes</h4>
        <p className="class-wizard-hint">
          Les classes parallèles partagent le même plan de formation, mais leurs cours,
          publications et notes restent séparés.
        </p>
        <div className="class-wizard-org" role="radiogroup" aria-label="Organisation">
          <label className={organization === "unique" ? "is-selected" : undefined}>
            <input
              type="radio"
              name="class-org"
              checked={organization === "unique"}
              onChange={() => setOrganization("unique")}
            />
            <span>
              <strong>Classe unique</strong>
              <em>Un seul groupe, sans lettre A/B/C.</em>
            </span>
          </label>
          <label className={organization === "parallel" ? "is-selected" : undefined}>
            <input
              type="radio"
              name="class-org"
              checked={organization === "parallel"}
              onChange={() => setOrganization("parallel")}
            />
            <span>
              <strong>Classes parallèles</strong>
              <em>Plusieurs groupes qui partagent le même CTX.</em>
            </span>
          </label>
        </div>
        {organization === "parallel" ? (
          <div className="class-wizard-groups">
            <label>
              Nombre de classes
              <input
                type="number"
                min={2}
                max={26}
                value={parallelCount}
                onChange={(event) => changeParallelCount(event.target.value)}
              />
            </label>
            <div className="class-wizard-group-list">
              {parallelCodes.map((code, index) => (
                <label key={`${code}-${index}`}>
                  Groupe {index + 1}
                  <input
                    value={code}
                    onChange={(event) => {
                      const next = parallelCodes.slice();
                      next[index] = event.target.value;
                      setParallelCodes(next);
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="class-wizard-section">
        <h4>3. Aperçu avant création</h4>
        {drafts.length === 0 ? (
          <p className="admin-loading">Complétez les informations pour voir les classes à créer.</p>
        ) : (
          <>
            <p className="class-wizard-plan">
              Plan de formation :{" "}
              {plannedCount > 0
                ? `${plannedCount} branche${plannedCount > 1 ? "s" : ""}`
                : "aucune branche définie"}
            </p>
            {plannedCount === 0 ? (
              <p className="admin-class-config-warn">
                Aucune branche n’est encore définie pour cette année de formation.
                <button type="button" className="admin-link-button" onClick={onOpenPlans}>
                  Configurez d’abord le plan de formation
                </button>
              </p>
            ) : null}
            <ul className="class-wizard-preview">
              {drafts.map((draft) => (
                <li key={draft.code}>
                  <strong>
                    {draft.parallelCode ? `[${draft.parallelCode}] ` : ""}
                    {draft.code}
                  </strong>
                  <span>{selectedProfession?.label}</span>
                  <span>{formatTrainingYearLabel(Number.parseInt(trainingYear, 10))}</span>
                  <span>{draft.parallelCode ? `Groupe ${draft.parallelCode}` : "Classe unique"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="submit"
          className="workspace-action"
          disabled={
            busy ||
            drafts.length === 0 ||
            !selectedProfession?.classCodePrefix ||
            plannedCount === 0
          }
        >
          {drafts.length > 1 ? "Créer les classes" : "Créer la classe"}
        </button>
      </section>
    </form>
  );
}
