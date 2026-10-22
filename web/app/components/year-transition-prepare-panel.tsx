"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildTargetMeetingDayPlans,
  emptyMeetingDayDraft,
  validateMeetingDayDraft,
  yearTransitionConfigSignature,
  YEAR_TRANSITION_WEEK_KIND_OPTIONS,
  YEAR_TRANSITION_WEEKDAY_OPTIONS,
  type MeetingDayDraft,
} from "@campus/features/year-transition/meeting-day-draft.ts";
import type { CourseWeekKind, CourseWeekday } from "@campus/features/course-schedule/types.ts";
import {
  applyYearTransitionApi,
  createYearTransitionPreviewApi,
  fetchYearTransitionPrepare,
  type YearTransitionClassOption,
  type YearTransitionCourseOption,
  type YearTransitionPresentedPreview,
  type YearTransitionPresentedRow,
  type YearTransitionYearOption,
} from "../../lib/api-client.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";

interface YearTransitionPreparePanelProps {
  onNotice: (message: string) => void;
  onConsultPreparedYear?: (schoolYearId: string) => void;
  onOpenAdminTab?: (tab: "assignments" | "schedules") => void;
  onOpenTargetCourse?: (target: {
    schoolYearId: string;
    annualCourseId: string;
    classId: string;
    courseLabel: string;
    classLabel: string;
  }) => void;
}

type Step = "years" | "classes" | "days" | "preview" | "result";

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

function frenchCount(count: number, singular: string, plural: string): string {
  return `${count} ${count <= 1 ? singular : plural}`;
}

function contentSummary(preview: YearTransitionPresentedPreview) {
  const notes = preview.notes;
  return {
    plannedCount: preview.publications.projectable.length + (notes?.projectable.length ?? 0),
    toReclassifyCount: preview.publications.toReclassify.length + (notes?.toReclassify.length ?? 0),
    alreadyPresentCount: preview.publications.alreadyPresent.length + (notes?.alreadyPresent.length ?? 0),
    lostCount: preview.publications.excluded.length + (notes?.excluded.length ?? 0),
  };
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

function parseWeekday(value: string): CourseWeekday | null {
  if (!value) return null;
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5) return parsed;
  return null;
}

