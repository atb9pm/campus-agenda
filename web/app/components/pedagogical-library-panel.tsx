"use client";

import { useCallback, useEffect, useId, useState } from "react";

import {
  DEMO_CATALOG,
  getClassroomsForTeacher,
  getSubjectById,
  getSubjectsForTeacherInClassroom,
  type Classroom,
} from "@campus/features/classes";
import {
  formatSchoolWeekOptionLabel,
  getCourseDayOptionsForSchoolWeek,
  type SchoolWeek,
} from "@campus/features/calendar";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import type { AgendaItemType } from "@campus/types/agenda";
import {
  deletePublicationTemplate,
  deployPublicationTemplates,
  duplicateFromPreviousYear,
  fetchPublicationTemplates,
  fetchSchoolYears,
  type PublicationTemplatePayload,
  type SchoolYearSummary,
} from "../../lib/api-client.ts";

const TYPE_LABELS: Record<AgendaItemType, string> = {
  HOMEWORK: "Devoir",
  TEST: "Contrôle",
  INFORMATION: "Information",
};

interface PedagogicalLibraryPanelProps {
  teacherId: string;
  defaultClassroomId: string;
  schoolWeeks: SchoolWeek[];
  onNotice: (message: string) => void;
  onItemsChanged: (items: PrototypeAgendaItem[]) => void;
}

