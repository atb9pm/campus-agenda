import type { AppSession } from "../persistence/types.ts";
import { getAuthSecret } from "./config.ts";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signPayload(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifySignature(payload: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), new TextEncoder().encode(payload));
}

export async function createSessionToken(session: AppSession): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    ...session,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })));
  const signature = await signPayload(payload);
  return `${payload}.${signature}`;
}

export async function parseSessionToken(token: string | null | undefined): Promise<AppSession | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!(await verifySignature(payload, signature))) return null;

  const decoded = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as AppSession & { expiresAt: number };
  if (decoded.expiresAt < Date.now()) return null;

  if (decoded.kind === "teacher") {
    return { kind: "teacher", teacherId: decoded.teacherId, issuedAt: decoded.issuedAt };
  }
  return {
    kind: "student",
    accessId: decoded.accessId,
    classroomId: decoded.classroomId,
    label: decoded.label,
    issuedAt: decoded.issuedAt,
  };
}

export function getSessionCookieName(): string {
  return "campus_session";
}

export function readSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const name = `${getSessionCookieName()}=`;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name));
  return match ? decodeURIComponent(match.slice(name.length)) : null;
}

export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${getSessionCookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  return `${getSessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
