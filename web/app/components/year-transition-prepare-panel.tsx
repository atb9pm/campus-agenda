"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyYearTransitionApi,
  createYearTransitionPreviewApi,
  fetchYearTransitionPrepare,
  type YearTransitionClassOption,
  type YearTransitionPresentedPreview,
  type YearTransitionPresentedRow,
  type YearTransitionYearOption,
} from "../../lib/api-client.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";

interface YearTransitionPreparePanelProps {
  onNotice: (message: string) => void;
  onOpenTargetCourse?: (target: {
    schoolYearId: string;
    annualCourseId: string;
    classId: string;
    courseLabel: string;
    classLabel: string;
  }) => void;
}

type Step = "years" | "mappings" | "options" | "preview" | "result";

const NO_CONTINUATION = "__none__";
const UNSET = "";

function yearCaption(year: YearTransitionYearOption | null): string {
  if (!year) return "Non choisie";
  return `${year.displayLabel} (${year.statusLabel})`;
}

function RowList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: YearTransitionPresentedRow[];
  empty: string;
}) {
  return (
    <article className="school-year-card">
      <header>
        <span className="eyebrow">{title}</span>
        <h3>{rows.length}</h3>
      </header>
      {rows.length === 0 ? (
        <p className="school-year-hint">{empty}</p>
      ) : (
        <ul className="year-transition-rows">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.title}</strong>
              <span>{row.reasonLabel}</span>
              {row.sourceCourseLabel ? <span>{row.sourceCourseLabel}</span> : null}
              {row.targetCourseLabel ? <span>Cible : {row.targetCourseLabel}</span> : null}
              {row.sessionLabel ? <span>{row.sessionLabel}</span> : null}
              <em>{row.explanation}</em>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function YearTransitionPreparePanel({
  onNotice,
  onOpenTargetCourse,
}: YearTransitionPreparePanelProps) {
  const [step, setStep] = useState<Step>("years");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [years, setYears] = useState<YearTransitionYearOption[]>([]);
  const [classesByYearId, setClassesByYearId] = useState<Record<string, YearTransitionClassOption[]>>({});
  const [sourceYearId, setSourceYearId] = useState("");
  const [targetYearId, setTargetYearId] = useState("");
  const [targetsBySource, setTargetsBySource] = useState<Record<string, string>>({});
  const [includePrivateNotes, setIncludePrivateNotes] = useState(false);
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<YearTransitionPresentedPreview | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{
    code: string;
    codeLabel: string;
    createdCount?: number;
    alreadyPresentCount?: number;
    skippedCount?: number;
    notes?: { createdCount: number; alreadyPresentCount: number; skippedCount: number };
    targetCourses: YearTransitionPresentedPreview["targetCourses"];
  } | null>(null);

  const sourceYear = years.find((year) => year.id === sourceYearId) ?? null;
  const targetYear = years.find((year) => year.id === targetYearId) ?? null;
  const sourceClasses = useMemo(() => classesByYearId[sourceYearId] ?? [], [classesByYearId, sourceYearId]);
  const targetClasses = useMemo(() => classesByYearId[targetYearId] ?? [], [classesByYearId, targetYearId]);
  const draftYears = years.filter((year) => year.status === "draft");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchYearTransitionPrepare();
      setYears(payload.years);
      setClassesByYearId(payload.classesByYearId);
      const active = payload.years.find((year) => year.status === "active");
      const draft = payload.years.find((year) => year.status === "draft");
      setSourceYearId((current) => current || active?.id || "");
      setTargetYearId((current) => current || draft?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  function invalidatePreview() {
    setTransitionId(null);
    setPreview(null);
    setBlocking(false);
    setResult(null);
    if (step === "preview" || step === "result") setStep("options");
  }

  const classMappings = sourceClasses.map((source) => {
    const chosen = targetsBySource[source.id] ?? UNSET;
    return {
      sourceClassId: source.id,
      targetClassId: chosen === NO_CONTINUATION ? null : chosen || null,
    };
  });

  const missingMappings = sourceClasses.filter((source) => !targetsBySource[source.id]);

  async function handlePreview() {
    if (!sourceYearId || !targetYearId) return;
    setWorking(true);
    setError("");
    try {
      const created = await createYearTransitionPreviewApi({
        sourceSchoolYearId: sourceYearId,
        targetSchoolYearId: targetYearId,
        classMappings,
        includePrivateNotes,
      });
      setTransitionId(created.transitionId);
      setPreview(created.preview);
      setBlocking(created.blocking);
      setResult(null);
      setStep("preview");
      onNotice("Aperçu calculé. Aucune copie n’a encore été faite.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Aperçu impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleApply() {
    if (!transitionId || blocking) return;
    setWorking(true);
    setError("");
    setConfirmOpen(false);
    try {
      const outcome = await applyYearTransitionApi(transitionId);
      setResult(outcome);
      setStep("result");
      onNotice(outcome.codeLabel);
      if (!outcome.ok) setError(outcome.reason ?? outcome.codeLabel);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Application impossible.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="school-year-admin year-transition-prepare" aria-labelledby="year-transition-title">
      <div className="workspace-intro">
        <p className="eyebrow">ANNÉE SCOLAIRE</p>
        <h2 id="year-transition-title">Préparer l’année suivante</h2>
        <p>
          Choisissez les années, les correspondances de classes et les éléments à reprendre, puis
          vérifiez un aperçu avant toute copie. L’année cible reste en brouillon.
        </p>
      </div>

      <p className="year-transition-selection" aria-live="polite">
        Source : <strong>{yearCaption(sourceYear)}</strong>
        {" · "}
        Cible : <strong>{yearCaption(targetYear)}</strong>
      </p>

      {loading ? <p className="school-year-status">Chargement…</p> : null}
      {error ? <p className="school-year-error" role="alert">{error}</p> : null}

      <nav className="year-transition-steps" aria-label="Étapes de préparation">
        {([
          ["years", "1. Années"],
          ["mappings", "2. Classes"],
          ["options", "3. Éléments"],
          ["preview", "4. Aperçu"],
          ["result", "5. Résultat"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={step === id ? "active" : undefined}
            onClick={() => setStep(id)}
            disabled={id === "preview" && !preview}
          >
            {label}
          </button>
        ))}
      </nav>

      {step === "years" ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Étape 1</span>
            <h3>Choisir les années</h3>
          </header>
          <div className="year-transition-year-grid">
            <label>
              Année source
              <select
                value={sourceYearId}
                onChange={(event) => {
                  setSourceYearId(event.target.value);
                  setTargetsBySource({});
                  invalidatePreview();
                }}
              >
                <option value="">Choisir…</option>
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.displayLabel} — {year.statusLabel}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Année cible (brouillon)
              <select
                value={targetYearId}
                onChange={(event) => {
                  setTargetYearId(event.target.value);
                  setTargetsBySource({});
                  invalidatePreview();
                }}
              >
                <option value="">Choisir…</option>
                {draftYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.displayLabel} — {year.statusLabel}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {targetYear && targetYear.status !== "draft" ? (
            <p className="school-year-error">L’année cible doit rester en brouillon.</p>
          ) : null}
          {draftYears.length === 0 ? (
            <p className="school-year-hint">Créez d’abord une année future en brouillon (onglet Année scolaire).</p>
          ) : null}
          <button
            type="button"
            className="workspace-action"
            disabled={!sourceYearId || !targetYearId || sourceYearId === targetYearId}
            onClick={() => setStep("mappings")}
          >
            Continuer
          </button>
        </article>
      ) : null}

      {step === "mappings" ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Étape 2</span>
            <h3>Correspondances de classes</h3>
          </header>
          <p className="school-year-hint">
            Chaque classe source doit avoir une cible explicite ou « Pas de continuation ».
            Campus Agenda n’invente aucune correspondance.
          </p>
          {sourceClasses.length === 0 ? (
            <p className="school-year-hint">Aucune classe dans l’année source.</p>
          ) : (
            <ul className="year-transition-mappings">
              {sourceClasses.map((source) => (
                <li key={source.id}>
                  <label>
                    {source.displayName}
                    <select
                      value={targetsBySource[source.id] ?? UNSET}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTargetsBySource((current) => ({ ...current, [source.id]: value }));
                        invalidatePreview();
                      }}
                    >
                      <option value={UNSET}>Choisir…</option>
                      <option value={NO_CONTINUATION}>Pas de continuation</option>
                      {targetClasses.map((target) => (
                        <option key={target.id} value={target.id}>{target.displayName}</option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {missingMappings.length > 0 ? (
            <p className="school-year-error">
              Correspondances manquantes : {missingMappings.map((entry) => entry.displayName).join(", ")}.
            </p>
          ) : null}
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("years")}>
              Retour
            </button>
            <button
              type="button"
              className="workspace-action"
              disabled={missingMappings.length > 0}
              onClick={() => setStep("options")}
            >
              Continuer
            </button>
          </div>
        </article>
      ) : null}

      {step === "options" ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Étape 3</span>
            <h3>Éléments à reprendre</h3>
          </header>
          <ul className="year-transition-capabilities">
            <li>
              <strong>Publications du Carnet</strong>
              <p>Toujours incluses : devoirs, contrôles et informations liés à une séance, via le parcours CTX.</p>
            </li>
            <li>
              <label className="year-transition-notes-option">
                <input
                  type="checkbox"
                  checked={includePrivateNotes}
                  onChange={(event) => {
                    setIncludePrivateNotes(event.target.checked);
                    invalidatePreview();
                  }}
                />
                Inclure mes notes privées
              </label>
              <p>
                Désactivé par défaut. Seules vos notes sont concernées. Le contenu n’est pas affiché ici.
                Les notes sans référence pédagogique restent dans l’année source.
              </p>
            </li>
          </ul>
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("mappings")}>
              Retour
            </button>
            <button type="button" className="workspace-action" disabled={working} onClick={() => void handlePreview()}>
              {working ? "Calcul…" : "Calculer l’aperçu"}
            </button>
          </div>
        </article>
      ) : null}

      {step === "preview" && preview ? (
        <>
          {preview.mappingIssues.length > 0 ? (
            <article className="school-year-card">
              <header>
                <span className="eyebrow">Correspondances</span>
                <h3>À corriger</h3>
              </header>
              <ul className="year-transition-rows">
                {preview.mappingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </article>
          ) : null}
          <RowList title="Publications transférables" rows={preview.publications.projectable} empty="Aucune publication transférable." />
          <RowList title="Déjà présentes" rows={preview.publications.alreadyPresent} empty="Aucune publication déjà présente." />
          <RowList title="Non transférées" rows={preview.publications.excluded} empty="Aucune publication exclue." />
          <RowList title="Bloquantes" rows={preview.publications.blocking} empty="Aucun problème bloquant sur les publications." />
          {preview.notes ? (
            <>
              <RowList title="Notes transférables" rows={preview.notes.projectable} empty="Aucune note transférable." />
              <RowList title="Notes déjà présentes" rows={preview.notes.alreadyPresent} empty="Aucune note déjà copiée." />
              <RowList title="Notes non transférées" rows={preview.notes.excluded} empty="Aucune note exclue." />
              <RowList title="Notes bloquantes" rows={preview.notes.blocking} empty="Aucun conflit de notes." />
            </>
          ) : null}
          {blocking ? (
            <p className="school-year-error">
              Des problèmes bloquants empêchent l’application. Corrigez la préparation puis recalculez l’aperçu.
            </p>
          ) : (
            <p className="school-year-hint">Aucune copie n’a encore été faite. Vérifiez l’aperçu puis confirmez.</p>
          )}
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("options")}>
              Corriger
            </button>
            <button type="button" className="workspace-action secondary" disabled={working} onClick={() => void handlePreview()}>
              Recalculer l’aperçu
            </button>
            <button
              type="button"
              className="workspace-action"
              disabled={working || blocking || !transitionId}
              onClick={() => setConfirmOpen(true)}
            >
              Appliquer le transfert
            </button>
          </div>
        </>
      ) : null}

      {step === "result" && result ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Bilan</span>
            <h3>{result.codeLabel}</h3>
          </header>
          <p>
            Publications copiées : {result.createdCount ?? 0} · déjà présentes : {result.alreadyPresentCount ?? 0}
            {" · "}non transférées : {result.skippedCount ?? 0}
          </p>
          {result.notes ? (
            <p>
              Notes copiées : {result.notes.createdCount} · déjà présentes : {result.notes.alreadyPresentCount}
              {" · "}non transférées : {result.notes.skippedCount}
            </p>
          ) : null}
          <p className="school-year-hint">
            L’année {yearCaption(targetYear)} reste en brouillon. Elle n’a pas été activée.
          </p>
          {result.targetCourses.length > 0 ? (
            <ul className="year-transition-rows">
              {result.targetCourses.map((course) => (
                <li key={course.annualCourseId}>
                  <strong>{course.courseLabel}</strong>
                  <span>{course.classLabel}</span>
                  {onOpenTargetCourse ? (
                    <button
                      type="button"
                      className="workspace-action secondary"
                      onClick={() => onOpenTargetCourse(course)}
                    >
                      Ouvrir le Carnet cible
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Appliquer le transfert ?"
        body={`Les publications${includePrivateNotes ? " et vos notes privées" : ""} projetables de ${yearCaption(sourceYear)} seront copiées vers ${yearCaption(targetYear)}. L’opération est atomique : tout est validé ou rien n’est écrit. L’année cible restera en brouillon.`}
        confirmLabel="Confirmer l’application"
        cancelLabel="Annuler"
        onConfirm={() => void handleApply()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
