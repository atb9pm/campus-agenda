/** Server-side test/operator entry point, using the same persisted preview and atomic apply. */
import { readFile } from "node:fs/promises";
import { resolveAgendaStore } from "../src/lib/persistence/store-factory.ts";
import { SqlYearTransitionPreviewStore } from "../src/lib/persistence/sql/sql-year-transition-preview-store.ts";
import { SqlYearTransitionApplyStore } from "../src/lib/persistence/sql/sql-year-transition-apply-store.ts";
import { assembleLiveYearTransitionPreviewInput, applyPersistedYearTransition,
  createPersistedYearTransitionPreview, type YearTransitionClassMapping } from "../src/features/year-transition/index.ts";

const [action, argument] = process.argv.slice(2).filter(arg => arg !== "--");
if (!["inspect", "preview", "apply"].includes(action ?? "") || (action !== "inspect" && !argument)) {
  throw new Error("Usage: node --experimental-strip-types ../scripts/year-transition.ts inspect | preview config.json | apply transitionId");
}
const resolved = await resolveAgendaStore();
if (!resolved.sqlDb) throw new Error("Une base persistante SQLite/D1 est requise ; le mode mémoire est refusé.");
const deps = { previews: new SqlYearTransitionPreviewStore(resolved.sqlDb),
  applyStore: new SqlYearTransitionApplyStore(resolved.sqlDb), years: resolved.schoolYearStore,
  courses: resolved.annualCourseStore, agenda: resolved.store, paths: resolved.pedagogicalPathStore,
  schedules: resolved.courseScheduleStore, adapters: resolved.adapters, notes: resolved.annualCourseNotesStore };

if (action === "inspect") {
  console.log(JSON.stringify({ years: (await deps.years.listSchoolYears()).map(y => ({ id: y.id, label: y.label, status: y.status })),
    courses: await deps.courses.listCourses() }, null, 2));
} else if (action === "preview") {
  const raw: unknown = JSON.parse(await readFile(argument!, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("Configuration invalide.");
  const config = raw as Record<string, unknown>;
  for (const key of ["sourceSchoolYearId", "targetSchoolYearId"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw new Error(`${key} obligatoire.`);
  }
  if (config.sourceSchoolYearId === config.targetSchoolYearId) throw new Error("Les années doivent être différentes.");
  const target = await deps.years.getSchoolYearById(config.targetSchoolYearId as string);
  if (!target || target.status !== "draft") throw new Error("L'année cible doit être en brouillon.");
  if (config.includePrivateNotes !== undefined && typeof config.includePrivateNotes !== "boolean") throw new Error("includePrivateNotes doit être un booléen.");
  if (config.includePrivateNotes && (typeof config.privateNotesOwnerTeacherId !== "string" || !config.privateNotesOwnerTeacherId.trim())) {
    throw new Error("privateNotesOwnerTeacherId obligatoire pour inclure les notes.");
  }
  if (!Array.isArray(config.classMappings) || !config.classMappings.every(m => m && typeof m === "object"
    && (m.sourceClassId === null || typeof m.sourceClassId === "string")
    && (m.targetClassId === null || typeof m.targetClassId === "string"))) throw new Error("Correspondances de classes invalides.");
  const input = await assembleLiveYearTransitionPreviewInput({ sourceSchoolYearId: config.sourceSchoolYearId as string,
    targetSchoolYearId: config.targetSchoolYearId as string, classMappings: config.classMappings as YearTransitionClassMapping[],
    includePrivateNotes: config.includePrivateNotes === true, privateNotesOwnerTeacherId: config.privateNotesOwnerTeacherId as string | undefined }, deps);
  const result = await createPersistedYearTransitionPreview(input, { store: deps.previews });
  // Note contents stay private; output only identities and placement diagnostics.
  console.log(JSON.stringify({ transitionId: result.id, fingerprint: result.fingerprint,
    publications: result.preview.entries, notes: result.preview.privateNotes ?? [] }, null, 2));
} else {
  const result = await applyPersistedYearTransition(argument!, deps);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
