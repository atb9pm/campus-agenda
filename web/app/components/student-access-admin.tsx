"use client";

import type { SchoolClassRecord } from "@campus/features/school-catalog";
import type { StudentAccessMetadata } from "@campus/types/student-access";
import type { SchoolYearSummary } from "../../lib/api-client.ts";

interface StudentAccessAdminBlockProps {
  schoolClass: SchoolClassRecord;
  schoolYears: SchoolYearSummary[];
  access: StudentAccessMetadata | null;
  revealedCode: string | null;
  pending: boolean;
  onGenerate: (schoolClass: SchoolClassRecord, isRegenerate: boolean) => void;
  onRevoke: (schoolClass: SchoolClassRecord) => void;
  onDismissCode: () => void;
}

function formatAccessDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" });
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Copie indisponible : l'administrateur peut encore sélectionner le texte.
  }
}

export function StudentAccessAdminBlock({
  schoolClass,
  schoolYears,
  access,
  revealedCode,
  pending,
  onGenerate,
  onRevoke,
  onDismissCode,
}: StudentAccessAdminBlockProps) {
  const year = schoolYears.find((entry) => entry.id === schoolClass.schoolYearId) ?? null;
  const yearLabel = year?.label ?? schoolClass.schoolYearLabel ?? "cette année";
  const readOnly = schoolClass.isArchived || year?.status === "archived";
  const status = access?.status ?? "none";
  const isRegenerate = status === "active" || status === "prepared";

  let statusLabel = "Aucun accès";
  let statusClass = "badge-status is-off";
  let description = "Générez un code partagé pour toute la classe.";
  if (status === "active") {
    statusLabel = "Accès actif";
    statusClass = "badge-status is-on";
    description = access?.createdAt ? `Créé le ${formatAccessDate(access.createdAt)}` : "Code en vigueur.";
  } else if (status === "prepared") {
    statusLabel = "Code préparé";
    statusClass = "badge-status is-on";
    description = `Disponible lorsque ${yearLabel} deviendra l’année active`;
  } else if (status === "revoked") {
    statusLabel = "Accès révoqué";
    statusClass = "badge-status is-off";
    description = "Les élèves ne peuvent plus se connecter avec l’ancien code.";
  } else if (status === "historical") {
    statusLabel = "Accès historique";
    statusClass = "badge-status is-off";
    description = "Lecture seule.";
  }

  return (
    <div className="admin-student-access">
      <p className="admin-student-access-title">Accès apprentis</p>
      <div className="admin-student-access-status">
        <span className={statusClass}>{statusLabel}</span>
        <p>{description}</p>
      </div>

      {revealedCode ? (
        <div className="admin-secret" role="status">
          <p className="admin-secret-title">Nouveau code apprentis</p>
          <p className="admin-secret-value">{revealedCode}</p>
          <p className="admin-secret-hint">
            Copiez ce code maintenant. Pour des raisons de sécurité, Campus Agenda ne pourra plus
            l’afficher.
          </p>
          <div className="admin-teacher-edit-actions">
            <button
              type="button"
              aria-label={`Copier le code apprentis de ${schoolClass.code}`}
              onClick={() => void copyCode(revealedCode)}
            >
              Copier
            </button>
            <button type="button" onClick={onDismissCode}>
              J’ai noté
            </button>
          </div>
        </div>
      ) : null}

      {readOnly ? null : (
        <div className="admin-teacher-edit-actions">
          {(status === "none" || status === "revoked") && (
            <button
              type="button"
              disabled={pending}
              aria-label={`Générer un code apprentis pour ${schoolClass.code}`}
              onClick={() => onGenerate(schoolClass, false)}
            >
              Générer un code
            </button>
          )}
          {isRegenerate && (
            <>
              <button
                type="button"
                disabled={pending}
                aria-label={`Régénérer le code apprentis de ${schoolClass.code}`}
                onClick={() => onGenerate(schoolClass, true)}
              >
                {status === "prepared" ? "Régénérer" : "Régénérer le code"}
              </button>
              <button
                type="button"
                disabled={pending}
                aria-label={`Désactiver l’accès apprentis de ${schoolClass.code}`}
                onClick={() => onRevoke(schoolClass)}
              >
                Désactiver
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
