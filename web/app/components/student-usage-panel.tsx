"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudentUsageDashboard, StudentUsagePeriod, StudentUsageSeriesPoint } from "@campus/features/student-usage/index.ts";

interface UsagePayload extends StudentUsageDashboard {
  ok: boolean;
  reason?: string;
}

const PERIODS: StudentUsagePeriod[] = [7, 30, 90];

function formatCount(value: number): string {
  return new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(value)} %`;
}

function dayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}.${month}`;
}

function spanLabel(period: StudentUsagePeriod, previous: boolean): string {
  const length = period === 7 ? "7 jours" : period === 30 ? "30 jours" : "90 jours";
  return previous ? `${length} précédents` : `${length} derniers`;
}

function UsageChart({ series }: { series: StudentUsageSeriesPoint[] }) {
  const width = 640;
  const height = 220;
  const padLeft = 36;
  const padRight = 8;
  const padTop = 16;
  const padBottom = 28;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const max = Math.max(1, ...series.map((point) => point.count));
  const slot = innerWidth / Math.max(series.length, 1);
  const labelEvery = series.length <= 7 ? 1 : series.length <= 30 ? 5 : 10;

  return (
    <svg
      className="student-usage-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Fréquentation quotidienne des élèves"
    >
      <title>Fréquentation des élèves</title>
      {[0, 0.5, 1].map((fraction) => {
        const y = padTop + innerHeight - fraction * innerHeight;
        return (
          <g key={fraction}>
            <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#e3e8ef" />
            <text x={padLeft - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#8793a9">
              {Math.round(max * fraction)}
            </text>
          </g>
        );
      })}
      {series.map((point, index) => {
        const barHeight = (point.count / max) * innerHeight;
        const x = padLeft + index * slot + slot * 0.18;
        const barWidth = Math.max(slot * 0.64, 1);
        const y = padTop + innerHeight - barHeight;
        const showLabel = index % labelEvery === 0 || index === series.length - 1;
        return (
          <g key={point.date}>
            <rect
              x={x}
              y={point.count === 0 ? padTop + innerHeight - 2 : y}
              width={barWidth}
              height={point.count === 0 ? 2 : Math.max(barHeight, 2)}
              rx="2"
              fill={point.count === 0 ? "#d5dce8" : "#075dff"}
            >
              <title>{`${dayLabel(point.date)} : ${formatCount(point.count)} consultation${point.count > 1 ? "s" : ""}`}</title>
            </rect>
            {showLabel ? (
              <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="#8793a9">
                {dayLabel(point.date)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function StudentUsagePanel() {
  const [period, setPeriod] = useState<StudentUsagePeriod>(7);
  const [schoolClassId, setSchoolClassId] = useState("");
  const [data, setData] = useState<UsagePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period: String(period) });
      if (schoolClassId) params.set("schoolClassId", schoolClassId);
      const response = await fetch(`/api/admin/student-usage?${params.toString()}`, { credentials: "include" });
      const payload = await response.json() as UsagePayload;
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Chargement des statistiques impossible.");
        return;
      }
      setData(payload);
      setError("");
    } catch {
      setError("Chargement des statistiques impossible.");
    } finally {
      setLoading(false);
    }
  }, [period, schoolClassId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const cards = data?.cards;
  const comparison = data?.comparison;

  return (
    <div className="admin-panel-block student-usage">
      <header className="config-section-header">
        <div>
          <h3>Statistiques</h3>
          <p>Fréquentation de l’espace élève, par jour et par classe.</p>
        </div>
        <button type="button" className="security-refresh" onClick={() => void refresh()} disabled={loading}>
          Actualiser
        </button>
      </header>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      <div className="student-usage-toolbar">
        <div className="security-filters" role="group" aria-label="Période">
          {PERIODS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={period === entry ? "active" : ""}
              aria-pressed={period === entry}
              onClick={() => setPeriod(entry)}
            >
              {entry} jours
            </button>
          ))}
        </div>
        <label className="student-usage-class-filter">
          <span>Classe</span>
          <select value={schoolClassId} onChange={(event) => setSchoolClassId(event.target.value)}>
            <option value="">Toutes les classes</option>
            {(data?.classOptions ?? []).map((entry) => (
              <option key={entry.schoolClassId} value={entry.schoolClassId}>
                {entry.archived ? `${entry.label} (archivée)` : entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="student-usage-cards">
        <li>
          <span>Consultations aujourd’hui</span>
          <strong>{cards ? formatCount(cards.today) : "—"}</strong>
        </li>
        <li>
          <span>Consultations sur 7 jours</span>
          <strong>{cards ? formatCount(cards.last7) : "—"}</strong>
        </li>
        <li>
          <span>Moyenne quotidienne</span>
          <strong>{cards ? formatCount(cards.average) : "—"}</strong>
        </li>
        <li>
          <span>Classes actives</span>
          <strong>{cards ? formatCount(cards.activeClasses) : "—"}</strong>
        </li>
      </ul>

      <section className="student-usage-chart-section" aria-labelledby="student-usage-chart-title">
        <h4 id="student-usage-chart-title">Fréquentation des élèves</h4>
        {data ? <UsageChart series={data.series} /> : <p className="security-empty">Chargement…</p>}
        {comparison ? (
          <p className="student-usage-comparison">
            {spanLabel(period, false)} : {formatCount(comparison.current)} consultations.
            {" "}
            {spanLabel(period, true)} : {formatCount(comparison.previous)} consultations.
            {" "}
            Évolution : {comparison.percent == null
              ? "pas de pourcentage (aucune consultation sur la période précédente)."
              : formatPercent(comparison.percent)}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="student-usage-classes-title">
        <h4 id="student-usage-classes-title">Fréquentation par classe</h4>
        <div className="student-usage-table-wrap">
          <table className="security-events-table student-usage-table">
            <thead>
              <tr>
                <th>Classe</th>
                <th>Consultations sur {period} jours</th>
              </tr>
            </thead>
            <tbody>
              {(data?.classes.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={2}>Aucune consultation enregistrée sur cette période.</td>
                </tr>
              ) : data?.classes.map((entry) => (
                <tr key={entry.schoolClassId}>
                  <td data-label="Classe">{entry.archived ? `${entry.label} (archivée)` : entry.label}</td>
                  <td data-label={`Consultations sur ${period} jours`}>{formatCount(entry.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="security-disclaimer">{data?.disclaimer}</p>
      <p className="security-retention">
        Conservées {data?.retentionMonths ?? 24} mois, puis supprimées. Ces compteurs sont séparés du journal de
        sécurité et des données pédagogiques.
      </p>
    </div>
  );
}
