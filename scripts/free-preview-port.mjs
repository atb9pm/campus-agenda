/**
 * Libère le(s) port(s) de prévisualisation avant un redémarrage.
 * Usage : node ../scripts/free-preview-port.mjs
 *         $env:PORT="5173"; node ../scripts/free-preview-port.mjs
 *
 * Par défaut libère 5173–5182 (plage utilisée par preview-local.mjs).
 */
import { execFileSync } from "node:child_process";
import net from "node:net";

const preferredPort = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";
const RANGE = Number(process.env.CAMPUS_FREE_PORT_RANGE ?? 10);
const ports = Array.from({ length: RANGE }, (_, offset) => preferredPort + offset);

function portStillBusy(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => {
      probe.close(() => resolve(false));
    });
    probe.listen({ port, host, exclusive: true });
  });
}

function pidsOnWindows(listenPort) {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${listenPort}`) || !line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts.at(-1));
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function pidsOnUnix(listenPort) {
  try {
    const out = execFileSync("lsof", ["-ti", `TCP:${listenPort}`, `-sTCP:LISTEN`], {
      encoding: "utf8",
    });
    return out
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

function pidsForPort(listenPort) {
  return process.platform === "win32" ? pidsOnWindows(listenPort) : pidsOnUnix(listenPort);
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

let freed = 0;
const allPids = new Set();

for (const port of ports) {
  for (const pid of pidsForPort(port)) {
    allPids.add(pid);
  }
}

if (allPids.size === 0) {
  const busy = [];
  for (const port of ports) {
    if (await portStillBusy(port)) busy.push(port);
  }
  if (busy.length) {
    console.error(`Ports occupés (${busy.join(", ")}), mais PID introuvable.`);
    console.error(`  $env:PORT="${preferredPort + RANGE}"; pnpm.cmd run preview:node`);
    process.exit(1);
  }
  console.log(`Ports ${preferredPort}–${preferredPort + RANGE - 1} déjà libres.`);
  process.exit(0);
}

for (const pid of allPids) {
  if (killPid(pid, "SIGTERM")) {
    console.log(`Processus ${pid} arrêté.`);
    freed += 1;
  }
}

await new Promise((resolve) => setTimeout(resolve, 400));

let stillBusy = [];
for (const port of ports) {
  if (await portStillBusy(port)) stillBusy.push(port);
}

if (stillBusy.length) {
  for (const pid of allPids) {
    killPid(pid, "SIGKILL");
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  stillBusy = [];
  for (const port of ports) {
    if (await portStillBusy(port)) stillBusy.push(port);
  }
}

if (stillBusy.length) {
  console.error(`Ports toujours occupés : ${stillBusy.join(", ")}`);
  console.error(`  $env:PORT="${Math.max(...stillBusy) + 1}"; pnpm.cmd run preview:node`);
  process.exit(1);
}

console.log(`Ports libérés (${freed} processus). Relancez : pnpm.cmd run preview:node`);
