export {
  CATALOG_DELETE_IRREVERSIBLE,
  CATALOG_DELETE_WARNING,
  confirmationMatches,
  emptyCatalogDeleteCounts,
  hasDestructiveDependencies,
  missingConfirmationReason,
  wrongConfirmationReason,
  type CatalogDeleteCounts,
  type CatalogDeleteKind,
  type CatalogDeletePlan,
  type CatalogDeletePreview,
  type CatalogDeleteTarget,
} from "./types.ts";
export { formatCatalogDeleteLines, previewFromPlan } from "./preview.ts";
export { buildCatalogDeletePlan, exclusiveClassroomIds, planSchoolClassDelete } from "./plan.ts";
export { loadCatalogDeleteSnapshot, type CatalogDeleteSnapshot, type CatalogDeleteSnapshotDeps } from "./snapshot.ts";
export {
  buildCatalogDeleteStatements,
  buildMembershipSubjectDeletes,
  SQL_ROLLBACK_PROBE,
} from "./sql-statements.ts";
export { deleteCatalogItemPermanently, previewCatalogDelete, type CatalogDeleteServiceResult } from "./service.ts";
