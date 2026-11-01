"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecurityEventView } from "@campus/features/security-events/present.ts";
import type { SecuritySummary } from "@campus/features/security-events/summary.ts";
import {
  SECURITY_ACTIVITY_DISCLAIMER,
  SECURITY_ACTIVITY_EMPTY_PERIOD,
  SECURITY_ACTIVITY_EVENTS_TITLE,
  SECURITY_ACTIVITY_STATUS_CRITICAL,
  SECURITY_ACTIVITY_STATUS_NORMAL,
  SECURITY_ACTIVITY_STATUS_WARNING_DETAIL,
  SECURITY_ACTIVITY_SUBTITLE,
  SECURITY_ACTIVITY_SUMMARY_TITLE,
  SECURITY_ACTIVITY_TITLE,
  SECURITY_PERIOD_LABELS,
  SECURITY_SEVERITY_LABELS,
  SECURITY_SUMMARY_CARD_LABELS,
  securityReviewCountText,
} from "@campus/features/security-events/ui-text.ts";

type PeriodFilter = keyof typeof SECURITY_PERIOD_LABELS;
type SeverityFilter = "ALL" | keyof typeof SECURITY_SEVERITY_LABELS;

interface ActivityPayload {
  ok: boolean;
  reason?: string;
  generatedAt?: string;
  retentionDays?: number;
  summary?: SecuritySummary & { periodHours: number };
  events?: SecurityEventView[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
}

const PAGE_SIZE = 25;
const SEVERITY_FILTERS: SeverityFilter[] = ["ALL", "INFO", "WARNING", "CRITICAL"];
const CARD_ORDER = Object.keys(SECURITY_SUMMARY_CARD_LABELS) as (keyof typeof SECURITY_SUMMARY_CARD_LABELS)[];

const METADATA_LABELS: Record<string, string> = {
  reason: "Motif",
  failure: "Type d’échec",
  scope: "Périmètre",
  layer: "Niveau de limitation",
  targetKnown: "Compte existant",
  mfaRequired: "Double authentification requise",
  passwordChangeRequired: "Changement de mot de passe requis",
  recoveryRemaining: "Codes de récupération restants",
  classPrefix: "Classe",
  observedCount: "Occurrences observées",
  threshold: "Seuil",
  windowMinutes: "Fenêtre (minutes)",
  accountKnown: "Compte existant",
  accountState: "État du compte",
  codeFormatValid: "Format du code valide",
  context: "Contexte",
  exportKind: "Type d’export",
  format: "Format",
  formatVersion: "Version du format",
  isAdmin: "Administrateur",
  itemCount: "Éléments",
  restoredTables: "Tables restaurées",
  sessionKind: "Type de session",
  step: "Étape",
  tableCount: "Tables",
  teachingType: "Type d’enseignement",
  usedRecovery: "Code de récupération utilisé",
  via: "Via",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "oui" : "non";
  return String(value);
}

function severityClass(severity: string): string {
  if (severity === "CRITICAL") return "is-critical";
  if (severity === "WARNING") return "is-warning";
  return "is-info";
}

function SecurityStatusBanner({ summary }: { summary: SecuritySummary }) {
  const { level, reviewCount } = summary.status;
  if (level === "normal") {
    return <p className="security-status is-normal" role="status">{SECURITY_ACTIVITY_STATUS_NORMAL}</p>;
  }
  return (
    <div className={`security-status ${level === "critical" ? "is-critical" : "is-warning"}`} role="status">
      <strong>{level === "critical" ? SECURITY_ACTIVITY_STATUS_CRITICAL : securityReviewCountText(reviewCount)}</strong>
      <span>{SECURITY_ACTIVITY_STATUS_WARNING_DETAIL}</span>
    </div>
  );
}

function SecurityEventDetail({ event, onClose }: { event: SecurityEventView; onClose: () => void }) {
  useEffect(() => {
    function onKey(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: [string, string][] = [
    ["Niveau", SECURITY_SEVERITY_LABELS[event.severity]],
    ["Première occurrence", formatDateTime(event.occurredAt)],
    ["Dernière occurrence", formatDateTime(event.lastSeenAt)],
    ["Occurrences", String(event.occurrenceCount)],
    ["Compte / acteur", event.actorLabel],
  ];
  if (event.targetLabel) rows.push(["Cible", event.targetLabel]);
  rows.push(["Source", event.source ?? "—"]);
  if (event.route) rows.push(["Route", `${event.httpMethod ?? ""} ${event.route}`.trim()]);
  if (event.httpStatus) rows.push(["Statut HTTP", String(event.httpStatus)]);
  rows.push(["Identifiant de requête", event.requestId ?? "—"]);
  rows.push(["Type technique", event.eventType]);
  for (const [key, value] of Object.entries(event.metadata)) {
    rows.push([METADATA_LABELS[key] ?? key, formatMetadataValue(value)]);
  }

  return (
    <div className="technical-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="technical-modal security-event-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-event-detail-title"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <header>
          <h2 id="security-event-detail-title">{event.label}</h2>
          <button type="button" aria-label="Fermer" onClick={onClose}>×</button>
        </header>
        <dl className="security-event-detail">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="security-event-detail-note">
          Les mots de passe, codes, cookies, adresses IP et contenus pédagogiques ne sont jamais enregistrés.
        </p>
      </section>
    </div>
  );
}

export function SecurityActivityPanel() {
  const [period, setPeriod] = useState<PeriodFilter>("24h");
  const [severity, setSeverity] = useState<SeverityFilter>("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SecurityEventView | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period, page: String(page), pageSize: String(PAGE_SIZE) });
      if (severity !== "ALL") params.set("severity", severity);
      const response = await fetch(`/api/admin/security/activity?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json() as ActivityPayload;
      if (!response.ok || !payload.ok) {
        setError(payload.reason ?? "Chargement du journal impossible.");
        return;
      }
      setData(payload);
      setError("");
    } catch {
      setError("Chargement du journal impossible.");
    } finally {
      setLoading(false);
    }
  }, [period, severity, page]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const summary = data?.summary;
  const events = data?.events ?? [];
  const pagination = data?.pagination;

  return (
    <div className="admin-panel-block security-activity">
      <header className="config-section-header">
        <div>
          <h3>{SECURITY_ACTIVITY_TITLE}</h3>
          <p>{SECURITY_ACTIVITY_SUBTITLE}</p>
        </div>
        <button type="button" className="security-refresh" onClick={() => void refresh()} disabled={loading}>
          Actualiser
        </button>
      </header>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      <section className="security-summary" aria-labelledby="security-summary-title">
        <h4 id="security-summary-title">{SECURITY_ACTIVITY_SUMMARY_TITLE}</h4>
        {summary ? <SecurityStatusBanner summary={summary} /> : null}
        <ul className="security-cards">
          {CARD_ORDER.map((card) => (
            <li key={card} className={card === "alerts" && (summary?.cards.alerts ?? 0) > 0 ? "has-alerts" : undefined}>
              <span>{SECURITY_SUMMARY_CARD_LABELS[card]}</span>
              <strong>{summary ? summary.cards[card] : "–"}</strong>
            </li>
          ))}
        </ul>
        <p className="security-disclaimer">{SECURITY_ACTIVITY_DISCLAIMER}</p>
      </section>

      <section className="security-events" aria-labelledby="security-events-title">
        <div className="security-events-head">
          <h4 id="security-events-title">{SECURITY_ACTIVITY_EVENTS_TITLE}</h4>
          <div className="security-filters">
            <div role="group" aria-label="Période">
              {(Object.keys(SECURITY_PERIOD_LABELS) as PeriodFilter[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={period === entry}
                  className={period === entry ? "active" : ""}
                  onClick={() => {
                    setPeriod(entry);
                    setPage(1);
                  }}
                >
                  {SECURITY_PERIOD_LABELS[entry]}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Niveau">
              {SEVERITY_FILTERS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={severity === entry}
                  className={severity === entry ? "active" : ""}
                  onClick={() => {
                    setSeverity(entry);
                    setPage(1);
                  }}
                >
                  {entry === "ALL" ? "Tous" : SECURITY_SEVERITY_LABELS[entry]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && !data ? <p className="admin-loading">Chargement…</p> : null}
        {data && events.length === 0 ? <p className="security-empty">{SECURITY_ACTIVITY_EMPTY_PERIOD}</p> : null}

        {events.length > 0 ? (
          <table className="security-events-table">
            <thead>
              <tr>
                <th scope="col">Date/heure</th>
                <th scope="col">Niveau</th>
                <th scope="col">Événement</th>
                <th scope="col">Compte/acteur</th>
                <th scope="col">Source</th>
                <th scope="col">Détail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className={severityClass(event.severity)}>
                  <td data-label="Date/heure">{formatDateTime(event.lastSeenAt)}</td>
                  <td data-label="Niveau">
                    <span className={`security-badge ${severityClass(event.severity)}`}>
                      {SECURITY_SEVERITY_LABELS[event.severity]}
                    </span>
                  </td>
                  <td data-label="Événement">
                    {event.label}
                    {event.occurrenceCount > 1 && !event.label.startsWith(String(event.occurrenceCount))
                      ? <small> ×{event.occurrenceCount}</small>
                      : null}
                  </td>
                  <td data-label="Compte/acteur">{event.actorLabel}</td>
                  <td data-label="Source">{event.source ? `Source : ${event.source}` : "—"}</td>
                  <td data-label="Détail">
                    <button type="button" className="security-detail-button" onClick={() => setSelected(event)}>
                      Voir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {pagination && pagination.totalPages > 1 ? (
          <nav className="security-pagination" aria-label="Pagination du journal">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
              Précédent
            </button>
            <span>Page {pagination.page} / {pagination.totalPages} · {pagination.total} événements</span>
            <button
              type="button"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Suivant
            </button>
          </nav>
        ) : null}
        {data?.retentionDays ? (
          <p className="security-retention">Conservation des événements : {data.retentionDays} jours.</p>
        ) : null}
      </section>

      {selected ? <SecurityEventDetail event={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
