import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { filterSlotsForCourseDay, parseTimetableCell, parseTimetablePdf, isReceivableTimetable } from "../src/features/timetable/index.ts";

const fixturePath = new URL("./fixtures/Horaire_MA_2026_2027_Vdef.pdf", import.meta.url);

test("phase 2.2 — parser PDF horaire secteur MA recevable", async () => {
  const bytes = new Uint8Array(readFileSync(fixturePath));
  const parsed = await parseTimetablePdf(bytes);
  assert.equal(parsed.schoolYearLabel, "2026-2027");
  assert.ok(isReceivableTimetable(parsed));
  assert.ok(parsed.slots.length >= 200);
  assert.ok(parsed.classes.some((entry) => entry.classCode === "COND1"));
});

test("phase 2.2 — COND1 lundi : BG P6-8 fixes + T.Ph P3-4 semaine A", async () => {
  const bytes = new Uint8Array(readFileSync(fixturePath));
  const parsed = await parseTimetablePdf(bytes);
  const cond1Monday = parsed.slots.filter((slot) => slot.classCode === "COND1" && slot.dayOfWeek === 0);

  const bgFixed = cond1Monday.filter((slot) => slot.branchLabel === "BG" && slot.weekKind === "all");
  assert.deepEqual(bgFixed.map((slot) => slot.period).sort(), [6, 7, 8]);

  const tphWeekA = cond1Monday.filter((slot) => slot.branchLabel === "T.Ph" && slot.weekKind === "A");
  assert.deepEqual(tphWeekA.map((slot) => slot.period).sort(), [3, 4]);

  assert.equal(cond1Monday.some((slot) => /SPS/i.test(slot.branchLabel)), false);
});

test("phase 2.2 — MMA1A : BG P9-10 toutes semaines + P7-8 semaine A", async () => {
  const bytes = new Uint8Array(readFileSync(fixturePath));
  const parsed = await parseTimetablePdf(bytes);
  const mma1aBg = parsed.slots.filter((slot) => slot.classCode === "MMA1A" && slot.branchLabel === "BG");

  assert.ok(mma1aBg.some((slot) => slot.period === 9 && slot.weekKind === "all"));
  assert.ok(mma1aBg.some((slot) => slot.period === 10 && slot.weekKind === "all"));
  assert.ok(mma1aBg.some((slot) => slot.period === 7 && slot.weekKind === "A"));
  assert.ok(mma1aBg.some((slot) => slot.period === 8 && slot.weekKind === "A"));
});

test("phase 2.2 — cellules SPS exclues", () => {
  const spsOnly = parseTimetableCell("SPS-A / -B");
  assert.equal(spsOnly.length, 1);
  assert.equal(spsOnly[0]?.skip, true);

  const bgWeekB = parseTimetableCell("BG / SPS-A CaF");
  assert.equal(bgWeekB[0]?.branchLabel, "BG");
  assert.equal(bgWeekB[0]?.weekKind, "B");

  const bgStarWeekA = parseTimetableCell("BG */ SPS-A CaF");
  assert.equal(bgStarWeekA[0]?.weekKind, "A");
});

test("phase 2.2 — filtre créneaux par semaine scolaire A/B", () => {
  const slots = [
    { classCode: "COND1", dayOfWeek: 0 as const, period: 3, branchLabel: "T.Ph", teacherCode: null, weekKind: "A" as const },
    { classCode: "COND1", dayOfWeek: 0 as const, period: 6, branchLabel: "BG", teacherCode: "CPE", weekKind: "all" as const },
  ];
  const weekA = filterSlotsForCourseDay(slots, "COND1", 0, "A");
  const weekB = filterSlotsForCourseDay(slots, "COND1", 0, "B");
  assert.equal(weekA.length, 2);
  assert.equal(weekB.length, 1);
  assert.equal(weekB[0]?.branchLabel, "BG");
});
