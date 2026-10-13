import type { PrototypeAgendaItem } from "@campus/features/agenda";
import {
  studentHomeworkOnlySections,
  studentTodoSections,
  type StudentCourseDaySection,
} from "@campus/features/student";
import { decodeRichDetail, isPlaceholderDetail } from "@campus/features/class-notebook";
import { RichDocView } from "./rich-doc-view.tsx";

const STUDENT_TYPE_LABELS: Record<"HOMEWORK" | "INFORMATION", string> = {
  HOMEWORK: "DEVOIR",
  INFORMATION: "INFORMATION",
};

export function studentPublicationBody(item: PrototypeAgendaItem) {
  const rich = decodeRichDetail(item.detail);
  if (rich) return <RichDocView doc={rich} />;
  return (
    <>
      <strong>{item.title}</strong>
      {!isPlaceholderDetail(item.detail) && item.detail.trim() ? <p>{item.detail}</p> : null}
    </>
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
  const title = mode === "homework" ? "Devoirs" : "À faire";
  const empty =
    mode === "homework" ? "Aucun devoir pour ce cours." : "Aucun devoir ni information pour ce cours.";

  return (
    <section
      className="student-todo-panel"
      data-panel={mode === "homework" ? "devoirs" : "todo"}
      aria-labelledby={`student-${mode}-title`}
    >
      <h2 id={`student-${mode}-title`}>{title}</h2>
      {visible.length ? (
        <div className="student-branch-list">
          {visible.map((section) => (
            <section
              className="student-branch-block"
              key={section.subject.id}
              aria-label={section.subject.name || undefined}
            >
              {section.subject.name ? <h3>{section.subject.name}</h3> : null}
              <ul>
                {section.publications.map((item) => {
                  const kind = item.type === "INFORMATION" ? "INFORMATION" : "HOMEWORK";
                  return (
                    <li
                      key={item.id}
                      className={`student-branch-item student-task-item ${kind.toLowerCase()}`}
                      data-item-type={item.type}
                    >
                      <span className="student-item-type">{STUDENT_TYPE_LABELS[kind]}</span>
                      {studentPublicationBody(item)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="student-course-day-empty student-panel-empty">
          <strong>{empty}</strong>
        </p>
      )}
    </section>
  );
}
