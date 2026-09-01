import assert from "node:assert/strict";
import test from "node:test";

import {
  CTX_CREATE_ARCHIVED_BRANCH_REASON,
  CTX_CREATE_ARCHIVED_PROFESSION_REASON,
  CTX_CREATE_INACTIVE_BRANCH_REASON,
  CTX_CREATE_INACTIVE_PROFESSION_REASON,
  CTX_RESTORE_ARCHIVED_BRANCH_REASON,
  CTX_RESTORE_ARCHIVED_PROFESSION_REASON,
  CTX_RESTORE_INACTIVE_BRANCH_REASON,
  CTX_RESTORE_INACTIVE_PROFESSION_REASON,
} from "../src/features/school-catalog/index.ts";
import type { SchoolCatalogStore } from "../src/lib/persistence/school-catalog-types.ts";
import { MemorySchoolCatalogStore } from "../src/lib/persistence/memory-school-catalog-store.ts";
import { createNodeSqliteDatabase } from "../src/lib/persistence/sql/adapters.ts";
import { applyMigrations } from "../src/lib/persistence/sql/migrate.ts";
import { SqlSchoolCatalogStore } from "../src/lib/persistence/sql/sql-school-catalog-store.ts";

type Backend = "memory" | "sqlite";

const BACKENDS: Backend[] = ["memory", "sqlite"];

async function openCatalog(backend: Backend): Promise<{
  catalog: SchoolCatalogStore;
  dispose: () => void;
}> {
  if (backend === "memory") {
    const catalog = new MemorySchoolCatalogStore();
    await catalog.ensureSeeded();
    return { catalog, dispose: () => undefined };
  }
  const db = createNodeSqliteDatabase(":memory:");
  await applyMigrations(db);
  const catalog = new SqlSchoolCatalogStore(db);
  await catalog.ensureSeeded();
  return { catalog, dispose: () => db.close() };
}

async function setupParents(catalog: SchoolCatalogStore, tag: string) {
  const profession = await catalog.createProfession({
    label: `Profession ${tag}`,
    durationYears: 4,
    classCodePrefix: tag,
  });
  const branch = await catalog.createBranch({
    code: `BR${tag}`,
    label: `Branche ${tag}`,
    teachingType: "TECHNICAL",
  });
  return { profession, branch };
}

for (const backend of BACKENDS) {
  test(`${backend} A — profession et branche actives : création CTX OK`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZA" : "YA");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, true, created.ok ? "" : created.reason);
      if (!created.ok) return;
      assert.equal(created.value.professionId, profession.id);
      assert.equal(created.value.branchId, branch.id);
      assert.equal(created.value.isArchived, false);
      assert.equal(created.value.isActive, true);
    } finally {
      dispose();
    }
  });

  test(`${backend} B — profession désactivée : création CTX refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZB" : "YB");
      await catalog.updateProfession(profession.id, { isActive: false });
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, false);
      if (!created.ok) assert.equal(created.reason, CTX_CREATE_INACTIVE_PROFESSION_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} C — profession archivée : création CTX refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZC" : "YC");
      await catalog.updateProfession(profession.id, { isArchived: true });
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, false);
      if (!created.ok) assert.equal(created.reason, CTX_CREATE_ARCHIVED_PROFESSION_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} D — branche désactivée : création CTX refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZD" : "YD");
      await catalog.updateBranch(branch.id, { isActive: false });
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, false);
      if (!created.ok) assert.equal(created.reason, CTX_CREATE_INACTIVE_BRANCH_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} E — branche archivée : création CTX refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZE" : "YE");
      await catalog.updateBranch(branch.id, { isArchived: true });
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, false);
      if (!created.ok) assert.equal(created.reason, CTX_CREATE_ARCHIVED_BRANCH_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} F — CTX archivé + parents actifs : restauration même contextId`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZF" : "YF");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 2,
        branchId: branch.id,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const archived = await catalog.updateContext(created.value.id, { isArchived: true });
      assert.equal(archived.ok, true);
      const restored = await catalog.updateContext(created.value.id, {
        isArchived: false,
        isActive: true,
      });
      assert.equal(restored.ok, true);
      if (!restored.ok) return;
      assert.equal(restored.value.id, created.value.id);
      assert.equal(restored.value.isArchived, false);
      assert.equal(restored.value.isActive, true);
    } finally {
      dispose();
    }
  });

  test(`${backend} G — CTX archivé + profession désactivée : restauration refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZG" : "YG");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await catalog.updateContext(created.value.id, { isArchived: true });
      await catalog.updateProfession(profession.id, { isActive: false });
      const restored = await catalog.updateContext(created.value.id, {
        isArchived: false,
        isActive: true,
      });
      assert.equal(restored.ok, false);
      if (!restored.ok) assert.equal(restored.reason, CTX_RESTORE_INACTIVE_PROFESSION_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} H — CTX archivé + profession archivée : restauration refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZH" : "YH");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await catalog.updateContext(created.value.id, { isArchived: true });
      await catalog.updateProfession(profession.id, { isArchived: true });
      const restored = await catalog.updateContext(created.value.id, {
        isArchived: false,
        isActive: true,
      });
      assert.equal(restored.ok, false);
      if (!restored.ok) assert.equal(restored.reason, CTX_RESTORE_ARCHIVED_PROFESSION_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} I — CTX archivé + branche désactivée : restauration refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZI" : "YI");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await catalog.updateContext(created.value.id, { isArchived: true });
      await catalog.updateBranch(branch.id, { isActive: false });
      const restored = await catalog.updateContext(created.value.id, {
        isArchived: false,
        isActive: true,
      });
      assert.equal(restored.ok, false);
      if (!restored.ok) assert.equal(restored.reason, CTX_RESTORE_INACTIVE_BRANCH_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} J — CTX archivé + branche archivée : restauration refusée`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZJ" : "YJ");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 1,
        branchId: branch.id,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await catalog.updateContext(created.value.id, { isArchived: true });
      await catalog.updateBranch(branch.id, { isArchived: true });
      const restored = await catalog.updateContext(created.value.id, {
        isArchived: false,
        isActive: true,
      });
      assert.equal(restored.ok, false);
      if (!restored.ok) assert.equal(restored.reason, CTX_RESTORE_ARCHIVED_BRANCH_REASON);
    } finally {
      dispose();
    }
  });

  test(`${backend} K — parent ensuite désactivé : archivage/désactivation CTX toujours possible`, async () => {
    const { catalog, dispose } = await openCatalog(backend);
    try {
      const { profession, branch } = await setupParents(catalog, backend === "memory" ? "ZK" : "YK");
      const created = await catalog.createContext({
        professionId: profession.id,
        trainingYear: 3,
        branchId: branch.id,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await catalog.updateProfession(profession.id, { isActive: false });
      await catalog.updateBranch(branch.id, { isActive: false });
      const deactivated = await catalog.updateContext(created.value.id, { isActive: false });
      assert.equal(deactivated.ok, true, deactivated.ok ? "" : deactivated.reason);
      if (!deactivated.ok) return;
      assert.equal(deactivated.value.isActive, false);
      const archived = await catalog.updateContext(created.value.id, { isArchived: true });
      assert.equal(archived.ok, true, archived.ok ? "" : archived.reason);
      if (!archived.ok) return;
      assert.equal(archived.value.isArchived, true);
    } finally {
      dispose();
    }
  });
}