export function YearTransitionPreparePanel({
  onNotice,
  onConsultPreparedYear,
  onOpenAdminTab,
  onOpenTargetCourse,
}: YearTransitionPreparePanelProps) {
  const [step, setStep] = useState<Step>("years");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [years, setYears] = useState<YearTransitionYearOption[]>([]);
  const [classesByYearId, setClassesByYearId] = useState<Record<string, YearTransitionClassOption[]>>({});
  const [coursesByClassId, setCoursesByClassId] = useState<Record<string, YearTransitionCourseOption[]>>({});
  const [sourceYearId, setSourceYearId] = useState("");
  const [targetYearId, setTargetYearId] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [omittedCourseIds, setOmittedCourseIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MeetingDayDraft>>({});
  const [transitionId, setTransitionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<YearTransitionPresentedPreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
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
  const selectedClasses = useMemo(
    () => sourceClasses.filter((entry) => selectedClassIds.includes(entry.id)),
    [sourceClasses, selectedClassIds],
  );
  const continuedCourses = useMemo(
    () =>
      selectedClasses.flatMap((schoolClass) =>
        (coursesByClassId[schoolClass.id] ?? []).map((course) => ({ schoolClass, course })),
      ),
    [selectedClasses, coursesByClassId],
  );
  const selectedCourseIds = useMemo(
    () =>
      continuedCourses
        .filter((entry) => !omittedCourseIds.includes(entry.course.id))
        .map((entry) => entry.course.id),
    [continuedCourses, omittedCourseIds],
  );
  const configSignature = useMemo(
    () =>
      yearTransitionConfigSignature({
        sourceSchoolYearId: sourceYearId,
        targetSchoolYearId: targetYearId,
        selectedSourceClassIds: selectedClassIds,
        selectedSourceAnnualCourseIds: selectedCourseIds,
        drafts,
      }),
    [sourceYearId, targetYearId, selectedClassIds, selectedCourseIds, drafts],
  );
  const previewStale = Boolean(preview) && previewSignature !== configSignature;
  const staleResult = Boolean(result) && step !== "result";
  const planBuild = useMemo(
    () => buildTargetMeetingDayPlans(selectedCourseIds, drafts),
    [selectedCourseIds, drafts],
  );
  const daysReady = planBuild.ok;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchYearTransitionPrepare();
      setYears(payload.years);
      setClassesByYearId(payload.classesByYearId);
      setCoursesByClassId(payload.coursesByClassId);
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

  function updateDraft(courseId: string, patch: Partial<MeetingDayDraft>) {
    setDrafts((current) => {
      const previous = current[courseId] ?? emptyMeetingDayDraft();
      const next = { ...previous, ...patch };
      if (next.additionalDay != null && next.additionalDay === next.primaryDay) {
        next.additionalDay = null;
      }
      return { ...current, [courseId]: next };
    });
    setTransitionId(null);
  }

  const excludedCount = preview
    ? preview.publications.excluded.length + (preview.notes?.excluded.length ?? 0)
    : 0;
  const totals = preview ? contentSummary(preview) : null;
  const classesToCreate = preview
    ? preview.classSummaries.filter((entry) => entry.status === "create").length
    : 0;

  async function handlePreview() {
    if (!sourceYearId || !targetYearId) return;
    if (!planBuild.ok) {
      setError("Choisissez le jour principal de chaque cours repris avant l’aperçu.");
      setStep("days");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const created = await createYearTransitionPreviewApi({
        sourceSchoolYearId: sourceYearId,
        targetSchoolYearId: targetYearId,
        selectedSourceClassIds: selectedClassIds,
        selectedSourceAnnualCourseIds: selectedCourseIds,
        includePrivateNotes: true,
        targetMeetingDayPlans: planBuild.plans,
      });
      setTransitionId(created.transitionId);
      setPreview(created.preview);
      setPreviewSignature(configSignature);
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
    if (!transitionId || blocking || previewStale) return;
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

  function courseDraft(courseId: string): MeetingDayDraft {
    return drafts[courseId] ?? emptyMeetingDayDraft();
  }

  const applyDisabled =
    working ||
    blocking ||
    !transitionId ||
    previewStale ||
    (excludedCount > 0 && !exclusionsAcknowledged);
  const resultTotals = result
    ? {
        planned:
          (result.createdCount ?? 0) + (result.notes?.createdCount ?? 0),
        reclassify:
          (result.toReclassifyCount ?? 0) + (result.notes?.toReclassifyCount ?? 0),
        lost: (result.skippedCount ?? 0) + (result.notes?.skippedCount ?? 0),
      }
    : null;

  return (
    <section className="school-year-admin year-transition-prepare" aria-labelledby="year-transition-title">
      <div className="workspace-intro">
        <p className="eyebrow">ANNÉE SCOLAIRE</p>
        <h2 id="year-transition-title">Préparer l’année suivante</h2>
        <p>
          Cinq étapes : années, classes et cours, jours N+1, aperçu, résultat.
          L’année cible reste en préparation. Les enseignants et l’horaire détaillé se
          configurent ensuite dans les écrans existants.
        </p>
      </div>

      <p className="year-transition-selection" aria-live="polite">
        Source : <strong>{yearCaption(sourceYear)}</strong>
        {" · "}
        Cible : <strong>{yearCaption(targetYear)}</strong>
      </p>

      {loading ? <p className="school-year-status">Chargement…</p> : null}
      {error ? <p className="school-year-error" role="alert">{error}</p> : null}
      {staleResult ? (
        <p className="school-year-hint" role="status">
          Les paramètres ont changé. L’ancien résultat reste affiché à l’étape 5 s’il a déjà été
          appliqué, mais un nouvel aperçu est nécessaire pour un nouveau transfert.
        </p>
      ) : null}

      <nav className="year-transition-steps" aria-label="Étapes de préparation">
        {([
          ["years", "1. Années"],
          ["classes", "2. Classes et cours"],
          ["days", "3. Jours N+1"],
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
                  setOmittedCourseIds([]);
                  setTransitionId(null);
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
                  setTransitionId(null);
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
            <h3>Reprendre les classes et les cours</h3>
          </header>
          <p className="school-year-hint">
            Cochez chaque classe à reprendre. Les cours de la classe apparaîtront à l’étape suivante
            pour indiquer leurs jours N+1. Une classe décochée n’est pas reprise — ce n’est pas une
            erreur. Les enseignants et les périodes ne sont pas demandés ici.
          </p>
          {sourceClasses.length === 0 ? (
            <p className="school-year-hint">Aucune classe dans l’année source.</p>
          ) : (
            <ul className="year-transition-class-picks">
              {sourceClasses.map((source) => {
                const checked = selectedClassIds.includes(source.id);
                const courses = coursesByClassId[source.id] ?? [];
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
                          setTransitionId(null);
                        }}
                      />
                      <span>
                        <strong>{classIdentityLabel(source)}</strong>
                        <em>{source.code} · reprendre</em>
                        {courses.length > 0 ? (
                          <em>{courses.map((course) => course.label).join(" · ")}</em>
                        ) : (
                          <em>Aucun cours</em>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="school-year-hint">
            {selectedClassIds.length} classe(s) · {selectedCourseIds.length} cours à reprendre.
          </p>
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("years")}>
              Retour
            </button>
            <button type="button" className="workspace-action" onClick={() => setStep("days")}>
              Continuer
            </button>
          </div>
        </article>
      ) : null}

      {step === "days" ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Étape 3</span>
            <h3>Jours des cours N+1</h3>
          </header>
          <p className="school-year-hint">
            Indiquez explicitement le jour principal de chaque cours repris, et un deuxième jour si
            besoin. Rien n’est recopié depuis l’année précédente. Aucune période, salle ou enseignant
            n’est demandé ici.
          </p>
          {selectedClasses.length === 0 ? (
            <p className="school-year-hint">Aucune classe sélectionnée. Rien ne sera repris.</p>
          ) : (
            <div className="year-transition-course-groups">
              {selectedClasses.map((schoolClass) => {
                const courses = coursesByClassId[schoolClass.id] ?? [];
                return (
                  <section key={schoolClass.id} className="year-transition-course-group">
                    <h4>{schoolClass.code}</h4>
                    {courses.length === 0 ? (
                      <p className="school-year-hint">Aucun cours dans cette classe.</p>
                    ) : (
                      courses.map((course) => {
                        const continued = selectedCourseIds.includes(course.id);
                        const draft = courseDraft(course.id);
                        const invalid = continued ? validateMeetingDayDraft(draft) : { ok: true as const };
                        return (
                          <article key={course.id} className="year-transition-course-card">
                            <label className="year-transition-notes-option" htmlFor={`year-transition-course-${course.id}`}>
                              <input
                                id={`year-transition-course-${course.id}`}
                                type="checkbox"
                                checked={continued}
                                aria-label={`${course.label} : reprendre`}
                                onChange={(event) => {
                                  const enabled = event.target.checked;
                                  setOmittedCourseIds((current) =>
                                    enabled
                                      ? current.filter((id) => id !== course.id)
                                      : current.includes(course.id)
                                        ? current
                                        : [...current, course.id],
                                  );
                                  setTransitionId(null);
                                }}
                              />
                              <strong>{course.label}</strong>
                            </label>
                            {continued ? (
                              <>
                                <div className="year-transition-day-fields">
                                  <label>
                                    Jour principal
                                    <select
                                      value={draft.primaryDay ?? ""}
                                      aria-label={`Jour principal de ${course.label}`}
                                      onChange={(event) =>
                                        updateDraft(course.id, { primaryDay: parseWeekday(event.target.value) })
                                      }
                                    >
                                      <option value="">Choisir…</option>
                                      {YEAR_TRANSITION_WEEKDAY_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    Rythme
                                    <select
                                      value={draft.primaryWeekKind}
                                      aria-label={`Rythme du jour principal de ${course.label}`}
                                      onChange={(event) =>
                                        updateDraft(course.id, {
                                          primaryWeekKind: event.target.value as CourseWeekKind,
                                        })
                                      }
                                    >
                                      {YEAR_TRANSITION_WEEK_KIND_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    Deuxième jour
                                    <select
                                      value={draft.additionalDay ?? ""}
                                      aria-label={`Deuxième jour de ${course.label}`}
                                      onChange={(event) =>
                                        updateDraft(course.id, {
                                          additionalDay: parseWeekday(event.target.value),
                                        })
                                      }
                                    >
                                      <option value="">Aucun</option>
                                      {YEAR_TRANSITION_WEEKDAY_OPTIONS.filter(
                                        (option) => option.value !== draft.primaryDay,
                                      ).map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  {draft.additionalDay != null ? (
                                    <label>
                                      Rythme
                                      <select
                                        value={draft.additionalWeekKind}
                                        aria-label={`Rythme du deuxième jour de ${course.label}`}
                                        onChange={(event) =>
                                          updateDraft(course.id, {
                                            additionalWeekKind: event.target.value as CourseWeekKind,
                                          })
                                        }
                                      >
                                        {YEAR_TRANSITION_WEEK_KIND_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                </div>
                                {!invalid.ok ? (
                                  <p className="year-transition-course-error">{invalid.reason}</p>
                                ) : null}
                              </>
                            ) : (
                              <p className="school-year-hint">Ce cours ne sera pas repris.</p>
                            )}
                          </article>
                        );
                      })
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {!daysReady && selectedCourseIds.length > 0 ? (
            <p className="school-year-error">
              Choisissez le jour principal de chaque cours repris avant de calculer l’aperçu.
            </p>
          ) : null}
          <div className="year-transition-actions">
            <button type="button" className="workspace-action secondary" onClick={() => setStep("classes")}>
              Retour
            </button>
            <button
              type="button"
              className="workspace-action"
              disabled={working || !daysReady}
              onClick={() => void handlePreview()}
            >
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
              <h3>Préparation {preview.targetYear?.displayLabel ?? yearCaption(targetYear)}</h3>
            </header>
            {previewStale ? (
              <p className="school-year-error" role="status">
                La configuration a changé. Actualisez l’aperçu avant d’appliquer.
              </p>
            ) : null}
            <ul className="year-transition-summary">
              <li>Classes à créer : {classesToCreate}</li>
              <li>Cours à reprendre : {selectedCourseIds.length}</li>
            </ul>
            {totals ? (
              <ul className="year-transition-totals">
                <li className="ok">
                  ✓ {frenchCount(totals.plannedCount, "élément planifié automatiquement", "éléments planifiés automatiquement")}
                </li>
                <li className={totals.toReclassifyCount > 0 ? "warn" : undefined}>
                  {totals.toReclassifyCount > 0 ? "⚠ " : ""}
                  {frenchCount(totals.toReclassifyCount, "élément à reclasser", "éléments à reclasser")}
                </li>
                <li className="ok">
                  ✓ {frenchCount(totals.alreadyPresentCount, "élément déjà présent", "éléments déjà présents")}
                </li>
                <li className="year-transition-lost">
                  {frenchCount(totals.lostCount, "élément perdu", "éléments perdus")}
                </li>
              </ul>
            ) : null}
            <p className="school-year-hint">
              Le contenu pédagogique du cours — publications et notes — est transféré automatiquement.
              Les enseignants et les périodes seront configurés ensuite.
            </p>
          </article>
          {totals && totals.toReclassifyCount > 0 ? (
            <article className="school-year-card">
              <header>
                <span className="eyebrow">À reclasser</span>
                <h3>Éléments à repositionner manuellement</h3>
              </header>
              <p className="school-year-hint">
                Cet élément sera bien transféré dans le cours N+1 mais devra être repositionné
                manuellement sur une séance.
              </p>
              <PreviewRows
                rows={[
                  ...preview.publications.toReclassify,
                  ...(preview.notes?.toReclassify ?? []),
                ]}
              />
            </article>
          ) : null}
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
                        {preview.includePrivateNotes ? ` · ${summary.privateNoteCount} note(s)` : ""}
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
            <button type="button" className="workspace-action secondary" onClick={() => setStep("days")}>
              Retour
            </button>
            <button type="button" className="workspace-action secondary" disabled={working} onClick={() => void handlePreview()}>
              Actualiser l’aperçu
            </button>
            <button
              type="button"
              className="workspace-action"
              disabled={applyDisabled}
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
            <h3>
              {result.ok && result.code === "APPLIED"
                ? `Année ${targetYear?.displayLabel ?? yearCaption(targetYear)} préparée.`
                : result.codeLabel}
            </h3>
          </header>
          {result.ok ? (
            <>
              <p>{frenchCount(result.targetCourses.length, "cours créé", "cours créés")}.</p>
              <p>Contenu transféré :</p>
              <ul className="year-transition-summary">
                <li>{frenchCount(resultTotals?.planned ?? 0, "élément planifié", "éléments planifiés")}</li>
                <li>{frenchCount(resultTotals?.reclassify ?? 0, "élément à reclasser", "éléments à reclasser")}</li>
                <li className="year-transition-lost">
                  {frenchCount(resultTotals?.lost ?? 0, "élément perdu", "éléments perdus")}
                </li>
              </ul>
              <p>À faire ensuite :</p>
              <ul className="year-transition-summary">
                <li>attribuer les enseignants ;</li>
                <li>compléter l’horaire des classes.</li>
              </ul>
            </>
          ) : (
            <p>{result.codeLabel}</p>
          )}
          {onOpenAdminTab ? (
            <div className="year-transition-actions">
              <button type="button" className="workspace-action secondary" onClick={() => onOpenAdminTab("assignments")}>
                Attributions des cours
              </button>
              <button type="button" className="workspace-action secondary" onClick={() => onOpenAdminTab("schedules")}>
                Horaire des classes
              </button>
            </div>
          ) : null}
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
        body={`Cette opération créera la structure ${yearCaption(targetYear)} et transférera le contenu pédagogique sélectionné. Les enseignants et les périodes seront configurés ensuite dans les écrans existants.`}
        confirmLabel="Confirmer le transfert"
        cancelLabel="Annuler"
        onConfirm={() => void handleApply()}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
