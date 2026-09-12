import { hashRecoveryCode, recoveryCodeMatches } from "./mfa-crypto.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_GROUP_LENGTH = 4;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const random = crypto.getRandomValues(new Uint8Array(RECOVERY_GROUP_LENGTH * 2));
    const chars = Array.from(random, (value) => ALPHABET[value % ALPHABET.length]);
    const code = `${chars.slice(0, RECOVERY_GROUP_LENGTH).join("")}-${chars.slice(RECOVERY_GROUP_LENGTH).join("")}`;
    codes.add(code);
  }
  return [...codes];
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatRecoveryCode(normalized: string): string | null {
  if (normalized.length !== RECOVERY_GROUP_LENGTH * 2) return null;
  if (![...normalized].every((char) => ALPHABET.includes(char))) return null;
  return `${normalized.slice(0, RECOVERY_GROUP_LENGTH)}-${normalized.slice(RECOVERY_GROUP_LENGTH)}`;
}

export function parseRecoveryInput(value: string): string | null {
  return formatRecoveryCode(normalizeRecoveryCode(value));
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashRecoveryCode(normalizeRecoveryCode(code))));
}

export async function recoveryCodeIsValid(input: string, hashes: string[]): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return false;
  for (const hash of hashes) {
    if (await recoveryCodeMatches(normalized, hash)) return true;
  }
  return false;
}

export async function consumeRecoveryCode(
  input: string,
  hashes: string[],
): Promise<{ ok: true; remaining: string[] } | { ok: false }> {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return { ok: false };

  let matchedIndex = -1;
  for (let index = 0; index < hashes.length; index += 1) {
    if (await recoveryCodeMatches(normalized, hashes[index]!)) {
      matchedIndex = index;
    }
  }
  if (matchedIndex < 0) return { ok: false };
  return {
    ok: true,
    remaining: hashes.filter((_, index) => index !== matchedIndex),
  };
}

export function parseRecoveryHashes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

export function serializeRecoveryHashes(hashes: string[]): string {
  return JSON.stringify(hashes);
}

export function recoveryHashesLookSafe(hashes: string[], plaintextCodes: string[]): boolean {
  const blob = hashes.join("\n").toUpperCase();
  return plaintextCodes.every((code) => {
    const normalized = normalizeRecoveryCode(code);
    return !blob.includes(normalized) && !blob.includes(code.toUpperCase());
  });
}
