"use client";

import { useCallback, useEffect, useId, useState } from "react";

import {
  DEMO_CATALOG,
  getSubjectById,
  getSubjectsForClassroom,
  getTeacherById,
} from "@campus/features/classes";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import {
  exportSchoolYear,
  fetchAgendaItemsForYear,
  fetchClassYearStats,
  fetchMemberships,
  fetchSchoolYears,
  replaceTeacherMembership,
  type ClassYearStatsPayload,
  type MembershipPayload,
  type SchoolYearSummary,
} from "../../lib/api-client.ts";

interface MultiYearOperationsPanelProps {
  isAdmin: boolean;
  defaultClassroomId: string;
  onNotice: (message: string) => void;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function MultiYearOperationsPanel({
  isAdmin,
  defaultClassroomId,
  onNotice,
}: MultiYearOperationsPanelProps) {
  const classroomSelectId = useId();
  const yearSelectId = useId();
  const [years, setYears] = useState<SchoolYearSummary[]>([]);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [classroomId, setClassroomId] = useState(defaultClassroomId);
  const [archivedItems, setArchivedItems] = useState<PrototypeAgendaItem[]>([]);
  const [stats, setStats] = useState<ClassYearStatsPayload | null>(null);
  const [memberships, setMemberships] = useState<MembershipPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const [outgoingTeacherId, setOutgoingTeacherId] = useState("");
  const [incomingTeacherId, setIncomingTeacherId] = useState("");
  const [transferSubjectIds, setTransferSubjectIds] = useState<string[]>([]);

  const archivedYears = years.filter((year) => year.status === "archived");
  const classroomSubjects = getSubjectsForClassroom(DEMO_CATALOG, classroomId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const yearList = await fetchSchoolYears();
      setYears(yearList);
      const firstArchived = yearList.find((year) => year.status === "archived");
      setSelectedYearId((current) => current || firstArchived?.id || "");
      const membershipList = await fetchMemberships(classroomId);
      setMemberships(membershipList);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [classroomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedYearId) {
      setArchivedItems([]);
      setStats(null);
      return;
    }

    void (async () => {
      setWorking(true);
      setError("");
      try {
        const [{ items }, yearStats] = await Promise.all([
          fetchAgendaItemsForYear(classroomId, selectedYearId),
          fetchClassYearStats(selectedYearId, classroomId),
        ]);
        setArchivedItems(items);
        setStats(yearStats);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Consultation impossible.");
      } finally {
        setWorking(false);
      }
    })();
  }, [selectedYearId, classroomId]);

