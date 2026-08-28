import { jsonResponse } from "../../../lib/server/api.ts";
import { APP_VERSION, getStoreKind } from "@campus/lib/persistence/store-factory.ts";
import { readDeployInfo } from "../../../lib/server/deploy-info.ts";
import { withApiObservability } from "../../../lib/server/observability.ts";

const STARTED_AT = Date.now();

async function handleGet() {
  const [store, deploy] = await Promise.all([getStoreKind(), readDeployInfo()]);
  return jsonResponse({
    ok: true,
    service: "campus-agenda",
    version: APP_VERSION,
    store,
    commit: deploy?.shortCommit ?? null,
    builtAt: deploy?.builtAt ?? null,
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
}

export const GET = withApiObservability("/api/health", handleGet);