export function PedagogicalLibraryPanel({
  teacherId,
  defaultClassroomId,
  schoolWeeks,
  onNotice,
  onItemsChanged,
}: PedagogicalLibraryPanelProps) {
  const deployFormId = useId();
  const duplicateFormId = useId();
  const [templates, setTemplates] = useState<PublicationTemplatePayload[]>([]);
  const [archivedYears, setArchivedYears] = useState<SchoolYearSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [deployClassroomId, setDeployClassroomId] = useState(defaultClassroomId);
  const [deployWeekNumber, setDeployWeekNumber] = useState(() => schoolWeeks[0]?.number ?? 1);
  const [deployDay, setDeployDay] = useState(0);
  const [duplicateYearId, setDuplicateYearId] = useState("");
  const [duplicateClassroomId, setDuplicateClassroomId] = useState(defaultClassroomId);
  const [alsoCreateTemplates, setAlsoCreateTemplates] = useState(false);

  const teacherClassrooms = getClassroomsForTeacher(DEMO_CATALOG, teacherId);
  const deploySubjects = getSubjectsForTeacherInClassroom(DEMO_CATALOG, teacherId, deployClassroomId);
  const deployWeek = schoolWeeks.find((week) => week.number === deployWeekNumber) ?? schoolWeeks[0];
  const deployCourseDays = deployWeek ? getCourseDayOptionsForSchoolWeek(deployWeek.number) : [];

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [templateList, years] = await Promise.all([fetchPublicationTemplates(), fetchSchoolYears()]);
      setTemplates(templateList);
      const archived = years.filter((year) => year.status === "archived");
      setArchivedYears(archived);
      setDuplicateYearId((current) => current || archived[0]?.id || "");
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

  useEffect(() => {
    queueMicrotask(() => {
      setDeployClassroomId(defaultClassroomId);
      setDuplicateClassroomId(defaultClassroomId);
    });
  }, [defaultClassroomId]);

  function toggleTemplate(templateId: string) {
    setSelectedTemplateIds((current) => {
      const next = new Set(current);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  }

  async function handleDelete(templateId: string) {
    setWorking(true);
    try {
      await deletePublicationTemplate(templateId);
      setTemplates((previous) => previous.filter((entry) => entry.id !== templateId));
      setSelectedTemplateIds((previous) => {
        const next = new Set(previous);
        next.delete(templateId);
        return next;
      });
      onNotice("Modèle supprimé de la bibliothèque.");
    } catch (deleteError) {
      onNotice(deleteError instanceof Error ? deleteError.message : "Suppression impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleDeploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedTemplateIds.size === 0) {
      onNotice("Sélectionnez au moins un modèle à déployer.");
      return;
    }

    const subjectId = deploySubjects[0]?.id;
    if (!subjectId) {
      onNotice("Aucune branche disponible pour le déploiement.");
      return;
    }

    setWorking(true);
    try {
      const deployments = [...selectedTemplateIds].map((templateId) => {
        const template = templates.find((entry) => entry.id === templateId);
        return {
          templateId,
          classroomId: deployClassroomId,
          subjectId: template?.subjectId && deploySubjects.some((subject) => subject.id === template.subjectId)
            ? template.subjectId
            : subjectId,
          schoolWeekNumber: template?.defaultSchoolWeekNumber ?? deployWeekNumber,
          day: template?.defaultDay ?? deployDay,
        };
      });
      const created = await deployPublicationTemplates(deployments);
      onItemsChanged(created);
      onNotice(`${created.length} publication${created.length > 1 ? "s" : ""} déployée${created.length > 1 ? "s" : ""} sur l'année.`);
      setSelectedTemplateIds(new Set());
    } catch (deployError) {
      onNotice(deployError instanceof Error ? deployError.message : "Déploiement impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleDuplicate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!duplicateYearId) {
      onNotice("Aucune année archivée disponible.");
      return;
    }

    setWorking(true);
    try {
      const result = await duplicateFromPreviousYear({
        archivedSchoolYearId: duplicateYearId,
        classroomId: duplicateClassroomId,
        alsoCreateTemplates,
      });
      onItemsChanged(result.created);
      if (alsoCreateTemplates) {
        await refresh();
      }
      onNotice(`${result.createdCount} publication${result.createdCount > 1 ? "s" : ""} reprise${result.createdCount > 1 ? "s" : ""} de l'année précédente.`);
    } catch (duplicateError) {
      onNotice(duplicateError instanceof Error ? duplicateError.message : "Duplication impossible.");
    } finally {
      setWorking(false);
    }
  }

  function subjectLabel(subjectId: string | null): string {
    if (!subjectId) return "—";
    return getSubjectById(DEMO_CATALOG, subjectId)?.name ?? "Branche";
  }

  return (
    <section className="library-panel" aria-labelledby="library-panel-title">
      <header className="library-panel-header">
        <p className="eyebrow">BIBLIOTHÈQUE PÉDAGOGIQUE</p>
        <h2 id="library-panel-title">Modèles réutilisables</h2>
        <p>
          Enregistrez vos publications récurrentes, déployez-les sur l&apos;année en cours ou reprenez le contenu
          d&apos;une année archivée.
        </p>
      </header>

      {loading ? <p role="status">Chargement de la bibliothèque…</p> : null}
      {error ? <p className="library-error" role="alert">{error}</p> : null}

      <div className="library-grid">
        <article className="library-card">
          <header>
            <h3>Mes modèles ({templates.length})</h3>
            <p>Consignes et titres réutilisables d&apos;une année sur l&apos;autre.</p>
          </header>
          {templates.length === 0 ? (
            <p className="library-empty">
              Aucun modèle pour l&apos;instant. Ouvrez une publication dans l&apos;agenda et choisissez
              «&nbsp;Enregistrer dans la bibliothèque&nbsp;».
            </p>
          ) : (
            <ul className="library-template-list">
              {templates.map((template) => (
                <li key={template.id}>
                  <label className="library-template-row">
                    <input
                      type="checkbox"
                      checked={selectedTemplateIds.has(template.id)}
                      onChange={() => toggleTemplate(template.id)}
                    />
                    <span className={`type-icon ${template.type.toLowerCase()}`}>
                      {template.type === "HOMEWORK" ? "D" : template.type === "TEST" ? "C" : "i"}
                    </span>
                    <span className="library-template-copy">
                      <strong>{template.title}</strong>
                      <small>
                        {TYPE_LABELS[template.type]} · {subjectLabel(template.subjectId)}
                        {template.defaultSchoolWeekNumber
                          ? ` · S${String(template.defaultSchoolWeekNumber).padStart(2, "0")}`
                          : ""}
                      </small>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="library-delete"
                    disabled={working}
                    onClick={() => void handleDelete(template.id)}
                    aria-label={`Supprimer le modèle ${template.title}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="library-card">
          <header>
            <h3>Déployer sur l&apos;année</h3>
            <p>Sélectionnez des modèles puis placez-les sur une classe et une semaine.</p>
          </header>
          <form id={deployFormId} className="library-form" onSubmit={(event) => void handleDeploy(event)}>
            <label>
              Classe
              <select value={deployClassroomId} onChange={(event) => setDeployClassroomId(event.target.value)}>
                {teacherClassrooms.map((classroom: Classroom) => (
                  <option key={classroom.id} value={classroom.id}>{classroom.name}</option>
                ))}
              </select>
            </label>
            <label>
              Semaine par défaut
              <select
                value={deployWeekNumber}
                onChange={(event) => setDeployWeekNumber(Number(event.target.value))}
              >
                {schoolWeeks.map((week) => (
                  <option key={week.number} value={week.number}>
                    {formatSchoolWeekOptionLabel(week)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jour par défaut
              <select value={deployDay} onChange={(event) => setDeployDay(Number(event.target.value))}>
                {deployCourseDays.map((slot) => (
                  <option key={slot.dayIndex} value={slot.dayIndex}>{slot.label}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={working || selectedTemplateIds.size === 0}>
              Déployer {selectedTemplateIds.size > 0 ? `(${selectedTemplateIds.size})` : ""}
            </button>
          </form>
        </article>

        <article className="library-card">
          <header>
            <h3>Dupliquer depuis l&apos;année précédente</h3>
            <p>Reprendre vos publications d&apos;une année archivée pour l&apos;année active.</p>
          </header>
          {archivedYears.length === 0 ? (
            <p className="library-empty">
              Aucune année archivée. Lors de l&apos;activation d&apos;une nouvelle année, l&apos;année sortante
              est archivée automatiquement.
            </p>
          ) : (
            <form id={duplicateFormId} className="library-form" onSubmit={(event) => void handleDuplicate(event)}>
              <label>
                Année archivée
                <select value={duplicateYearId} onChange={(event) => setDuplicateYearId(event.target.value)}>
                  {archivedYears.map((year) => (
                    <option key={year.id} value={year.id}>{year.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Classe
                <select
                  value={duplicateClassroomId}
                  onChange={(event) => setDuplicateClassroomId(event.target.value)}
                >
                  {teacherClassrooms.map((classroom) => (
                    <option key={classroom.id} value={classroom.id}>{classroom.name}</option>
                  ))}
                </select>
              </label>
              <label className="library-checkbox">
                <input
                  type="checkbox"
                  checked={alsoCreateTemplates}
                  onChange={(event) => setAlsoCreateTemplates(event.target.checked)}
                />
                Créer aussi des modèles dans la bibliothèque
              </label>
              <button type="submit" disabled={working}>Dupliquer mes publications</button>
            </form>
          )}
        </article>
      </div>
    </section>
  );
}
