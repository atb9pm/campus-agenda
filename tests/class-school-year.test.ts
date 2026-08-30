import assert from "node:assert/strict";
import test from "node:test";

import { SCHOOL_WEEK_MONDAYS } from "../src/features/calendar/index.ts";
import {
  findUniqueSchoolYearIdForLabel,
  listSelectableSchoolYearsForClassEdit,
  listSelectableSchoolYearsForNewClass,
  resolveClassSchoolYearAttachment,
} from "../src/features/school-catalog/index.ts";
import {
  getMemorySchoolCatalogStore,
  resetMemorySchoolCatalogStore,
} from "../src/lib/persistence/memory-school-catalog-store.ts";
import {
  MemorySchoolYearStore,
  resetMemorySchoolYearStore,
} from "../src/lib/persistence/memory-school-year-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";
import { SqlSchoolYearStore } from "../src/lib/persistence/sql/sql-school-year-store.ts";

function freshMemoryCatalog() {
  resetMemorySchoolCatalogStore();
  return getMemorySchoolCatalogStore();
}

function freshMemoryYears() {
  resetMemorySchoolYearStore();
  return new MemorySchoolYearStore();
}

function buildPlan(label: string) {
  return {
    label,
    startsOn: `${label.slice(0, 4)}-08-01`,
    endsOn: `${label.slice(5)}-07-31`,
    weeks: SCHOOL_WEEK_MONDAYS.map((entry) => ({
      number: entry.number,
      kind: entry.kind,
      monday: entry.monday,
    })),
    warnings: [] as string[],
  };
}

test("classe legacy — schoolYearId null accepté", async () => {
  const catalog = freshMemoryCatalog();
  const created = await catalog.createClass({
    code: "LEG1",
    label: "LEG1",
    schoolYearId: null,
    schoolYearLabel: "2024-2025",
  });
  assert.equal(created.schoolYearId, null);
  assert.equal(created.schoolYearLabel, "2024-2025");
});

