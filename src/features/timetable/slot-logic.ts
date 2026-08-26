import type { TimetableSlot, TimetableWeekKind } from "./types.ts";

const TEACHER_CODE = /^[A-Z][a-z][A-Z]?$/;
const SPS_PATTERN = /\bSPS[\s/-]*(?:A|B)?\b/i;

export function isSpsOnlyCell(raw: string): boolean {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/^SPS\b/i.test(normalized)) return true;
  if (/^BG\s*\/\s*SPS/i.test(normalized) && !/\b(Con\.|Electro|Moteur|Technique|T\.Ph|Transp|Châssis|Hydr|Calcul|Dessin|Math|Physique)/i.test(normalized)) {
    return false;
  }
  return false;
}

export interface ParsedCell {
  branchLabel: string;
  teacherCode: string | null;
  weekKind: TimetableWeekKind;
  skip: boolean;
  skipReason?: "sps";
}

/** Interprète une cellule brute de grille (une classe × une période). */
export function parseTimetableCell(raw: string): ParsedCell[] {
  const normalized = raw.replace(/\s+/g, " ").replace(/"/g, "").trim();
  if (!normalized || normalized === "?" || normalized === '"') {
    return [];
  }

  if (/^SPS-A\s*\/\s*-?B/i.test(normalized) || /^SPS-A\s*\/\s*SPS-B/i.test(normalized)) {
    return [{ branchLabel: "SPS", teacherCode: null, weekKind: "all", skip: true, skipReason: "sps" }];
  }

  const results: ParsedCell[] = [];

  if (/T\.Ph\s*\/\s*SPS-B/i.test(normalized)) {
    results.push({
      branchLabel: "T.Ph",
      teacherCode: extractTeacherCode(normalized),
      weekKind: "A",
      skip: false,
    });
    return results;
  }

  if (/BG\s*\+\s*/i.test(normalized)) {
    results.push({
      branchLabel: "BG",
      teacherCode: extractTeacherCode(normalized),
      weekKind: "all",
      skip: false,
    });
    return results;
  }

  const bgStarSpsA = normalized.match(/BG\s*\*\s*\/\s*SPS-A/i);
  if (bgStarSpsA) {
    results.push({
      branchLabel: "BG",
      teacherCode: extractTeacherCode(normalized),
      weekKind: "A",
      skip: false,
    });
    return results;
  }

  const bgStarSpsB = normalized.match(/BG\s*\*\s*\/\s*SPS-B/i);
  if (bgStarSpsB) {
    results.push({
      branchLabel: "BG",
      teacherCode: extractTeacherCode(normalized),
      weekKind: "B",
      skip: false,
    });
    return results;
  }

  const bgSpsA = normalized.match(/BG\s*\/\s*SPS-A/i);
  if (bgSpsA) {
    results.push({
      branchLabel: "BG",
      teacherCode: extractTeacherCode(normalized),
      weekKind: "B",
      skip: false,
    });
    return results;
  }

  const bgSpsB = normalized.match(/BG\s*\/\s*SPS-B/i);
  if (bgSpsB) {
    results.push({
      branchLabel: "BG",
      teacherCode: extractTeacherCode(normalized),
      weekKind: "A",
      skip: false,
    });
    return results;
  }

  if (SPS_PATTERN.test(normalized) && !/\b(BG|T\.Ph|Con\.|Electro|Moteur)\b/i.test(normalized)) {
    return [{ branchLabel: "SPS", teacherCode: null, weekKind: "all", skip: true, skipReason: "sps" }];
  }

  const branch = detectBranchLabel(normalized);
  if (!branch) return [];

  results.push({
    branchLabel: branch,
    teacherCode: extractTeacherCode(normalized),
    weekKind: "all",
    skip: false,
  });
  return results;
}

function detectBranchLabel(normalized: string): string | null {
  if (/\bBG\b/.test(normalized)) return "BG";
  if (/T\.Ph/i.test(normalized)) return "T.Ph";
  if (/Con\. Prof I/i.test(normalized)) return "Con. Prof I";
  if (/Con\. Prof II/i.test(normalized)) return "Con. Prof II";
  if (/Con\. Prof III/i.test(normalized)) return "Con. Prof III";
  if (/Con\. Prof L/i.test(normalized)) return "Con. Prof L";
  if (/Con\. Prof U/i.test(normalized)) return "Con. Prof U";
  if (/Con\. Spéc\./i.test(normalized)) return "Con. Spéc.";
  if (/Technique/i.test(normalized)) return "Technique";
  if (/Electro/i.test(normalized)) return "Electro";
  if (/Moteur/i.test(normalized)) return "Moteur";
  if (/Châssis/i.test(normalized)) return "Châssis";
  if (/Transm\./i.test(normalized)) return "Transm.";
  if (/Hydr\./i.test(normalized)) return "Hydr./Pn.";
  if (/Chim\./i.test(normalized)) return "Chim. Métaux";
  if (/Calcul/i.test(normalized)) return "Calcul/Transm";
  if (/Dessin/i.test(normalized)) return "Dessin";
  if (/Math/i.test(normalized)) return "Math";
  if (/Physique/i.test(normalized)) return "Physique";
  if (/Transp\./i.test(normalized)) return "Transp. Lég.";
  if (/Spé\. commun/i.test(normalized)) return "Spé. commun";
  if (/Tech\. fabr\./i.test(normalized)) return "Tech. fabr.";
  return null;
}

function extractTeacherCode(normalized: string): string | null {
  const tokens = normalized.split(/\s+/);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!.replace(/[^A-Za-z]/g, "");
    if (TEACHER_CODE.test(token)) return token;
  }
  for (const token of tokens) {
    const cleaned = token.replace(/[^A-Za-z]/g, "");
    if (TEACHER_CODE.test(cleaned)) return cleaned;
  }
  return null;
}

export function summarizeTimetableSlots(slots: TimetableSlot[]) {
  const byClass = new Map<string, TimetableSlot[]>();
  for (const slot of slots) {
    const list = byClass.get(slot.classCode) ?? [];
    list.push(slot);
    byClass.set(slot.classCode, list);
  }

  return [...byClass.entries()]
    .map(([classCode, classSlots]) => ({
      classCode,
      slotCount: classSlots.length,
      branches: [...new Set(classSlots.map((slot) => slot.branchLabel))].sort(),
      teacherCodes: [...new Set(classSlots.map((slot) => slot.teacherCode).filter(Boolean))].sort() as string[],
    }))
    .sort((left, right) => left.classCode.localeCompare(right.classCode));
}

export function filterSlotsForCourseDay(
  slots: TimetableSlot[],
  classCode: string,
  dayOfWeek: number,
  schoolWeekKind: "A" | "B",
): TimetableSlot[] {
  return slots.filter((slot) => {
    if (slot.classCode !== classCode) return false;
    if (slot.dayOfWeek !== dayOfWeek) return false;
    if (slot.weekKind === "all") return true;
    return slot.weekKind === schoolWeekKind;
  });
}

export function groupSlotsByBranch(slots: TimetableSlot[]): Map<string, TimetableSlot[]> {
  const grouped = new Map<string, TimetableSlot[]>();
  for (const slot of slots) {
    const list = grouped.get(slot.branchLabel) ?? [];
    list.push(slot);
    grouped.set(slot.branchLabel, list);
  }
  return grouped;
}
