/** `security@example.ch` → `se••••@example.ch`. Jamais l'adresse complète dans l'interface. */
export function maskEmailAddress(value: string): string | null {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 2);
  return `${visible}••••@${domain}`;
}
