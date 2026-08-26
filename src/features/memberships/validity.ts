import type { Membership } from "../../types/membership.ts";

function toTimestamp(value: string | Date): number {
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

/** Une affectation est active si `at` est dans [validFrom, validTo[ (validTo exclusif). */
export function isMembershipActiveAt(membership: Membership, at: string | Date = new Date()): boolean {
  const atTime = toTimestamp(at);
  const fromTime = toTimestamp(membership.validFrom);
  if (atTime < fromTime) return false;
  if (membership.validTo === null) return true;
  return atTime < toTimestamp(membership.validTo);
}

export function filterActiveMemberships(memberships: Membership[], at: string | Date = new Date()): Membership[] {
  return memberships.filter((membership) => isMembershipActiveAt(membership, at));
}
