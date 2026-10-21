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
  onConsultPreparedYear?: (schoolYearId: string) => void;
  onOpenTargetCourse?: (target: {
    schoolYearId: string;
    annualCourseId: string;
    classId: string;
    courseLabel: string;
    classLabel: string;
  }) => void;
}

type Step = "years" | "classes" | "options" | "preview" | "result";

function yearCaption(year: YearTransitionYearOption | null): string {
  if (!year) return "Non choisie";
  return `${year.displayLabel} (${year.statusLabel})`;
}

function classIdentityLabel(entry: YearTransitionClassOption): string {
  const profession = entry.professionLabel?.trim() || entry.label || entry.code;
  const training =
    entry.trainingYear === 1
      ? "Première année"
      : entry.trainingYear != null
        ? `${entry.trainingYear}e année`
        : "Année de formation non renseignée";
  const group = entry.parallelCode?.trim() || "sans groupe";
  return `${profession} — ${training} — ${group}`;
}

function PreviewRows({ rows }: { rows: YearTransitionPresentedRow[] }) {
  if (rows.length === 0) {
    return <p className="school-year-hint">Aucun élément dans ce détail.</p>;
  }
  return (
    <ul className="year-transition-rows">
      {rows.map((row) => (
        <li key={row.id}>
          <strong>{row.title}</strong>
          <span>{row.reasonLabel}</span>
          {row.sourceCourseLabel ? <span>Cours : {row.sourceCourseLabel}</span> : null}
          {row.targetCourseLabel ? <span>Cible : {row.targetCourseLabel}</span> : null}
          {row.sourceSessionLabel ? <span>{row.sourceSessionLabel}</span> : null}
          {row.sessionLabel ? <span>{row.sessionLabel}</span> : null}
          {row.targetDurationLabel ? <span>{row.targetDurationLabel}</span> : null}
          <em>{row.explanation}</em>
        </li>
      ))}
    </ul>
  );
}

