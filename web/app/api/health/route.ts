import { jsonResponse } from "../../../lib/server/api.ts";
import { withApiObservability } from "../../../lib/server/observability.ts";

const STARTED_AT = Date.now();

async function handleGet() {
  return jsonResponse({
    ok: true,
    service: "campus-agenda",
    version: "0.11.0",
    store: "memory",
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
}

export const GET = withApiObservability("/api/health", handleGet);
