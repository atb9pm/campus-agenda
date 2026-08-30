import { ensurePathForContext, mutatePath } from "@campus/features/pedagogical-path/path-service.ts";
import {
  getCatalogStore,
  getPathStore,
  jsonResponse,
  requireAdminSession,
} from "../../../../lib/server/api.ts";
import { withApiObservability } from "../../../../lib/server/observability.ts";

async function handleGet(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  const contextId = new URL(request.url).searchParams.get("contextId")?.trim() ?? "";
  if (!contextId) {
    return jsonResponse({ ok: false, reason: "contextId obligatoire." }, { status: 400 });
  }

  const catalog = await getCatalogStore();
  const pathStore = await getPathStore();
  const result = await ensurePathForContext({ contextId, catalog, pathStore });
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status ?? 400 });
  }
  return jsonResponse({ ok: true, path: result.value });
}

async function handlePost(request: Request) {
  const auth = await requireAdminSession(request);
  if ("error" in auth && auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, reason: "Corps JSON invalide." }, { status: 400 });
  }

  const contextId = typeof body.contextId === "string" ? body.contextId.trim() : "";
  if (!contextId) {
    return jsonResponse({ ok: false, reason: "contextId obligatoire." }, { status: 400 });
  }

  const actionType = typeof body.action === "string" ? body.action : "ensure";
  const catalog = await getCatalogStore();
  const pathStore = await getPathStore();

  if (actionType === "ensure") {
    const result = await ensurePathForContext({ contextId, catalog, pathStore });
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: result.reason }, { status: result.status ?? 400 });
    }
    return jsonResponse({ ok: true, path: result.value });
  }

  const action = buildAction(actionType, body);
  if (!action) {
    return jsonResponse(
      { ok: false, reason: "Action inconnue ou paramètres incomplets." },
      { status: 400 },
    );
  }

  const result = await mutatePath({ contextId, catalog, pathStore, action });
  if (!result.ok) {
    return jsonResponse({ ok: false, reason: result.reason }, { status: result.status ?? 400 });
  }
  return jsonResponse({ ok: true, path: result.value });
}

function buildAction(
  actionType: string,
  body: Record<string, unknown>,
): Parameters<typeof mutatePath>[0]["action"] | null {
  switch (actionType) {
    case "addSession":
      return {
        type: "addSession",
        label: typeof body.label === "string" ? body.label : null,
      };
    case "insertSession":
      if (typeof body.atPosition !== "number") return null;
      return {
        type: "insertSession",
        atPosition: body.atPosition,
        label: typeof body.label === "string" ? body.label : null,
      };
    case "moveSession":
      if (typeof body.sessionId !== "string" || typeof body.position !== "number") return null;
      return {
        type: "moveSession",
        sessionId: body.sessionId,
        position: body.position,
      };
    case "updateSession":
      if (typeof body.sessionId !== "string") return null;
      return {
        type: "updateSession",
        sessionId: body.sessionId,
        label: typeof body.label === "string" ? body.label : null,
      };
    case "deleteSession":
      if (typeof body.sessionId !== "string") return null;
      return { type: "deleteSession", sessionId: body.sessionId };
    case "addItem":
      if (
        typeof body.sessionId !== "string" ||
        typeof body.itemType !== "string" ||
        typeof body.title !== "string"
      ) {
        return null;
      }
      return {
        type: "addItem",
        sessionId: body.sessionId,
        itemType: body.itemType,
        title: body.title,
        detail: typeof body.detail === "string" ? body.detail : "",
      };
    case "updateItem":
      if (typeof body.itemId !== "string") return null;
      return {
        type: "updateItem",
        itemId: body.itemId,
        itemType: typeof body.itemType === "string" ? body.itemType : undefined,
        title: typeof body.title === "string" ? body.title : undefined,
        detail: typeof body.detail === "string" ? body.detail : undefined,
      };
    case "moveItem":
      if (
        typeof body.itemId !== "string" ||
        typeof body.targetSessionId !== "string" ||
        typeof body.position !== "number"
      ) {
        return null;
      }
      return {
        type: "moveItem",
        itemId: body.itemId,
        targetSessionId: body.targetSessionId,
        position: body.position,
      };
    case "deleteItem":
      if (typeof body.itemId !== "string") return null;
      return { type: "deleteItem", itemId: body.itemId };
    default:
      return null;
  }
}

export const GET = withApiObservability("/api/admin/pedagogical-path", handleGet);
export const POST = withApiObservability("/api/admin/pedagogical-path", handlePost);