export function YearTransitionPreparePanel({
  onNotice,
  onConsultPreparedYear,
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
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [includePrivateNotes, setIncludePrivateNotes] = useState(false);
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<YearTransitionPresentedPreview | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exclusionsAcknowledged, setExclusionsAcknowledged] = useState(false);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const [appliedPreview, setAppliedPreview] = useState<YearTransitionPresentedPreview | null>(null);
  const [result, setResult] = useState<{
    ok: boolean;
    code: string;
    codeLabel: string;
    createdCount?: number;
    toReclassifyCount?: number;
    alreadyPresentCount?: number;
    skippedCount?: number;
    notes?: { createdCount: number; toReclassifyCount: number; alreadyPresentCount: number; skippedCount: number };
    targetCourses: YearTransitionPresentedPreview["targetCourses"];
    classSummaries: YearTransitionPresentedPreview["classSummaries"];
  } | null>(null);

  const sourceYear = years.find((year) => year.id === sourceYearId) ?? null;
  const targetYear = years.find((year) => year.id === targetYearId) ?? null;
  const sourceClasses = useMemo(() => classesByYearId[sourceYearId] ?? [], [classesByYearId, sourceYearId]);
  const draftYears = years.filter((year) => year.status === "draft");
  const stalePreview = Boolean(result) && step !== "result";

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
    setExclusionsAcknowledged(false);
    setExpandedClassId(null);
    if (step === "preview") setStep("options");
    if (step === "result") setStep("options");
  }

  const excludedCount = preview
    ? preview.publications.excluded.length + (preview.notes?.excluded.length ?? 0)
    : 0;

  async function handlePreview() {
    if (!sourceYearId || !targetYearId) return;
    setWorking(true);
    setError("");
    try {
      const created = await createYearTransitionPreviewApi({
        sourceSchoolYearId: sourceYearId,
        targetSchoolYearId: targetYearId,
        selectedSourceClassIds: selectedClassIds,
        includePrivateNotes,
      });
      setTransitionId(created.transitionId);
      setPreview(created.preview);
      setBlocking(created.blocking);
      setExclusionsAcknowledged(false);
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
    if (excludedCount > 0 && !exclusionsAcknowledged) return;
    setWorking(true);
    setError("");
    setConfirmOpen(false);
    try {
      const outcome = await applyYearTransitionApi(transitionId);
      setResult(outcome);
      setAppliedPreview(
        preview
          ? {
              ...preview,
              classSummaries: outcome.classSummaries.length ? outcome.classSummaries : preview.classSummaries,
            }
          : preview,
      );
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
          Cinq étapes : années, classes à reprendre, éléments, aperçu, résultat. L’année cible reste
          en préparation. L’année active des enseignants et des élèves n’est pas modifiée.
        </p>
      </div>

      <p className="year-transition-selection" aria-live="polite">
        Source : <strong>{yearCaption(sourceYear)}</strong>
        {" · "}
        Cible : <strong>{yearCaption(targetYear)}</strong>
      </p>

      {loading ? <p className="school-year-status">Chargement…</p> : null}
      {error ? <p className="school-year-error" role="alert">{error}</p> : null}
      {stalePreview ? (
        <p className="school-year-hint" role="status">
          Les paramètres ont changé. L’ancien résultat reste affiché à l’étape 5 s’il a déjà été
          appliqué, mais un nouvel aperçu est nécessaire pour un nouveau transfert.
        </p>
      ) : null}

      <nav className="year-transition-steps" aria-label="Étapes de préparation">
        {([
          ["years", "1. Années"],
          ["classes", "2. Classes"],
          ["options", "3. Éléments"],
          ["preview", "4. Aperçu"],
          ["result", "5. Résultat"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={step === id ? "active" : undefined}
            onClick={() => setStep(id)}
            disabled={(id === "preview" && !preview) || (id === "result" && !result)}
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
          <p className="school-year-hint">
            La préparation ne change pas l’année utilisée par les enseignants et les élèves.
          </p>
          <div className="year-transition-year-grid">
            <label>
              Année source
              <select
                value={sourceYearId}
                onChange={(event) => {
                  setSourceYearId(event.target.value);
                  setSelectedClassIds([]);
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
              Année cible à préparer
              <select
                value={targetYearId}
                onChange={(event) => {
                  setTargetYearId(event.target.value);
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
          {targetYear ? (
            <p className="school-year-hint">Statut de la cible : {targetYear.statusLabel}.</p>
          ) : null}
          {targetYear && targetYear.status !== "draft" ? (
            <p className="school-year-error">L’année cible doit rester en préparation.</p>
          ) : null}
          {draftYears.length === 0 ? (
            <p className="school-year-hint">Créez d’abord une année future en brouillon (onglet Année scolaire).</p>
          ) : null}
          <button
            type="button"
            className="workspace-action"
            disabled={!sourceYearId || !targetYearId || sourceYearId === targetYearId}
            onClick={() => setStep("classes")}
          >
            Continuer
          </button>
        </article>
      ) : null}

      {step === "classes" ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Étape 2</span>
            <h3>Reprendre les classes pour l’année suivante</h3>
          </header>
          <p className="school-year-hint">
            Cochez chaque classe à reprendre telle quelle : même profession, même année de formation
            et même groupe. Les parallèles A, B et C restent distincts. Une classe décochée n’est
            simplement pas reprise — ce n’est pas une erreur. Une nouvelle classe (par exemple D) se
            crée ensuite dans l’année cible, sans contenu source. Les élèves ne passent pas
            automatiquement d’une année de formation à la suivante.
          </p>
          {sourceClasses.length === 0 ? (
            <p className="school-year-hint">Aucune classe dans l’année source.</p>
          ) : (
            <ul className="year-transition-class-picks">
              {sourceClasses.map((source) => {
                const checked = selectedClassIds.includes(source.id);
                return (
                  <li key={source.id}>
                    <label htmlFor={`year-transition-class-${source.id}`}>
                      <input
                        id={`year-transition-class-${source.id}`}
                        type="checkbox"
                        checked={checked}
                        aria-label={`${classIdentityLabel(source)} : reprendre`}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          setSelectedClassIds((current) =>
                            enabled ? [...current, source.id] : current.filter((id) => id !== source.id),
                          );
                          invalidatePreview();
                        }}
                      />
                      <span>
                        <strong>{classIdentityLabel(source)}</strong>
                        <em>reprendre</em>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="school-year-hint">{selectedClassIds.length} classe(s) sélectionnée(s).</p>
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("years")}>
              Retour
            </button>
            <button type="button" className="workspace-action" onClick={() => setStep("options")}>
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
          <p className="school-year-hint">Ces choix s’appliquent uniquement aux classes cochées à l’étape 2.</p>
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
                Désactivé par défaut. Uniquement vos notes. Leur texte n’apparaît pas ici. Les notes
                sans référence pédagogique restent dans l’année source.
              </p>
            </li>
          </ul>
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("classes")}>
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
          <article className="school-year-card">
            <header>
              <span className="eyebrow">Étape 4</span>
              <h3>Vérifier avant le transfert</h3>
            </header>
            <ul className="year-transition-summary">
              <li>Année source : {yearCaption(preview.sourceYear)}</li>
              <li>Année cible : {yearCaption(preview.targetYear)}</li>
              <li>Classes sélectionnées : {preview.selectedClassCount}</li>
              <li>Publications du Carnet : toujours incluses</li>
              <li>Notes privées : {preview.includePrivateNotes ? "incluses (les vôtres uniquement)" : "non incluses"}</li>
            </ul>
            <p className="school-year-hint">
              L’année cible reste en préparation. L’année active et les données sources sont conservées.
            </p>
          </article>
          {preview.mappingIssues.length > 0 ? (
            <article className="school-year-card">
              <header>
                <span className="eyebrow">À clarifier</span>
                <h3>Ambiguïtés ou identités incomplètes</h3>
              </header>
              <ul className="year-transition-rows">
                {preview.mappingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </article>
          ) : null}
          <article className="school-year-card">
            <header>
              <span className="eyebrow">Classes</span>
              <h3>Détail dépliable</h3>
            </header>
            {preview.classSummaries.length === 0 ? (
              <p className="school-year-hint">Aucune classe cochée. Rien ne sera transféré.</p>
            ) : (
              <ul className="year-transition-class-summaries">
                {preview.classSummaries.map((summary) => (
                  <li key={summary.sourceClassId}>
                    <button
                      type="button"
                      className="year-transition-class-toggle"
                      aria-expanded={expandedClassId === summary.sourceClassId}
                      onClick={() =>
                        setExpandedClassId((current) =>
                          current === summary.sourceClassId ? null : summary.sourceClassId,
                        )
                      }
                    >
                      <strong>{summary.identityLabel}</strong>
                      <span>{summary.statusLabel}</span>
                      <span>
                        {summary.publicationCount} publication(s)
                        {preview.includePrivateNotes ? ` · ${summary.privateNoteCount} note(s) privée(s)` : ""}
                      </span>
                    </button>
                    {expandedClassId === summary.sourceClassId ? (
                      <div>
                        {summary.message ? <p className="school-year-hint">{summary.message}</p> : null}
                        <PreviewRows rows={summary.rows} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </article>
          {excludedCount > 0 && !blocking ? (
            <label className="year-transition-notes-option">
              <input
                type="checkbox"
                checked={exclusionsAcknowledged}
                onChange={(event) => setExclusionsAcknowledged(event.target.checked)}
              />
              J’ai pris connaissance des {excludedCount} élément(s) non transféré(s), qui restent dans l’année source.
            </label>
          ) : null}
          {blocking ? (
            <p className="school-year-error">
              Des problèmes bloquants empêchent l’application. Corrigez la préparation puis recalculez l’aperçu.
            </p>
          ) : (
            <p className="school-year-hint">L’aperçu ne transfère rien. Vérifiez puis confirmez.</p>
          )}
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("options")}>
              Retour
            </button>
            <button type="button" className="workspace-action secondary" disabled={working} onClick={() => void handlePreview()}>
              Recalculer l’aperçu
            </button>
            <button
              type="button"
              className="workspace-action"
              disabled={working || blocking || !transitionId || (excludedCount > 0 && !exclusionsAcknowledged)}
              onClick={() => setConfirmOpen(true)}
            >
              Confirmer le transfert
            </button>
          </div>
        </>
      ) : null}

      {step === "result" && result ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Étape 5</span>
            <h3>{result.ok && result.code === "APPLIED" ? "Transfert terminé" : result.codeLabel}</h3>
          </header>
          <p>{result.codeLabel}</p>
          <ul className="year-transition-summary">
            <li>
              Classes créées :{" "}
              {(appliedPreview?.classSummaries ?? result.classSummaries).filter((entry) => entry.status === "create").length}
              {" · "}
              réutilisées :{" "}
              {(appliedPreview?.classSummaries ?? result.classSummaries).filter((entry) => entry.status === "reuse").length}
            </li>
            <li>Publications planifiées : {result.createdCount ?? 0}</li>
            <li>Publications à reclasser : {result.toReclassifyCount ?? 0}</li>
            <li>Déjà présentes : {result.alreadyPresentCount ?? 0}</li>
            <li>Non transférées : {result.skippedCount ?? 0}</li>
            {result.notes ? (
              <li>
                Notes planifiées : {result.notes.createdCount} · à reclasser : {result.notes.toReclassifyCount ?? 0}
                {" · "}déjà présentes : {result.notes.alreadyPresentCount}
                {" · "}non transférées : {result.notes.skippedCount}
              </li>
            ) : (
              <li>Notes privées : non demandées</li>
            )}
          </ul>
          <p className="school-year-hint">
            Les copies sont indépendantes : une modification ultérieure de la source n’est pas
            synchronisée automatiquement. Un transfert répété ne crée pas de doublons.
          </p>
          {appliedPreview?.classSummaries.length ? (
            <ul className="year-transition-class-summaries">
              {appliedPreview.classSummaries.map((summary) => (
                <li key={summary.sourceClassId}>
                  <strong>{summary.identityLabel}</strong>
                  <span>
                    {result.ok && summary.status === "create" ? "Classe créée" : summary.statusLabel}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
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
          {onConsultPreparedYear && targetYearId ? (
            <button
              type="button"
              className="workspace-action"
              onClick={() => onConsultPreparedYear(targetYearId)}
            >
              Consulter l’année préparée
            </button>
          ) : null}
        </article>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmer le transfert ?"
        body={`Les publications${includePrivateNotes ? " et vos notes privées" : ""} projetables de ${yearCaption(sourceYear)} seront copiées vers ${yearCaption(targetYear)}. L’année cible restera en préparation. L’année active et les données sources sont conservées.`}
        confirmLabel="Confirmer le transfert"
        cancelLabel="Annuler"
        onConfirm={() => void handleApply()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