  async function handleExport(format: "json" | "csv") {
    if (!selectedYearId) return;
    setWorking(true);
    setError("");
    try {
      const year = years.find((entry) => entry.id === selectedYearId);
      const result = await exportSchoolYear(selectedYearId, format);
      if (format === "csv" && result.csvText) {
        downloadTextFile(`campus-agenda-${year?.label ?? selectedYearId}.csv`, result.csvText, "text/csv");
      } else if (result.snapshot) {
        downloadTextFile(
          `campus-agenda-${year?.label ?? selectedYearId}.json`,
          JSON.stringify(result.snapshot, null, 2),
          "application/json",
        );
      }
      onNotice(`Export ${format.toUpperCase()} de l'année ${year?.label ?? ""} téléchargé.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleReplaceTeacher(event: React.FormEvent) {
    event.preventDefault();
    if (!isAdmin || transferSubjectIds.length === 0) return;
    setWorking(true);
    setError("");
    try {
      await replaceTeacherMembership({
        classroomId,
        outgoingTeacherId,
        incomingTeacherId,
        subjectIds: transferSubjectIds,
      });
      onNotice("Remplacement enseignant enregistré. Les nouvelles publications iront au remplaçant.");
      setTransferSubjectIds([]);
      await refresh();
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : "Remplacement impossible.");
    } finally {
      setWorking(false);
    }
  }

  function toggleSubject(subjectId: string) {
    setTransferSubjectIds((current) =>
      current.includes(subjectId) ? current.filter((id) => id !== subjectId) : [...current, subjectId],
    );
  }

  const activeTeachers = [...new Set(memberships.map((membership) => membership.teacherId))];

  return (
    <section className="school-year-admin multi-year-ops" aria-labelledby="multi-year-ops-title">
      <div className="workspace-intro">
        <p className="eyebrow">EXPLOITATION</p>
        <h2 id="multi-year-ops-title">Archives et transitions</h2>
        <p>
          Consultez une année archivée en lecture seule, exportez les publications pour archivage institutionnel,
          et gérez les remplacements en cours d&apos;année.
        </p>
      </div>

      {loading && <p className="school-year-status">Chargement…</p>}
      {error && <p className="school-year-error" role="alert">{error}</p>}

      <article className="school-year-card">
        <header>
          <span className="eyebrow">CONSULTATION</span>
          <h3>Agenda archivé</h3>
        </header>

        <div className="multi-year-filters">
          <label htmlFor={classroomSelectId}>Classe</label>
          <select
            id={classroomSelectId}
            value={classroomId}
            disabled={working}
            onChange={(event) => setClassroomId(event.target.value)}
          >
            {DEMO_CATALOG.classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>{classroom.name}</option>
            ))}
          </select>

          <label htmlFor={yearSelectId}>Année archivée</label>
          <select
            id={yearSelectId}
            value={selectedYearId}
            disabled={working || archivedYears.length === 0}
            onChange={(event) => setSelectedYearId(event.target.value)}
          >
            {archivedYears.length === 0 && <option value="">Aucune année archivée</option>}
            {archivedYears.map((year) => (
              <option key={year.id} value={year.id}>{year.label}</option>
            ))}
          </select>
        </div>

        {selectedYearId && (
          <>
            <div className="school-year-actions">
              <button type="button" className="workspace-action secondary" disabled={working} onClick={() => void handleExport("json")}>
                Export JSON
              </button>
              <button type="button" className="workspace-action secondary" disabled={working} onClick={() => void handleExport("csv")}>
                Export CSV
              </button>
            </div>

            {stats && (
              <p className="school-year-meta">
                <strong>{stats.totalItems}</strong> publication{stats.totalItems > 1 ? "s" : ""} ·{" "}
                <strong>{stats.byType.TEST}</strong> contrôle{stats.byType.TEST > 1 ? "s" : ""} ·{" "}
                <strong>{stats.byType.HOMEWORK}</strong> devoir{stats.byType.HOMEWORK > 1 ? "s" : ""}
              </p>
            )}

            <div className="school-year-week-table-wrap">
              <table className="school-year-week-table">
                <thead>
                  <tr>
                    <th scope="col">Semaine</th>
                    <th scope="col">Branche</th>
                    <th scope="col">Type</th>
                    <th scope="col">Titre</th>
                    <th scope="col">Auteur</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedItems.length === 0 && (
                    <tr>
                      <td colSpan={5}>Aucune publication pour cette classe et cette année.</td>
                    </tr>
                  )}
                  {archivedItems.map((item) => (
                    <tr key={item.id}>
                      <td>S{item.schoolWeekNumber}</td>
                      <td>{getSubjectById(DEMO_CATALOG, item.subjectId)?.name ?? item.subjectId}</td>
                      <td>{item.type}</td>
                      <td>{item.title}</td>
                      <td>{getTeacherById(DEMO_CATALOG, item.authorTeacherId)?.initials ?? "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="school-year-hint">Lecture seule — les publications archivées ne peuvent pas être modifiées.</p>
          </>
        )}
      </article>

      {isAdmin && (
        <article className="school-year-card">
          <header>
            <span className="eyebrow">ADMINISTRATION</span>
            <h3>Remplacement enseignant</h3>
          </header>
          <p className="school-year-hint">
            Clôturer l&apos;affectation d&apos;un collègue et l&apos;ouvrir pour un remplaçant.
            L&apos;historique des publications reste rattaché à l&apos;auteur d&apos;origine.
          </p>

          <form className="multi-year-replace-form" onSubmit={(event) => void handleReplaceTeacher(event)}>
            <label>
              Enseignant sortant
              <select value={outgoingTeacherId} required disabled={working} onChange={(event) => setOutgoingTeacherId(event.target.value)}>
                <option value="">Choisir…</option>
                {activeTeachers.map((teacherId) => (
                  <option key={teacherId} value={teacherId}>
                    {getTeacherById(DEMO_CATALOG, teacherId)?.displayName ?? teacherId}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Enseignant remplaçant
              <select value={incomingTeacherId} required disabled={working} onChange={(event) => setIncomingTeacherId(event.target.value)}>
                <option value="">Choisir…</option>
                {DEMO_CATALOG.teachers
                  .filter((teacher) => teacher.id !== outgoingTeacherId)
                  .map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>
                  ))}
              </select>
            </label>

            <fieldset>
              <legend>Branches à transférer</legend>
              <ul className="multi-year-subject-checklist">
                {classroomSubjects.map((subject) => (
                  <li key={subject.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={transferSubjectIds.includes(subject.id)}
                        disabled={working}
                        onChange={() => toggleSubject(subject.id)}
                      />
                      {subject.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <button type="submit" className="workspace-action" disabled={working || transferSubjectIds.length === 0}>
              Enregistrer le remplacement
            </button>
          </form>
        </article>
      )}
    </section>
  );
}
