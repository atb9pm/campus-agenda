"use client";

import { useEffect, useMemo, useState } from "react";
import { COURSE_WEEKDAY_LABELS } from "@campus/features/course-schedule";
import {
  formatCourseSessionNumber,
  formatCourseSessionPeriods,
  formatSwissDate,
} from "@campus/features/course-sessions";
import type {
  CourseTimelineEntry,
  CourseTimelineProjection,
  TeacherCourseTimelineCourse,
} from "@campus/features/course-timeline";
import type { PrototypeAgendaItem } from "@campus/features/agenda/demo-items.ts";
import { REFERENCE_ITEM_TYPE_LABELS } from "@campus/features/pedagogical-path";
import { formatTrainingYearLabel } from "@campus/features/school-catalog";
import { WORKSPACE_ASSIGNMENT_ROLE_LABELS } from "@campus/features/teacher-workspace";
import {
  fetchTeacherCourseTimelineApi,
  publishTeacherCoursePublicationApi,
  type CourseTimelinePublicationSummary,
} from "../../lib/api-client.ts";

interface TeacherCourseTimelinePanelProps {
  annualCourseId: string;
  onBack: () => void;
  onAgendaItemCreated?: (item: PrototypeAgendaItem) => void;
}

function courseIdentityLine(course: TeacherCourseTimelineCourse): string {
  const parts = [
    course.classCode.trim() || null,
    course.professionLabel?.trim() || null,
    course.trainingYear !== null ? formatTrainingYearLabel(course.trainingYear) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function unscheduledCountLabel(count: number): string {
  if (count === 1) {
    return "1 séance du parcours n’a actuellement aucune date réelle.";
  }
  return `${count} séances du parcours n’ont actuellement aucune date réelle.`;
}

function ReferenceItems({
  entry,
  publishedByItemId,
  publishingItemId,
  publishError,
  onPublish,
}: {
  entry: CourseTimelineEntry;
  publishedByItemId: Map<string, CourseTimelinePublicationSummary>;
  publishingItemId: string | null;
  publishError: string;
  onPublish: (referenceItemId: string, courseSessionKey: string) => void;
}) {
  const reference = entry.referenceSession;
  if (!reference) {
    return <p className="course-timeline-empty-ref">Aucun contenu de référence prévu pour cette séance.</p>;
  }

  const label = reference.label?.trim() || `Séance de référence n° ${reference.position}`;

  return (
    <div className="course-timeline-reference">
      <h4>{label}</h4>
      {reference.items.length === 0 ? (
        <p className="course-timeline-empty-items">
          Aucun devoir, contrôle ou information prévu dans cette séance de référence.
        </p>
      ) : (
        <ul className="course-timeline-items">
          {reference.items.map((item) => {
            const published = publishedByItemId.get(item.id);
            const busy = publishingItemId === item.id;
            return (
              <li key={item.id}>
                <span className="course-timeline-item-type">{REFERENCE_ITEM_TYPE_LABELS[item.type]}</span>
                <strong>{item.title}</strong>
                {item.detail.trim() ? <p>{item.detail}</p> : null}
                {published ? (
                  <p className="course-timeline-published">✓ Publié dans l’Agenda</p>
                ) : (
                  <button
                    type="button"
                    className="workspace-action secondary"
                    disabled={busy || Boolean(publishingItemId)}
                    onClick={() => onPublish(item.id, entry.courseSession.key)}
                  >
                    {busy ? "Publication…" : "Publier dans l’Agenda"}
                  </button>
                )}
                {publishError && publishingItemId === item.id ? (
                  <p className="course-timeline-publish-error">{publishError}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TimelineCards({
  timeline,
  publishedByItemId,
  publishingItemId,
  publishError,
  onPublish,
}: {
  timeline: CourseTimelineProjection;
  publishedByItemId: Map<string, CourseTimelinePublicationSummary>;
  publishingItemId: string | null;
  publishError: string;
  onPublish: (referenceItemId: string, courseSessionKey: string) => void;
}) {
  if (timeline.entries.length === 0) {
    return (
      <p className="ma-semaine-empty">
        Aucune date réelle n’est actuellement calculable pour ce cours. Vérifiez son horaire.
      </p>
    );
  }

  return (
    <ol className="course-timeline-list">
      {timeline.entries.map((entry) => {
        const session = entry.courseSession;
        const periods = formatCourseSessionPeriods(session.segments);
        return (
          <li key={session.key}>
            <article className="workspace-card course-timeline-card">
              <header>
                <p className="eyebrow">{formatCourseSessionNumber(session.sequenceNumber)}</p>
                <h3>
                  {COURSE_WEEKDAY_LABELS[session.dayOfWeek]} {formatSwissDate(session.date)}
                </h3>
                <p>
                  Semaine {session.schoolWeekNumber} · {session.weekKind}
                  {periods ? ` · ${periods}` : ""}
                </p>
              </header>
              <ReferenceItems
                entry={entry}
                publishedByItemId={publishedByItemId}
                publishingItemId={publishingItemId}
                publishError={publishError}
                onPublish={onPublish}
              />
            </article>
          </li>
        );
      })}
    </ol>
  );
}

export function TeacherCourseTimelinePanel({
  annualCourseId,
  onBack,
  onAgendaItemCreated,
}: TeacherCourseTimelinePanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [course, setCourse] = useState<TeacherCourseTimelineCourse | null>(null);
  const [timeline, setTimeline] = useState<CourseTimelineProjection | null>(null);
  const [publications, setPublications] = useState<CourseTimelinePublicationSummary[]>([]);
  const [publishingItemId, setPublishingItemId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const payload = await fetchTeacherCourseTimelineApi(annualCourseId, controller.signal);
        if (controller.signal.aborted) return;
        setCourse(payload.course);
        setTimeline(payload.timeline);
        setPublications(payload.publications);
        setError("");
        setLoading(false);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof Error && caught.name === "AbortError") return;
        const message = caught instanceof Error ? caught.message : "Chargement du déroulement impossible.";
        setError(message);
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [annualCourseId]);

  const publishedByItemId = useMemo(() => {
    const map = new Map<string, CourseTimelinePublicationSummary>();
    for (const publication of publications) {
      if (publication.referenceItemId) {
        map.set(publication.referenceItemId, publication);
      }
    }
    return map;
  }, [publications]);

  async function handlePublish(referenceItemId: string, courseSessionKey: string) {
    setPublishingItemId(referenceItemId);
    setPublishError("");
    try {
      const item = await publishTeacherCoursePublicationApi({
        annualCourseId,
        courseSessionKey,
        referenceItemId,
      });
      setPublications((previous) => [
        ...previous.filter((entry) => entry.referenceItemId !== referenceItemId),
        {
          agendaItemId: item.id,
          referenceItemId,
          courseSessionKey: item.courseSessionKey ?? courseSessionKey,
          courseSessionDate: item.courseSessionDate ?? null,
          type: item.type,
        },
      ]);
      onAgendaItemCreated?.(item);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Publication impossible.";
      setPublishError(message);
    } finally {
      setPublishingItemId(null);
    }
  }

  const identity = course ? courseIdentityLine(course) : "";
  const unscheduled = timeline?.unscheduledReferenceSessions ?? [];

  return (
    <section className="teacher-workspace course-timeline" aria-label="Déroulement du cours">
      <div className="workspace-intro">
        {course ? (
          <>
            <p className="eyebrow">{WORKSPACE_ASSIGNMENT_ROLE_LABELS[course.role]}</p>
            <h2>{course.branchLabel}</h2>
            {identity ? <p>{identity}</p> : null}
            <p>{course.schoolYearLabel}</p>
          </>
        ) : (
          <>
            <p className="eyebrow">ESPACE ENSEIGNANT</p>
            <h2>Déroulement du cours</h2>
          </>
        )}
        <p>
          Déroulement prévu du cours à partir de l’horaire réel et du parcours pédagogique de référence.
        </p>
        <p>
          Les devoirs, contrôles et informations peuvent être publiés dans l’Agenda depuis cette vue.
        </p>
        <button type="button" className="workspace-action secondary" onClick={onBack}>
          ← Retour à Mes cours
        </button>
      </div>

      {loading ? <p className="ma-semaine-empty">Chargement du déroulement…</p> : null}
      {error ? <p className="ma-semaine-empty">{error}</p> : null}

      {!loading && !error && timeline ? (
        <>
          {!timeline.referencePathExists ? (
            <p className="course-timeline-banner">
              Aucun parcours pédagogique de référence n’est encore défini pour ce cours. Les dates réelles
              restent disponibles.
            </p>
          ) : null}
          {timeline.referencePathExists &&
          timeline.entries.every((entry) => entry.referenceSession === null) &&
          unscheduled.length === 0 ? (
            <p className="course-timeline-banner">
              Le parcours pédagogique existe, mais ne contient encore aucune séance de référence.
            </p>
          ) : null}
          {unscheduled.length > 0 ? (
            <p className="course-timeline-banner">{unscheduledCountLabel(unscheduled.length)}</p>
          ) : null}

          <TimelineCards
            timeline={timeline}
            publishedByItemId={publishedByItemId}
            publishingItemId={publishingItemId}
            publishError={publishError}
            onPublish={handlePublish}
          />

          {unscheduled.length > 0 ? (
            <section className="course-timeline-unscheduled" aria-label="Séances du parcours sans date">
              <h3>Séances du parcours sans date</h3>
              <ul>
                {unscheduled.map((session) => (
                  <li key={session.id}>
                    <strong>Séance {session.position}</strong>
                    <span>{session.label?.trim() || `Séance de référence n° ${session.position}`}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
