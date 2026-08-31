import { normalizeParallelCode } from "./class-codes.ts";
import { assertClassCodeAvailable, assertStructuredGroupAvailable } from "./class-uniqueness.ts";
import { validateClassProfessionAttachment } from "./profession-rules.ts";
import type { PedagogyMutationResult, SchoolProfessionRecord } from "./profession-types.ts";
import { normalizeClassCode } from "./queries.ts";
import type { SchoolClassInput, SchoolClassRecord } from "./types.ts";

export function prepareClassRecord(options: {
  id: string;
  input: SchoolClassInput;
  professions: SchoolProfessionRecord[];
  classes: SchoolClassRecord[];
  defaultSortOrder: number;
  excludeId?: string;
}): PedagogyMutationResult<SchoolClassRecord> {
  const attachment = validateClassProfessionAttachment({
    professionId: options.input.professionId ?? null,
    trainingYear: options.input.trainingYear ?? null,
    professions: options.professions,
  });
  if (!attachment.ok) return attachment;
  const parallel = normalizeParallelCode(options.input.parallelCode ?? null);
  if (!parallel.ok) return parallel;
  const code = normalizeClassCode(options.input.code);
  const schoolYearId = options.input.schoolYearId ?? null;
  const available = assertClassCodeAvailable({
    code,
    schoolYearId,
    classes: options.classes,
    excludeId: options.excludeId,
  });
  if (!available.ok) return available;
  const group = assertStructuredGroupAvailable({
    schoolYearId,
    professionId: attachment.value.professionId,
    trainingYear: attachment.value.trainingYear,
    parallelCode: parallel.value,
    classes: options.classes,
    excludeId: options.excludeId,
  });
  if (!group.ok) return group;

  return {
    ok: true,
    value: {
      id: options.id,
      code,
      label: options.input.label.trim() || code,
      sortOrder: options.input.sortOrder ?? options.defaultSortOrder,
      isActive: options.input.isActive ?? true,
      schoolYearId,
      schoolYearLabel: options.input.schoolYearLabel ?? null,
      professionId: attachment.value.professionId,
      trainingYear: attachment.value.trainingYear,
      parallelCode: parallel.value,
    },
  };
}

export function prepareClassRecords(
  inputs: SchoolClassInput[],
  options: {
    professions: SchoolProfessionRecord[];
    classes: SchoolClassRecord[];
    createId: () => string;
    sortOrderStart: number;
  },
): PedagogyMutationResult<SchoolClassRecord[]> {
  const pending = options.classes.slice();
  const prepared: SchoolClassRecord[] = [];
  for (const [index, input] of inputs.entries()) {
    const record = prepareClassRecord({
      id: options.createId(),
      input,
      professions: options.professions,
      classes: pending,
      defaultSortOrder: options.sortOrderStart + index,
    });
    if (!record.ok) return record;
    pending.push(record.value);
    prepared.push(record.value);
  }
  return { ok: true, value: prepared };
}