test("création classe — schoolYearId valide synchronise le label", () => {
  const years = [
    { id: "sy-active", label: "2026-2027", status: "active" as const },
    { id: "sy-draft", label: "2027-2028", status: "draft" as const },
  ];
  const resolved = resolveClassSchoolYearAttachment({
    schoolYearId: "sy-active",
    schoolYearLabel: "libellé obsolète",
    years,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.schoolYearId, "sy-active");
  assert.equal(resolved.value.schoolYearLabel, "2026-2027");
});

test("création classe — schoolYearId inexistant refusé", () => {
  const resolved = resolveClassSchoolYearAttachment({
    schoolYearId: "does-not-exist",
    schoolYearLabel: null,
    years: [{ id: "sy-1", label: "2026-2027", status: "active" }],
  });
  assert.equal(resolved.ok, false);
});

test("modification schoolYearId — label resynchronisé", async () => {
  const yearsStore = freshMemoryYears();
  await yearsStore.seedDefaultActiveYearIfEmpty();
  const years = await yearsStore.listSchoolYears();
  const active = years.find((entry) => entry.status === "active");
  assert.ok(active);

  const catalog = freshMemoryCatalog();
  const created = await catalog.createClass({
    code: "MOD1",
    label: "MOD1",
    schoolYearId: null,
    schoolYearLabel: null,
  });
  const attachment = resolveClassSchoolYearAttachment({
    schoolYearId: active.id,
    schoolYearLabel: created.schoolYearLabel,
    years,
  });
  assert.equal(attachment.ok, true);
  if (!attachment.ok) return;
  const updated = await catalog.updateClass(created.id, {
    schoolYearId: attachment.value.schoolYearId,
    schoolYearLabel: attachment.value.schoolYearLabel,
  });
  assert.equal(updated?.schoolYearId, active.id);
  assert.equal(updated?.schoolYearLabel, active.label);
});

test("classe liée à une année active", async () => {
  const yearsStore = freshMemoryYears();
  await yearsStore.seedDefaultActiveYearIfEmpty();
  const active = await yearsStore.getActiveSchoolYear();
  assert.ok(active);
  assert.equal(active.status, "active");

  const catalog = freshMemoryCatalog();
  const created = await catalog.createClass({
    code: "ACT1",
    label: "ACT1",
    schoolYearId: active.id,
    schoolYearLabel: active.label,
  });
  assert.equal(created.schoolYearId, active.id);
});

test("classe historique liée à une année archivée", async () => {
  const yearsStore = freshMemoryYears();
  await yearsStore.seedDefaultActiveYearIfEmpty();
  const firstActive = await yearsStore.getActiveSchoolYear();
  assert.ok(firstActive);

  const draft = await yearsStore.importDraftFromPlan(buildPlan("2027-2028"), "plan-test.pdf");
  await yearsStore.activateSchoolYear(draft.id);

  const years = await yearsStore.listSchoolYears();
  const archived = years.find((entry) => entry.id === firstActive.id);
  assert.ok(archived);
  assert.equal(archived.status, "archived");

  const catalog = freshMemoryCatalog();
  const historical = await catalog.createClass({
    code: "HIST1",
    label: "HIST1",
    schoolYearId: archived.id,
    schoolYearLabel: archived.label,
  });
  assert.equal(historical.schoolYearId, archived.id);
  assert.equal(historical.schoolYearLabel, archived.label);

  const selectable = listSelectableSchoolYearsForClassEdit(years, historical.schoolYearId);
  assert.ok(selectable.some((entry) => entry.id === archived.id));

  const forNew = listSelectableSchoolYearsForNewClass(years);
  assert.ok(!forNew.some((entry) => entry.id === archived.id));
});

test("synchronisation label depuis SchoolYearRecord", () => {
  const years = [{ id: "sy", label: "2030-2031", status: "draft" as const }];
  const resolved = resolveClassSchoolYearAttachment({
    schoolYearId: "sy",
    schoolYearLabel: "2020-2021",
    years,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.schoolYearLabel, "2030-2031");
});

test("backfill — correspondance certaine unique", () => {
  const years = [
    { id: "a", label: "2026-2027" },
    { id: "b", label: "2025-2026" },
  ];
  assert.equal(findUniqueSchoolYearIdForLabel("2026-2027", years), "a");
});

test("backfill — ambiguïté ou absence → null", () => {
  const ambiguous = [
    { id: "a", label: "2026-2027" },
    { id: "b", label: "2026-2027" },
  ];
  assert.equal(findUniqueSchoolYearIdForLabel("2026-2027", ambiguous), null);
  assert.equal(findUniqueSchoolYearIdForLabel("2099-2100", [{ id: "a", label: "2026-2027" }]), null);
  assert.equal(findUniqueSchoolYearIdForLabel(null, []), null);
});

test("persistence mémoire — schoolYearId survit au listage", async () => {
  const yearsStore = freshMemoryYears();
  await yearsStore.seedDefaultActiveYearIfEmpty();
  const active = await yearsStore.getActiveSchoolYear();
  assert.ok(active);
  const catalog = freshMemoryCatalog();
  await catalog.createClass({
    code: "MEMSY",
    label: "MEMSY",
    schoolYearId: active.id,
    schoolYearLabel: active.label,
  });
  const listed = (await catalog.listClasses()).find((entry) => entry.code === "MEMSY");
  assert.equal(listed?.schoolYearId, active.id);
  assert.equal(listed?.schoolYearLabel, active.label);
});

test("persistence SQLite — schoolYearId + migration base existante", async () => {
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  await applyMigrations(db);

  const yearStore = new SqlSchoolYearStore(db);
  await yearStore.seedDefaultActiveYearIfEmpty();
  const active = await yearStore.getActiveSchoolYear();
  assert.ok(active);

  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  const beforeCodes = (await catalog.listBranches()).map((entry) => entry.adminCode);

  const backfilled = await catalog.applySchoolYearBackfill(await yearStore.listSchoolYears());
  assert.ok(backfilled >= 1);

  const seeded = await catalog.listClasses();
  assert.ok(seeded.some((entry) => entry.schoolYearId === active.id));

  const created = await catalog.createClass({
    code: "SQLSY",
    label: "SQLSY",
    schoolYearId: active.id,
    schoolYearLabel: active.label,
  });
  assert.equal(created.schoolYearId, active.id);

  const legacy = await catalog.createClass({
    code: "SQLLEG",
    label: "SQLLEG",
    schoolYearId: null,
    schoolYearLabel: "ancienne-étiquette",
  });
  assert.equal(legacy.schoolYearId, null);

  const afterCodes = (await catalog.listBranches()).map((entry) => entry.adminCode);
  assert.deepEqual(afterCodes, beforeCodes);

  const profession = await catalog.createProfession({ label: "Ctrl IDs", durationYears: 3 });
  assert.match(profession.adminCode, /^PRF-\d{4}$/);

  db.close();
});

test("trainingYear et schoolYearId restent des notions distinctes", async () => {
  const yearsStore = freshMemoryYears();
  await yearsStore.seedDefaultActiveYearIfEmpty();
  const active = await yearsStore.getActiveSchoolYear();
  assert.ok(active);
  const catalog = freshMemoryCatalog();
  const profession = await catalog.createProfession({ label: "Méca", durationYears: 3 });
  const created = await catalog.createClass({
    code: "MA1N",
    label: "MA1N",
    schoolYearId: active.id,
    schoolYearLabel: active.label,
    professionId: profession.id,
    trainingYear: 1,
  });
  assert.equal(created.trainingYear, 1);
  assert.equal(created.schoolYearId, active.id);
  assert.notEqual(String(created.trainingYear), created.schoolYearId);
});

test("backfill mémoire — label unique renseigné, ambigu laissé null", async () => {
  const yearsStore = freshMemoryYears();
  await yearsStore.seedDefaultActiveYearIfEmpty();
  const years = await yearsStore.listSchoolYears();
  const catalog = freshMemoryCatalog();
  await catalog.ensureSeeded();

  // Classes seedées ont schoolYearLabel 2026-2027 et schoolYearId null avant backfill
  // (ensureSeeded déjà appelé : appliquer backfill)
  const count = await catalog.applySchoolYearBackfill(years);
  assert.ok(count >= 1);
  const linked = (await catalog.listClasses()).filter((entry) => entry.schoolYearLabel === "2026-2027");
  assert.ok(linked.every((entry) => entry.schoolYearId === years[0]!.id));

  await catalog.createClass({
    code: "AMBIG",
    label: "AMBIG",
    schoolYearId: null,
    schoolYearLabel: "label-sans-année",
  });
  const secondPass = await catalog.applySchoolYearBackfill(years);
  assert.equal(secondPass, 0);
  const ambiguous = (await catalog.listClasses()).find((entry) => entry.code === "AMBIG");
  assert.equal(ambiguous?.schoolYearId, null);
});
