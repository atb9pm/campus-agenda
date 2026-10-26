import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compareClassCode } from "../src/features/school-catalog/index.ts";

test("libellés Attributions des cours — AMA avant MECAUTO avant MECMA", () => {
  const labels = ["MECMA 3A", "MECAUTO 3B", "MECAUTO 2", "AMA 2", "CONDVL 1", "MACAM 2"];
  const sorted = [...labels].sort(compareClassCode);
  assert.deepEqual(sorted, ["AMA 2", "CONDVL 1", "MACAM 2", "MECAUTO 2", "MECAUTO 3B", "MECMA 3A"]);
});

test("Attributions des cours et Horaire des classes trient le menu Classe alphabétiquement", async () => {
  const [assignments, schedule, filter] = await Promise.all([
    readFile(new URL("../web/app/components/annual-courses-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../web/app/components/class-schedule-admin-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/course-schedule/class-filter.ts", import.meta.url), "utf8"),
  ]);
  assert.match(assignments, /compareClassCode/);
  assert.match(assignments, /annual-course-class-picker/);
  assert.match(schedule, /listScheduleEditorClasses/);
  assert.match(filter, /compareClassCode\(left\.code, right\.code\)/);
  assert.doesNotMatch(filter, /left\.sortOrder - right\.sortOrder/);
});
