import type { PrototypeAgendaItem } from "@campus/features/agenda";
import { calendarDateKey } from "@campus/features/evaluations";
import {
  formatNextSessionLabel,
  groupNextSessionsByDate,
  studentHomeworkOnlySections,
  studentTodoSections,
  type StudentCourseDaySection,
} from "@campus/features/student";
import type { Subject } from "@campus/types/classroom";
import { decodeRichDetail, isPlaceholderDetail } from "@campus/features/class-notebook";
import { RichDocView } from "./rich-doc-view.tsx";

export function studentPublicationBody(item: PrototypeAgendaItem) {
  const rich = decodeRichDetail(item.detail);
  if (rich) return <RichDocView doc={rich} />;
  return (
    <div className="student-pub-legacy">
      <strong>{item.title}</strong>
      {!isPlaceholderDetail(item.detail) && item.detail.trim() ? <p>{item.detail}</p> : null}
    </div>
  );
}

function CourseDayIcon() {
  return (
    <span className="student-zone-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 4.5h9.2A2.8 2.8 0 0 1 18 7.3v12.2H7.6A1.6 1.6 0 0 1 6 17.9V4.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M6 4.5A1.6 1.6 0 0 0 4.4 6.1v11.8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 8.5h6.5M9 12h6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function BranchBlock({ subject, publications }: { subject: Subject; publications: PrototypeAgendaItem[] }) {
  return (
    <section
      className="student-branch-block"
      aria-label={subject.name || undefined}
      data-annual-course={subject.annualCourseId ?? subject.id}
    >
      {subject.name ? <p className="student-course-chip">{subject.name}</p> : null}
      {publications.map((item, index) => (
        <div
          key={item.id}
          className={`student-branch-item student-course-pub${
            index < publications.length - 1 ? " has-divider" : ""
          }`}
          data-item-type={item.type}
        >
          {studentPublicationBody(item)}
        </div>
      ))}
    </section>
  );
}

export function StudentHomeworkPanel({
  sections,
  mode,
}: {
  sections: StudentCourseDaySection[];
  mode: "todo" | "homework";
}) {
  const visible = mode === "homework" ? studentHomeworkOnlySections(sections) : studentTodoSections(sections);
  const today = visible.filter((section) => section.publications.length > 0);
  const nextSessions = groupNextSessionsByDate(visible);
  const title = mode === "homework" ? "Devoirs" : "Cours du jour";
  const empty = "Aucune publication pour aujourd’hui.";

  return (
    <section
      className="student-todo-panel student-day-courses"
      data-panel={mode === "homework" ? "devoirs" : "todo"}
      aria-labelledby={`student-${mode}-title`}
    >
      <h2 id={`student-${mode}-title`}>
        {mode === "todo" ? <CourseDayIcon /> : null}
        {title}
      </h2>
      {today.length ? (
        <div className="student-branch-list">
          {today.map((section) => (
            <BranchBlock key={section.subject.id} subject={section.subject} publications={section.publications} />
          ))}
        </div>
      ) : (
        <p className="student-panel-empty">{empty}</p>
      )}
      {nextSessions.map((group) => (
        <section className="student-next-session" data-next-session={group.dateKey} key={group.dateKey}>
          <h3 className="student-next-session-heading">
            <CourseDayIcon />
            <time dateTime={calendarDateKey(group.slot.date)}>{formatNextSessionLabel(group.slot.date)}</time>
          </h3>
          <div className="student-branch-list">
            {group.branches.map((branch) => (
              <BranchBlock key={branch.subject.id} subject={branch.subject} publications={branch.publications} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
