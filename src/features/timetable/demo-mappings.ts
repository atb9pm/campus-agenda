/** Correspondances démo entre codes grille PDF et classes Campus Agenda. */
export function resolveClassroomIdForClassCode(classCode: string): string | null {
  const normalized = classCode.toUpperCase();
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
    "teacher-demo-current": "RoP",
    "teacher-demo-dupont": "DuP",
    "teacher-demo-martin": "MaF",
  };
  return map[teacherId] ?? null;
}

/** Normalise un libellé de branche grille → nom affiché agenda. */
export function normalizeBranchLabel(label: string): string {
  const map: Record<string, string> = {
    "Con. Prof I": "Électricité",
    "Con. Prof II": "Moteur",
    "Con. Prof III": "Atelier",
    "Con. Prof L": "Châssis",
    BG: "Branche générale",
    "T.Ph": "Théorie/pratique",
    Electro: "Électricité",
    Moteur: "Moteur",
    Châssis: "Châssis",
    Technique: "Technique",
  };
  return map[label] ?? label;
}
