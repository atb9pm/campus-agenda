import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyTeacherMenuNavigation,
  teacherNavClosesNotebook,
  TEACHER_NAV_SECTIONS,
  type TeacherMenuView,
  type TeacherNavSection,
} from "../src/features/teacher/index.ts";

const WEEK = 14;

function view(patch: Partial<TeacherMenuView> = {}): TeacherMenuView {
  return {
    section: "ma-semaine",
    notebookOpen: true,
    selectedSchoolWeekNumber: WEEK,
    ...patch,
  };
}

test("Ma semaine ferme le Carnet et conserve la semaine, même si la rubrique est déjà active", () => {
  const closed = applyTeacherMenuNavigation(view(), "ma-semaine");
  assert.equal(closed.notebookOpen, false);
  assert.equal(closed.section, "ma-semaine");
  assert.equal(closed.selectedSchoolWeekNumber, WEEK);

  const alreadyGlobal = applyTeacherMenuNavigation(view({ notebookOpen: false }), "ma-semaine");
  assert.deepEqual(alreadyGlobal, { section: "ma-semaine", notebookOpen: false, selectedSchoolWeekNumber: WEEK });
});

test("depuis Mes cours, Ma semaine affiche la vue globale sans changer la semaine", () => {
  const fromCourses = applyTeacherMenuNavigation(
    view({ section: "mes-cours", notebookOpen: true, selectedSchoolWeekNumber: 14 }),
    "ma-semaine",
  );
  assert.deepEqual(fromCourses, { section: "ma-semaine", notebookOpen: false, selectedSchoolWeekNumber: 14 });
});

test("les autres rubriques ne ferment pas le Carnet et ne changent pas la semaine", () => {
  for (const section of ["mes-cours", "controles", "configuration", "administration"] as const) {
    const next = applyTeacherMenuNavigation(view(), section);
    assert.equal(next.section, section);
    assert.equal(next.notebookOpen, true, section);
    assert.equal(next.selectedSchoolWeekNumber, WEEK, section);
    assert.equal(teacherNavClosesNotebook(section), false);
  }
  assert.equal(teacherNavClosesNotebook("ma-semaine"), true);
  assert.deepEqual([...TEACHER_NAV_SECTIONS], ["ma-semaine", "mes-cours", "controles", "configuration", "administration"]);
});

test("la navigation ne reçoit aucune publication ni note : la semaine seule est recopiée", () => {
  const current = view({ selectedSchoolWeekNumber: 14 });
  const publications = ["Devoir du 16", "Devoir du 23"];
  const notes = ["Note du 16"];
  const next = applyTeacherMenuNavigation(current, "ma-semaine");
  assert.deepEqual(publications, ["Devoir du 16", "Devoir du 23"]);
  assert.deepEqual(notes, ["Note du 16"]);
  assert.equal(next.selectedSchoolWeekNumber, current.selectedSchoolWeekNumber);
  assert.equal(Object.keys(next).length, 3);
});

test("le menu principal, le menu mobile et ← Ma semaine ferment le même Carnet", async () => {
  const page = await readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8");
  const navigate = page.slice(page.indexOf("function navigate("), page.indexOf("function showNotice"));
  assert.match(navigate, /if \(teacherNavClosesNotebook\(section\)\) closeClassNotebook\(\);/);
  assert.match(navigate, /setActiveSection\(section\);/);
  assert.doesNotMatch(navigate, /setSelectedSchoolWeekNumber/);
  assert.match(page, /function closeClassNotebook\(\) \{\s*setOpenNotebookClassId\(null\);\s*setOpenNotebookCourse\(null\);/);
  assert.doesNotMatch(page, /function closeClassNotebook\([\s\S]{0,220}setSelectedSchoolWeekNumber/);
  assert.match(page, /onBack=\{closeClassNotebook\}/);
  assert.equal(page.match(/onClick=\{\(\) => navigate\(section\)\}/g)?.length, 2);

  const sidebar = page.slice(page.indexOf('aria-label="Navigation principale"'), page.indexOf('aria-label="Navigation enseignant"'));
  const mobile = page.slice(page.indexOf('aria-label="Navigation enseignant"'));
  for (const surface of [sidebar, mobile]) {
    assert.match(surface, /navigate\(section\)/);
    assert.match(surface, /TEACHER_NAV_LABELS\[section\]/);
  }

  const sections: TeacherNavSection[] = ["ma-semaine", "mes-cours", "controles", "configuration"];
  assert.equal(sections.filter((section) => teacherNavClosesNotebook(section)).length, 1);
});
