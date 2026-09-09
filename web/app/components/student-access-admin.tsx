"use client";

import { useEffect, useRef } from "react";

import type { SchoolClassRecord } from "@campus/features/school-catalog";
import type { StudentAccessMetadata } from "@campus/types/student-access";
import type { SchoolYearSummary } from "../../lib/api-client.ts";

interface StudentAccessAdminBlockProps {
  schoolClass: SchoolClassRecord;
  schoolYears: SchoolYearSummary[];
  access: StudentAccessMetadata | null;
  revealedCode: string | null;
  pending: boolean;
  error: string | null;
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
  error,
  onGenerate,
  onRevoke,
  onDismissCode,
}: StudentAccessAdminBlockProps) {
  const year = schoolYears.find((entry) => entry.id === schoolClass.schoolYearId) ?? null;
  const yearLabel = year?.label ?? schoolClass.schoolYearLabel ?? "cette année";
  const readOnly = schoolClass.isArchived || year?.status === "archived";
  const status = access?.status ?? "none";
  const isRegenerate = status === "active" || status === "prepared";
  const liveCode = revealedCode ?? access?.currentCode ?? null;
  const isFreshReveal = Boolean(revealedCode);
  const secretRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!revealedCode) return;
    secretRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [revealedCode]);

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

      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}

      {liveCode ? (
        <div className="admin-secret" role="status" ref={secretRef}>
          <p className="admin-secret-title">{isFreshReveal ? "Nouveau code apprentis" : "Code apprentis en vigueur"}</p>
          <p className="admin-secret-value">{liveCode}</p>
          <p className="admin-secret-hint">
            {isFreshReveal
              ? "Copiez ce code et communiquez-le aux apprentis. Il reste visible ici et dans Mes cours pour les enseignants attribués."
              : "Code actuel de la classe. Les enseignants attribués le voient aussi dans Mes cours."}
          </p>
          <div className="admin-teacher-edit-actions">
            <button
              type="button"
              aria-label={`Copier le code apprentis de ${schoolClass.code}`}
              onClick={() => void copyCode(liveCode)}
            >
              Copier
            </button>
            {isFreshReveal ? (
              <button type="button" onClick={onDismissCode}>
                J’ai noté
              </button>
            ) : null}
          </div>
        </div>
      ) : status === "active" || status === "prepared" ? (
        <p className="admin-student-access-status">
          Le code n’est pas affichable. Régénérez-le pour le voir ici et dans Mes cours.
        </p>
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
              {pending ? "…" : ""}
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
                {pending ? "Génération…" : status === "prepared" ? "Régénérer" : "Régénérer le code"}
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
