import { CHF_CLASS_CODE_MAP } from "../classes/chf-catalog.ts";

/** Correspondances entre codes grille PDF et classes Campus Agenda. */
export function resolveClassroomIdForClassCode(classCode: string): string | null {
  const normalized = classCode.toUpperCase();
  if (CHF_CLASS_CODE_MAP[normalized]) {
    return CHF_CLASS_CODE_MAP[normalized];
  }
  if (CHF_CLASS_CODE_MAP[classCode]) {
    return CHF_CLASS_CODE_MAP[classCode];
  }
  if (normalized.includes("MA2") || normalized === "MMA2AB" || normalized.startsWith("MMA2")) {
    return "classe-demo-tma-2a";
  }
  if (normalized.includes("MA1") || normalized === "COND1" || normalized.startsWith("MMA1")) {
    return "classe-demo-tma-1a";
  }
  return null;
}

export function resolveDemoTeacherCode(teacherId: string): string | null {
  const map: Record<string, string> = {
    "teacher-chf": "ChF",
    "teacher-demo-current": "RoP",
    "teacher-demo-dupont": "DuP",
    "teacher-demo-martin": "MaF",
  };
  return map[teacherId] ?? null;
}

/** Normalise un libellé de branche grille → nom affiché agenda. */
export function normalizeBranchLabel(label: string): string {
  const map: Record<string, string> = {
    "Con. Prof I": "Con. Prof I",
    "Con. Prof II": "Con. Prof II",
    "Con. Prof III": "Con. Prof III",
    "Con. Prof L": "Con. Prof L",
    BG: "BG",
    "T.Ph": "Théorie/pratique",
    Electro: "Électricité",
    Moteur: "Moteur",
    Châssis: "Châssis",
    Technique: "Technique",
  };
  return map[label] ?? label;
}
