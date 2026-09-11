"use client";

import {
  ADMIN_WORKING_YEAR_BADGE_LABELS,
  formatAdminWorkingSectionTitle,
  formatAdminWorkingYearOption,
  type AdminWorkingYearRef,
} from "@campus/features/school-year/admin-working-year.ts";
import { formatSchoolYearLabelFr } from "@campus/features/school-year/official-plan-logic.ts";

interface AdminWorkingYearBannerProps {
  years: AdminWorkingYearRef[];
  workingYearId: string | null;
  section: "classes" | "courses";
  onChange: (schoolYearId: string) => void;
}

export function AdminWorkingYearBanner({
  years,
  workingYearId,
  section,
  onChange,
}: AdminWorkingYearBannerProps) {
  const workingYear = years.find((year) => year.id === workingYearId) ?? null;
  const selectId = section === "classes" ? "admin-working-year-classes" : "admin-working-year-courses";

  return (
    <article className="admin-working-year-banner">
      <div className="admin-working-year-banner-grid">
        <div>
          <span className="eyebrow">ANNÉE DE TRAVAIL</span>
          {workingYear ? (
            <p>
              <strong>{formatSchoolYearLabelFr(workingYear.label)}</strong>
              <span className={`school-year-badge ${workingYear.status}`}>
                {ADMIN_WORKING_YEAR_BADGE_LABELS[workingYear.status]}
              </span>
            </p>
          ) : (
            <p>Aucune année scolaire.</p>
          )}
        </div>
        <label htmlFor={selectId}>
          Changer d’année
          <select
            id={selectId}
            className="school-year-working-select"
            value={workingYearId ?? ""}
            disabled={years.length === 0}
            onChange={(event) => onChange(event.target.value)}
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {formatAdminWorkingYearOption(year)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {workingYear ? <h3>{formatAdminWorkingSectionTitle(section, workingYear)}</h3> : null}
      {workingYear?.status === "archived" ? (
        <p className="school-year-hint">
          Cette année est archivée : lecture seule. Aucune création ni modification.
        </p>
      ) : null}
      {workingYear?.status === "draft" ? (
        <p className="school-year-hint">
          Préparation d’une année future. Les enseignants et élèves continuent d’utiliser uniquement
          l’année active.
        </p>
      ) : null}
    </article>
  );
}
