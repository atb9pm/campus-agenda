import type { AnnualCourse } from "../annual-courses/types.ts";
import {
  readMaxUpcomingControlDates,
  type MaxUpcomingControlDates,
} from "../school-catalog/control-dates.ts";
import type { PedagogicalContextRecord } from "../school-catalog/profession-types.ts";
import type { SchoolBranchRecord } from "../school-catalog/types.ts";
import { contextBranchForCourse } from "./reconcile.ts";

/**
 * Lien d’affichage : un cours annuel résolu vers sa branche officielle.
 * L’absence de lien conserve une seule date. Jamais de correspondance par libellé.
 */
export interface UpcomingControlBranchLink {
  annualCourseId: string;
  branchId: string;
  maxUpcomingControlDates: MaxUpcomingControlDates;
}

export function upcomingControlLinksForAnnualCourses(options: {
  annualCourseIds: readonly string[];
  courses: readonly AnnualCourse[];
  contexts: readonly PedagogicalContextRecord[];
  branches: readonly SchoolBranchRecord[];
}): UpcomingControlBranchLink[] {
  const links: UpcomingControlBranchLink[] = [];
  const seen = new Set<string>();
  for (const rawId of options.annualCourseIds) {
    const annualCourseId = rawId.trim();
    if (!annualCourseId || seen.has(annualCourseId)) continue;
    seen.add(annualCourseId);
    const course = options.courses.find((entry) => entry.id === annualCourseId) ?? null;
    if (!course) continue;
    const linked = contextBranchForCourse({
      course,
      contexts: options.contexts,
      branches: options.branches,
    });
    if (!linked) continue;
    links.push({
      annualCourseId,
      branchId: linked.branch.id,
      maxUpcomingControlDates: readMaxUpcomingControlDates(linked.branch.maxUpcomingControlDates),
    });
  }
  return links;
}
