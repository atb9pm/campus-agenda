"use client";

import { useCallback, useEffect, useState } from "react";

import {
  applyYearTransitionReclassifyApi,
  fetchYearTransitionReclassify,
  type YearTransitionReclassifyItem,
  type YearTransitionReclassifyQueue,
} from "../../lib/api-client.ts";

interface YearTransitionReclassifyPanelProps {
  schoolYearId: string;
  yearLabel?: string;
  onBack: () => void;
  onCountChange?: (count: number) => void;
  onNotice: (message: string) => void;
}

function frenchCount(count: number, singular: string, plural: string): string {
  return `${count} ${count <= 1 ? singular : plural}`;
}

export function YearTransitionReclassifyPanel({
  schoolYearId,
  yearLabel,
  onBack,
  onCountChange,
  onNotice,
}: YearTransitionReclassifyPanelProps) {
  const [queue, setQueue] = useState<YearTransitionReclassifyQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchYearTransitionReclassify(schoolYearId);
      setQueue(next);
      onCountChange?.(next.count);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange, schoolYearId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function handleReclassify(item: YearTransitionReclassifyItem, courseSessionKey: string) {
    if (!courseSessionKey || savingId) return;
    setSavingId(item.id);
    setError("");
    try {
      const next = await applyYearTransitionReclassifyApi({
        schoolYearId,
        kind: item.kind,
        publicationId: item.publicationId,
        noteId: item.noteId,
        courseSessionKey,
      });
      setQueue(next);
      onCountChange?.(next.count);
      setSelectedKeys((current) => {
        const copy = { ...current };
        delete copy[item.id];
        return copy;
      });
      onNotice(next.complete ? "Tous les éléments transférés sont positionnés." : "Élément reclassé.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Reclassement impossible.");
    } finally {
      setSavingId(null);
    }
  }

  const headingLabel = queue?.yearLabel ?? yearLabel ?? schoolYearId;

  return (
    <section className="school-year-admin year-transition-prepare" aria-labelledby="year-transition-reclassify-title">
      <div className="workspace-intro">
        <p className="eyebrow">ANNÉE SCOLAIRE</p>
        <h2 id="year-transition-reclassify-title">À reclasser — {headingLabel}</h2>
        <p>
          Repositionnez les publications et notes transférées sur une séance réelle du même cours.
          Ce travail reste administratif : rien n’est publié aux élèves.
        </p>
      </div>

      {loading ? <p className="school-year-status">Chargement…</p> : null}
      {error ? <p className="school-year-error" role="alert">{error}</p> : null}

      {queue ? (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">Contenu transféré</span>
            <h3>
              {queue.complete
                ? "✓ Tous les éléments transférés sont positionnés."
                : `À reclasser : ${queue.count}`}
            </h3>
          </header>
          {queue.complete ? (
            <p className="school-year-hint">
              L’année cible est prête pour les enseignants. Aucun élément hérité n’attend une séance.
            </p>
          ) : (
            <p className="school-year-hint">
              {frenchCount(queue.count, "élément à repositionner", "éléments à repositionner")}
              {" "}sur une séance N+1 du même cours.
            </p>
          )}
        </article>
      ) : null}

      {queue?.groups.map((group) => (
        <article key={group.classId} className="school-year-card year-transition-reclassify-class">
          <header>
            <span className="eyebrow">Classe</span>
            <h3>{group.classLabel}</h3>
          </header>
          {group.courses.map((course) => (
            <section key={course.annualCourseId} className="year-transition-reclassify-course">
              <h4>{course.courseLabel}</h4>
              <ul className="year-transition-rows">
                {course.items.map((item) => {
                  const selected = selectedKeys[item.id] ?? "";
                  return (
                    <li key={item.id}>
                      <strong>
                        {item.typeLabel}
                        {item.title ? ` — ${item.title}` : ""}
                      </strong>
                      <span>Cours : {item.courseLabel}</span>
                      {item.sourceSessionLabel ? <span>{item.sourceSessionLabel}</span> : null}
                      <em>Motif : {item.reasonLabel}</em>
                      <label className="year-transition-reclassify-pick">
                        Séance cible
                        <select
                          value={selected}
                          disabled={savingId === item.id}
                          onChange={(event) =>
                            setSelectedKeys((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                        >
                          <option value="">Choisir une séance cible</option>
                          {course.sessions.map((session) => (
                            <option key={session.key} value={session.key}>
                              {session.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="workspace-action"
                        disabled={!selected || savingId === item.id}
                        onClick={() => void handleReclassify(item, selected)}
                      >
                        {savingId === item.id ? "Enregistrement…" : "Reclasser"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </article>
      ))}

      <div className="year-transition-actions">
        <button type="button" className="workspace-action secondary" onClick={onBack}>
          Retour à la préparation
        </button>
        <button type="button" className="workspace-action secondary" disabled={loading} onClick={() => void load()}>
          Actualiser la liste
        </button>
      </div>
    </section>
  );
}
