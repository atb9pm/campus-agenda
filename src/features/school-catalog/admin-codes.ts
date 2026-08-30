/** Préfixes des codes administratifs stables (jamais recyclés). */
export type AdminCodeKind = "PRF" | "BR" | "CTX";

export function formatAdminCode(kind: AdminCodeKind, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("La séquence de code administratif doit être un entier ≥ 1.");
  }
  return `${kind}-${String(sequence).padStart(4, "0")}`;
}

export function parseAdminCodeSequence(adminCode: string, kind: AdminCodeKind): number | null {
  const match = adminCode.trim().toUpperCase().match(new RegExp(`^${kind}-(\\d+)$`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}
