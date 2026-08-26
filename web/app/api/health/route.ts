import { jsonResponse } from "../../../lib/server/api.ts";
import { APP_VERSION, getStoreKind } from "@campus/lib/persistence/store-factory.ts";
import { withApiObservability } from "../../../lib/server/observability.ts";

const STARTED_AT = Date.now();

async function handleGet() {
  const store = await getStoreKind();
  return jsonResponse({
    ok: true,
    service: "campus-agenda",
    version: APP_VERSION,
    store,
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
}

export const GET = withApiObservability("/api/health", handleGet);
