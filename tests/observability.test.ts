import assert from "node:assert/strict";
import test from "node:test";

import { attachRequestId, createRequestId, readRequestId } from "../src/lib/observability/request-id.ts";

test("phase 0.8 — identifiant de requête généré et propagé", () => {
  const requestId = createRequestId();
  assert.match(requestId, /^req_/);

  const headers = new Headers();
  attachRequestId(headers, requestId);
  assert.equal(headers.get("x-request-id"), requestId);

  const request = new Request("http://localhost/api/health", {
    headers: { "x-request-id": "req_test_abc" },
  });
  assert.equal(readRequestId(request), "req_test_abc");
});
