import { extractOfficialPlanLines } from "./parse-official-plan-pdf.ts";
import { parseWeekPlanPdf } from "./parse-week-plan-pdf.ts";
import { looksLikeOfficialPlanText, parseOfficialPlanFromLines } from "./official-plan-logic.ts";
import type { OfficialPlanParseResult } from "./official-plan-types.ts";
import type { ParsedWeekPlan } from "./types.ts";

export type DetectedSchoolYearPdf =
  | { sourceKind: "official-plan"; official: OfficialPlanParseResult }
  | { sourceKind: "week-plan"; plan: ParsedWeekPlan };

export async function detectAndParseSchoolYearPdf(pdfBytes: Uint8Array): Promise<DetectedSchoolYearPdf> {
  const extracted = await extractOfficialPlanLines(pdfBytes);
  if (looksLikeOfficialPlanText(extracted.lines.join("\n"))) {
    return {
      sourceKind: "official-plan",
      official: parseOfficialPlanFromLines(extracted.lines, extracted.pageCount),
    };
  }

  const plan = await parseWeekPlanPdf(pdfBytes);
  return { sourceKind: "week-plan", plan };
}
