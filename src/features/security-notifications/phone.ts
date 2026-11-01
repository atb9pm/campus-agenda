/** Format international E.164 : `+`, indicatif pays non nul, 8 à 15 chiffres au total. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function isE164PhoneNumber(value: unknown): value is string {
  return typeof value === "string" && E164_PATTERN.test(value);
}

/** `+41791234512` → `+41 •• ••• •• 12`. Seuls l'indicatif et les deux derniers chiffres restent visibles. */
export function maskPhoneNumber(value: string | null | undefined): string | null {
  if (!isE164PhoneNumber(value)) return null;
  const digits = value.slice(1);
  return `+${digits.slice(0, 2)} •• ••• •• ${digits.slice(-2)}`;
}
