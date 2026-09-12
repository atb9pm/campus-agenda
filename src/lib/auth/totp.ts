import { Secret, TOTP } from "otpauth";

export const TOTP_ISSUER = "Campus Agenda";
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function buildTotp(secret: string, accountName: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label: accountName || "admin",
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secret.replace(/\s+/g, "")),
  });
}

export function totpOtpauthUri(secret: string, accountName: string): string {
  return buildTotp(secret, accountName).toString();
}

export function generateTotpCode(secret: string, timestamp?: number): string {
  const totp = buildTotp(secret, "verify");
  return timestamp === undefined ? totp.generate() : totp.generate({ timestamp });
}

export function normalizeTotpInput(value: string): string | null {
  const digits = value.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  return digits;
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const normalized = normalizeTotpInput(token);
  if (!normalized) return false;
  const delta = buildTotp(secret, "verify").validate({
    token: normalized,
    window: TOTP_WINDOW,
  });
  return delta !== null;
}
