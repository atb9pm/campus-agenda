import { getTimetableStore } from "@campus/lib/persistence/store-factory.ts";
import { jsonResponse, requireAdminSession } from "../../../../lib/server/api.ts";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const imports = await getTimetableStore().then((store) => store.listImports());
  const active = await getTimetableStore().then((store) => store.getActiveImport());
  return jsonResponse({ ok: true, imports, active });
}
