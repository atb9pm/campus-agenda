import type { PrototypeAgendaItem } from "@campus/features/agenda";
import {
  studentHomeworkOnlySections,
  studentTodoSections,
  type StudentCourseDaySection,
} from "@campus/features/student";
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

export function StudentHomeworkPanel({
  sections,
  mode,
}: {
  sections: StudentCourseDaySection[];
  mode: "todo" | "homework";
}) {
  const visible = mode === "homework" ? studentHomeworkOnlySections(sections) : studentTodoSections(sections);
  const title = mode === "homework" ? "Devoirs" : "Cours du jour";
  const empty =
    mode === "homework" ? "Aucune publication pour aujourd’hui." : "Aucune publication pour aujourd’hui.";

  return (
    <section
      className="student-todo-panel student-day-courses"
      data-panel={mode === "homework" ? "devoirs" : "todo"}
      aria-labelledby={`student-${mode}-title`}
    >
      <h2 id={`student-${mode}-title`}>
        {mode === "todo" ? (
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
        ) : null}
        {title}
      </h2>
      {visible.length ? (
        <div className="student-branch-list">
          {visible.map((section) => (
            <section
              className="student-branch-block"
              key={section.subject.id}
              aria-label={section.subject.name || undefined}
              data-annual-course={section.subject.annualCourseId ?? section.subject.id}
            >
              {section.subject.name ? (
                <p className="student-course-chip">{section.subject.name}</p>
              ) : null}
              {section.publications.map((item, index) => (
                <div
                  key={item.id}
                  className={`student-branch-item student-course-pub${
                    index < section.publications.length - 1 ? " has-divider" : ""
                  }`}
                  data-item-type={item.type}
                >
                  {studentPublicationBody(item)}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <p className="student-panel-empty">{empty}</p>
      )}
    </section>
  );
}
