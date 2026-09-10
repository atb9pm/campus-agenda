import {
  CATALOG_DELETE_IRREVERSIBLE,
  CATALOG_DELETE_WARNING,
  type CatalogDeleteCounts,
  type CatalogDeletePlan,
  type CatalogDeletePreview,
} from "./types.ts";

function countLine(count: number, singular: string, plural: string): string | null {
  if (count <= 0) return null;
  return `${count} ${count > 1 ? plural : singular}`;
}

export function formatCatalogDeleteLines(counts: CatalogDeleteCounts): string[] {
  return [
    countLine(counts.classes, "classe", "classes"),
    countLine(counts.professions, "profession", "professions"),
    countLine(counts.branches, "branche", "branches"),
    countLine(counts.contexts, "contexte pédagogique", "contextes pédagogiques"),
    countLine(counts.pedagogicalPaths, "parcours pédagogique", "parcours pédagogiques"),
    countLine(counts.annualCourses, "cours annuel", "cours annuels"),
    countLine(counts.assignments, "attribution", "attributions"),
    countLine(counts.courseScheduleSlots, "horaire", "horaires"),
    countLine(counts.attendanceDays, "jour de cours", "jours de cours"),
    countLine(counts.publications, "publication", "publications"),
    countLine(counts.memberships, "accès enseignant", "accès enseignants"),
    countLine(counts.studentAccesses, "accès apprenti", "accès apprentis"),
    countLine(counts.annualCourseNotes, "note annuelle", "notes annuelles"),
    countLine(counts.teacherNotes, "note professeur", "notes professeur"),
    countLine(counts.classrooms, "classe runtime", "classes runtime"),
    countLine(counts.subjects, "matière runtime", "matières runtime"),
    countLine(counts.timetableSlots, "créneau horaire importé", "créneaux horaires importés"),
    countLine(counts.publicationTemplates, "modèle de publication", "modèles de publication"),
  ].filter((line): line is string => Boolean(line));
}

export function previewFromPlan(plan: CatalogDeletePlan): CatalogDeletePreview {
  return {
    ok: true,
    kind: plan.kind,
    target: plan.target,
    confirmationText: plan.confirmationText,
    warning: CATALOG_DELETE_WARNING,
    irreversible: CATALOG_DELETE_IRREVERSIBLE,
    counts: plan.counts,
    lines: formatCatalogDeleteLines(plan.counts),
  };
}
