import type { PrototypeAgendaItem } from "@campus/features/agenda";
import {
  isGenericHomeworkTitle,
  studentHomeworkOnlySections,
  studentTodoSections,
  type StudentCourseDaySection,
} from "@campus/features/student";
import { decodeRichDetail, isPlaceholderDetail } from "@campus/features/class-notebook";
import { RichDocView } from "./rich-doc-view.tsx";

export function studentPublicationBody(item: PrototypeAgendaItem) {
  const rich = decodeRichDetail(item.detail);
  if (rich) {
    const heading = item.title.trim();
    const showHeading = heading.length > 0 && !isGenericHomeworkTitle(heading);
    return (
      <>
        {showHeading ? <strong className="student-sheet-heading">{heading}</strong> : null}
        <RichDocView doc={rich} />
      </>
    );
  }
  return (
    <>
      <strong className="student-sheet-heading">{item.title}</strong>
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
  const landmark = mode === "homework" ? "Devoirs" : "Publications du cours";
  const empty =
    mode === "homework" ? "Aucun devoir pour ce cours." : "Aucun devoir ni information pour ce cours.";

  return (
    <section
      className="student-todo-panel"
      data-panel={mode === "homework" ? "devoirs" : "todo"}
      aria-labelledby={`student-${mode}-title`}
    >
      <h2 id={`student-${mode}-title`} className="student-visually-hidden">
        {landmark}
      </h2>
      {visible.length ? (
        <div className="student-branch-list">
          {visible.map((section) => (
            <section
              className="student-course-sheet student-branch-block"
              key={section.subject.id}
              aria-label={section.subject.name || "Ce cours"}
            >
              <h3>{section.subject.name || "Ce cours"}</h3>
              <ul>
                {section.publications.map((item) => {
                  const kind = item.type === "INFORMATION" ? "INFORMATION" : "HOMEWORK";
                  return (
                    <li
                      key={item.id}
                      className={`student-branch-item student-task-item ${kind.toLowerCase()}`}
                      data-item-type={item.type}
                    >
                      {kind === "INFORMATION" ? (
                        <span className="student-item-type">Information</span>
                      ) : null}
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
