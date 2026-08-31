import { classLifecycleStatus, type ClassLifecycleStatus } from "./class-lifecycle.ts";
import { classDisplaySchoolYearLabel, classDisplayTrainingYearLabel } from "./class-display.ts";
import type { SchoolProfessionRecord } from "./profession-types.ts";
import type { SchoolClassRecord } from "./types.ts";

export type ClassStatusFilter = ClassLifecycleStatus;
export type ClassGroupBy = "profession" | "schoolYear" | "trainingYear" | "code";

export interface ClassGroup {
  key: string;
  title: string;
  classes: SchoolClassRecord[];
}

export function filterClassesByStatus(
  classes: SchoolClassRecord[],
  status: ClassStatusFilter,
): SchoolClassRecord[] {
  return classes.filter((entry) => classLifecycleStatus(entry) === status);
}

export function countClassesByStatus(classes: SchoolClassRecord[]): Record<ClassStatusFilter, number> {
  return {
    active: filterClassesByStatus(classes, "active").length,
    inactive: filterClassesByStatus(classes, "inactive").length,
    archived: filterClassesByStatus(classes, "archived").length,
  };
}

function compareClassCode(left: string, right: string): number {
  return left.localeCompare(right, "fr-CH", { numeric: true, sensitivity: "base" });
}

function compareWithinGroup(left: SchoolClassRecord, right: SchoolClassRecord): number {
  const leftYear = left.trainingYear ?? Number.POSITIVE_INFINITY;
  const rightYear = right.trainingYear ?? Number.POSITIVE_INFINITY;
  if (leftYear !== rightYear) return leftYear - rightYear;
  const leftGroup = left.parallelCode ?? "";
  const rightGroup = right.parallelCode ?? "";
  if (leftGroup !== rightGroup) return compareClassCode(leftGroup, rightGroup);
  const byCode = compareClassCode(left.code, right.code);
  if (byCode !== 0) return byCode;
  return left.id.localeCompare(right.id);
}

function sortProfessions(professions: SchoolProfessionRecord[]): SchoolProfessionRecord[] {
  return [...professions].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.label.localeCompare(right.label, "fr-CH");
  });
}

export function groupSchoolClasses(options: {
  classes: SchoolClassRecord[];
  professions: SchoolProfessionRecord[];
  groupBy: ClassGroupBy;
}): ClassGroup[] {
  const sorted = [...options.classes].sort(compareWithinGroup);
  if (options.groupBy === "code") {
    return [
      {
        key: "code",
        title: "",
        classes: [...options.classes].sort((left, right) => {
          const byCode = compareClassCode(left.code, right.code);
          return byCode !== 0 ? byCode : left.id.localeCompare(right.id);
        }),
      },
    ];
  }

  if (options.groupBy === "profession") {
    const groups: ClassGroup[] = [];
    const used = new Set<string>();
    for (const profession of sortProfessions(options.professions)) {
      const classes = sorted.filter((entry) => entry.professionId === profession.id);
      if (classes.length === 0) continue;
      used.add(profession.id);
      const prefix = profession.classCodePrefix ? ` — ${profession.classCodePrefix}` : "";
      groups.push({
        key: profession.id,
        title: `${profession.label}${prefix}`,
        classes,
      });
    }
    const unassigned = sorted.filter(
      (entry) => !entry.professionId || !used.has(entry.professionId),
    );
    if (unassigned.length > 0) {
      groups.push({
        key: "profession-none",
        title: "Profession non renseignée",
        classes: unassigned,
      });
    }
    return groups;
  }

  if (options.groupBy === "schoolYear") {
    const byKey = new Map<string, { title: string; classes: SchoolClassRecord[] }>();
    for (const entry of sorted) {
      const key = entry.schoolYearId ?? "year-none";
      const title = entry.schoolYearId ? classDisplaySchoolYearLabel(entry) : "Année non renseignée";
      const group = byKey.get(key) ?? { title, classes: [] };
      group.classes.push(entry);
      byKey.set(key, group);
    }
    const named = [...byKey.entries()]
      .filter(([key]) => key !== "year-none")
      .sort((left, right) => right[1].title.localeCompare(left[1].title, "fr-CH", { numeric: true }));
    const groups = named.map(([key, group]) => ({ key, title: group.title, classes: group.classes }));
    const none = byKey.get("year-none");
    if (none) groups.push({ key: "year-none", title: none.title, classes: none.classes });
    return groups;
  }

  const byYear = new Map<number | "none", SchoolClassRecord[]>();
  for (const entry of sorted) {
    const key = entry.trainingYear ?? "none";
    const list = byYear.get(key) ?? [];
    list.push(entry);
    byYear.set(key, list);
  }
  const years = [...byYear.keys()].filter((key): key is number => key !== "none").sort((a, b) => a - b);
  const groups: ClassGroup[] = years.map((year) => ({
    key: `training-${year}`,
    title: classDisplayTrainingYearLabel(year),
    classes: byYear.get(year) ?? [],
  }));
  const none = byYear.get("none");
  if (none) {
    groups.push({
      key: "training-none",
      title: classDisplayTrainingYearLabel(null),
      classes: none,
    });
  }
  return groups;
}
