import {
  generateStudentAccess,
  listStudentAccessMetadata,
  revokeStudentAccess,
  type StudentAccessAdminDeps,
} from "@campus/features/student-access/index.ts";
import {
  getRuntimeAgendaAdapterStore,
  getSchoolCatalogStore,
  getSchoolYearStore,
  getStudentAccessStore,
} from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function adminDeps(): Promise<StudentAccessAdminDeps> {
  const [accesses, adapters, catalog, years] = await Promise.all([
    getStudentAccessStore(),
    getRuntimeAgendaAdapterStore(),
    getSchoolCatalogStore(),
    getSchoolYearStore(),
  ]);
  await catalog.ensureSeeded();
  return {
    accesses,
    adapters,
    getSchoolClassById: async (id) => {
      const classes = await catalog.listClasses();
      return classes.find((entry) => entry.id === id) ?? null;
    },
    getSchoolYearById: (id) => years.getSchoolYearById(id),
    listClasses: () => catalog.listClasses(),
    listYears: () => years.listSchoolYears(),
  };
}

function assertNoSecretLeak(body: unknown): void {
  const serialized = JSON.stringify(body);
  if (
    serialized.includes("accessCodeHash")
    || serialized.includes("access_code_hash")
    || serialized.includes("accessCodeCiphertext")
    || serialized.includes("access_code_ciphertext")
    || serialized.includes("aes-gcm-v1$")
  ) {
    throw new Error("Le hash ou le chiffrement d'accès apprentis ne doit jamais être envoyé au client.");
  }
}

async function handleGet(request: Request) {
  try {
    const auth = await requireAdminSession(request);
    if ("error" in auth && auth.error) return auth.error;

    const schoolClassId = new URL(request.url).searchParams.get("schoolClassId")?.trim() || undefined;
    const deps = await adminDeps();
    const accesses = await listStudentAccessMetadata(deps, schoolClassId);
    const body = schoolClassId
      ? { ok: true, access: accesses[0] ?? null }
      : { ok: true, accesses };
    assertNoSecretLeak(body);
    return jsonResponse(body);
  } catch {
    return jsonResponse({ ok: false, reason: "Chargement des accès apprentis impossible." }, { status: 500 });
  }
}

async function handlePost(request: Request) {
  try {
    const auth = await requireAdminSession(request);
    if ("error" in auth && auth.error) return auth.error;

    const body = (await request.json()) as { schoolClassId?: string };
    const schoolClassId = String(body.schoolClassId ?? "").trim();
    if (!schoolClassId) {
      return jsonResponse({ ok: false, reason: "Identifiant de classe manquant." }, { status: 400 });
    }

    const result = await generateStudentAccess(await adminDeps(), schoolClassId);
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
    }
    const payload = { ok: true, access: result.access, code: result.code };
    assertNoSecretLeak(payload);
    return jsonResponse(payload);
  } catch {
    return jsonResponse({ ok: false, reason: "Génération impossible. Réessayez." }, { status: 500 });
  }
}

async function handleDelete(request: Request) {
  try {
    const auth = await requireAdminSession(request);
    if ("error" in auth && auth.error) return auth.error;

    const schoolClassId = new URL(request.url).searchParams.get("schoolClassId")?.trim() ?? "";
    if (!schoolClassId) {
      return jsonResponse({ ok: false, reason: "Identifiant de classe manquant." }, { status: 400 });
    }

    const result = await revokeStudentAccess(await adminDeps(), schoolClassId);
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason }, { status: result.status });
    }
    const payload = { ok: true, access: result.access };
    assertNoSecretLeak(payload);
    return jsonResponse(payload);
  } catch {
    return jsonResponse({ ok: false, reason: "Désactivation impossible. Réessayez." }, { status: 500 });
  }
}

export const GET = withApiObservability("/api/admin/student-access", handleGet);
export const POST = withApiObservability("/api/admin/student-access", handlePost);
export const DELETE = withApiObservability("/api/admin/student-access", handleDelete);
