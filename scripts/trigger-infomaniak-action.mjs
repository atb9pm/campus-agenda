/**
 * Déclenche une action Node.js Infomaniak via l'API Manager (build ou restart).
 *
 * Secrets GitHub requis :
 *   INFOMANIAK_HOSTING_ID, INFOMANIAK_VHOST_ROUTE_ID
 *   INFOMANIAK_SASESSION, INFOMANIAK_MANAGER_XSRF
 *
 * Usage : node scripts/trigger-infomaniak-action.mjs [build|restart]
 */
const action = process.argv[2] ?? "restart";
if (!["build", "restart", "start", "stop"].includes(action)) {
  console.error(`Action invalide : ${action}`);
  process.exit(1);
}

const hostingId = process.env.INFOMANIAK_HOSTING_ID?.trim();
const vhostRouteId = process.env.INFOMANIAK_VHOST_ROUTE_ID?.trim();
const sasession = process.env.INFOMANIAK_SASESSION?.trim();
const xsrf = process.env.INFOMANIAK_MANAGER_XSRF?.trim();

for (const [name, value] of [
  ["INFOMANIAK_HOSTING_ID", hostingId],
  ["INFOMANIAK_VHOST_ROUTE_ID", vhostRouteId],
  ["INFOMANIAK_SASESSION", sasession],
  ["INFOMANIAK_MANAGER_XSRF", xsrf],
]) {
  if (!value) {
    console.error(`❌ Secret manquant : ${name}`);
    process.exit(1);
  }
}

const url =
  `https://manager.infomaniak.com/proxy/1/hostings/${hostingId}` +
  `/nodejs/${vhostRouteId}/actions/${action}`;

console.log(`==> Infomaniak Manager : ${action}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    Cookie: `SASESSION=${sasession}`,
    "X-XSRF-TOKEN": xsrf,
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: "{}",
});

const text = await response.text();
let body = text;
try {
  body = JSON.parse(text);
} catch {
  // réponse texte brute
}

if (!response.ok) {
  console.error(`❌ HTTP ${response.status}`);
  console.error(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  console.error("");
  console.error("Les cookies Manager expirent : mettez à jour INFOMANIAK_SASESSION");
  console.error("et INFOMANIAK_MANAGER_XSRF dans les secrets GitHub.");
  process.exit(1);
}

console.log("✓ Action acceptée par Infomaniak");
if (body && typeof body === "object") {
  console.log(JSON.stringify(body, null, 2));
}
