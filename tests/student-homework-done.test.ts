import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrototypeAgendaItem } from "../src/features/agenda/demo-items.ts";
import { SQL_MIGRATION_FILES } from "../src/lib/persistence/sql/migrate.ts";
import {
  STUDENT_HOMEWORK_DONE_MAX_AGE_DAYS,
  isPublicationDone,
  parseHomeworkDoneStore,
  pruneHomeworkDoneStore,
  publicationFingerprint,
  readHomeworkDoneStore,
  studentHomeworkDoneStorageKey,
  toggleHomeworkDone,
  writeHomeworkDoneStore,
} from "../src/features/student/index.ts";

const DAY_MS = 86_400_000;

function publication(id: number, detail = "Questions 1 à 6"): PrototypeAgendaItem {
  return {
    id,
    classroomId: "classroom-mecauto2",
    subjectId: "subject-moteur",
    annualCourseId: "ac-moteur",
    authorTeacherId: "teacher-1",
    type: "HOMEWORK",
    title: "Exercices p. 12",
    detail,
    schoolWeekNumber: 11,
    day: 3,
    hour: 8,
    weekOffset: 0,
    studentVisible: true,
  };
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("une coche par publication, indépendante des autres", () => {
  const moteur = publication(1);
  const chassis = publication(2);
  const store = toggleHomeworkDone({}, moteur, 1_000);
  assert.equal(isPublicationDone(store, moteur), true);
  assert.equal(isPublicationDone(store, chassis), false);
  assert.equal(isPublicationDone(toggleHomeworkDone(store, moteur, 2_000), moteur), false);
});

test("modification du texte par l’enseignant : retour à « non fait »", () => {
  const original = publication(1);
  const store = toggleHomeworkDone({}, original, 1_000);
  const edited = { ...original, detail: "Questions 1 à 8" };
  assert.notEqual(publicationFingerprint(original), publicationFingerprint(edited));
  assert.equal(isPublicationDone(store, edited), false);
  assert.deepEqual(pruneHomeworkDoneStore(store, [edited], 2_000), {});
});

test("déplacement vers une autre séance ou masquage temporaire : la coche reste", () => {
  const original = publication(1);
  const store = toggleHomeworkDone({}, original, 1_000);
  const moved = { ...original, schoolWeekNumber: 12, day: 1, studentVisible: false };
  assert.equal(isPublicationDone(store, moved), true);
  const pruned = pruneHomeworkDoneStore(store, [publication(99)], 2_000);
  assert.ok(pruned["1"], "une publication absente garde sa coche jusqu’à expiration");
});

test("nettoyage : coches trop anciennes retirées, liste vide sans effet", () => {
  const item = publication(1);
  const store = toggleHomeworkDone({}, item, 0);
  assert.equal(pruneHomeworkDoneStore(store, [], 10 * DAY_MS * 1000), store);
  const later = (STUDENT_HOMEWORK_DONE_MAX_AGE_DAYS + 1) * DAY_MS;
  assert.deepEqual(pruneHomeworkDoneStore(store, [item], later), {});
});

test("localStorage : par classe, données corrompues ignorées, stockage indisponible sans erreur", () => {
  const storage = new MemoryStorage();
  const item = publication(1);
  writeHomeworkDoneStore(storage, "classe-a", toggleHomeworkDone({}, item, 1_000));
  assert.equal(isPublicationDone(readHomeworkDoneStore(storage, "classe-a"), item), true);
  assert.deepEqual(readHomeworkDoneStore(storage, "classe-b"), {});
  writeHomeworkDoneStore(storage, "classe-a", {});
  assert.equal(storage.getItem(studentHomeworkDoneStorageKey("classe-a")), null);

  assert.deepEqual(parseHomeworkDoneStore("{pas du json"), {});
  assert.deepEqual(parseHomeworkDoneStore('{"1":{"fp":3}}'), {});

  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  assert.deepEqual(readHomeworkDoneStore(broken, "classe-a"), {});
  assert.doesNotThrow(() => writeHomeworkDoneStore(broken, "classe-a", toggleHomeworkDone({}, item, 1)));
});

test("rendu : cercle sur la ligne de la branche, bouton (pas de case), absent en aperçu enseignant", async () => {
  const [panel, page, css] = await Promise.all([
    readFile(new URL("../web/app/components/student-homework-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /student-branch-head[\s\S]*student-course-chip[\s\S]*DoneToggle/);
  assert.match(panel, /aria-pressed=\{done\}/);
  assert.match(panel, /Marquer comme fait/);
  assert.doesNotMatch(panel, /checkbox/);
  assert.match(page, /studentEntry === "code" \? studentSession\?\.classroomId/);
  assert.match(page, /doneControl=\{studentDoneControl\}/);
  assert.match(css, /\.student-branch-block\.is-done \.student-branch-item \{[^}]*line-through/);
  assert.match(css, /\[aria-pressed="true"\] \.student-done-ring \{[^}]*var\(--blue\)/);
  assert.equal(SQL_MIGRATION_FILES.some((file) => /done/i.test(file)), false);
});
