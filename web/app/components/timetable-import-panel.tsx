"use client";

import { useCallback, useEffect, useId, useState } from "react";

import {
  fetchTimetableImports,
  importTimetablePdf,
  parseTimetablePdf,
  type TimetableImportSummary,
  type TimetablePreviewPayload,
} from "../../lib/api-client.ts";

interface TimetableImportPanelProps {
  onNotice: (message: string) => void;
}

export function TimetableImportPanel({ onNotice }: TimetableImportPanelProps) {
  const fileInputId = useId();
  const [imports, setImports] = useState<TimetableImportSummary[]>([]);
  const [preview, setPreview] = useState<TimetablePreviewPayload | null>(null);
  const [receivable, setReceivable] = useState<boolean | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setImports(await fetchTimetableImports());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  async function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setReceivable(null);
    setError("");
    if (!file) return;

    setWorking(true);
    try {
      const result = await parseTimetablePdf(file);
      setPreview(result.preview);
      setReceivable(result.receivable);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Analyse impossible.");
    } finally {
      setWorking(false);
    }
  }

  async function handleImport() {
    if (!selectedFile) return;
    setWorking(true);
    setError("");
    try {
      const result = await importTimetablePdf(selectedFile);
      onNotice(`Grille importée : ${result.slotCount} créneaux, ${result.classCount} classes (${result.excludedSpsCount} SPS ignorés).`);
      setSelectedFile(null);
      setPreview(null);
      setReceivable(null);
      await refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import impossible.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="timetable-import-panel" aria-labelledby="timetable-import-title">
      <header>
        <p className="eyebrow">GRILLE HORAIRE SECTEUR MA</p>
        <h2 id="timetable-import-title">Import annuel</h2>
        <p>
          Chargez le PDF officiel du secteur. Les créneaux <strong>SPS</strong> (sport) sont exclus automatiquement.
          Les branches <strong>BG</strong> et pro sont conservées avec alternance semaines A/B.
        </p>
      </header>

      {loading ? <p role="status">Chargement…</p> : null}
      {error ? <p className="timetable-error" role="alert">{error}</p> : null}

      <div className="timetable-import-form">
        <label htmlFor={fileInputId}>PDF grille horaire</label>
        <input
          id={fileInputId}
          type="file"
          accept="application/pdf,.pdf"
          disabled={working}
          onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
        />
        {selectedFile ? (
          <button type="button" disabled={working || receivable === false} onClick={() => void handleImport()}>
            Importer et activer
          </button>
        ) : null}
      </div>

      {preview ? (
        <article className="timetable-preview">
          <h3>Prévisualisation · {preview.schoolYearLabel}</h3>
          <p>
            {preview.slotCount} créneaux · {preview.classCount} classes · {preview.excludedSpsCount} SPS ignorés
            {preview.sourceVersion ? ` · version ${preview.sourceVersion}` : ""}
          </p>
          {receivable === false ? (
            <p className="timetable-warning">Grille partiellement lisible — vérifiez les avertissements avant import.</p>
          ) : null}
          {preview.warnings.length > 0 ? (
            <ul className="timetable-warnings">
              {preview.warnings.slice(0, 8).map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          {preview.sampleSlots.length > 0 ? (
            <>
              <h4>Exemples COND1 / MMA1A</h4>
              <ul className="timetable-sample">
                {preview.sampleSlots.map((slot) => (
                  <li key={`${slot.classCode}-${slot.dayOfWeek}-${slot.period}-${slot.weekKind}`}>
                    {slot.classCode} · P{slot.period} · {slot.branchLabel} · sem. {slot.weekKind}
                    {slot.teacherCode ? ` · ${slot.teacherCode}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </article>
      ) : null}

      {imports.length > 0 ? (
        <article className="timetable-history">
          <h3>Imports</h3>
          <ul>
            {imports.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.schoolYearLabel}</strong> — {entry.slotCount} créneaux — {entry.status}
                <small>{entry.sourceFilename}</small>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}
