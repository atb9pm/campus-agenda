"use client";

import { useEffect } from "react";
import {
  decideStudentVisit,
  readStudentVisitRecord,
  writeStudentVisitRecord,
  type StudentVisitContext,
  type StudentVisitRecord,
} from "@campus/features/student-usage/index.ts";

interface UsageSessionPayload {
  ok?: boolean;
  session?: {
    kind?: string;
    schoolClassId?: string;
    schoolYearId?: string;
    usageDate?: string;
  } | null;
}

function visitContext(session: UsageSessionPayload["session"]): StudentVisitContext | null {
  const date = session?.usageDate;
  const schoolClassId = session?.schoolClassId;
  const schoolYearId = session?.schoolYearId;
  if (session?.kind !== "student" || !date || !schoolClassId || !schoolYearId) return null;
  return { date, schoolClassId, schoolYearId };
}

/**
 * Une consultation par jour, classe et année, dans ce navigateur.
 * L'agenda n'attend pas cette requête et n'est pas bloqué si elle échoue.
 * Réservé à une vraie session élève : l'aperçu enseignant ne monte pas ce composant.
 */
export function StudentUsageRecorder() {
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const sync = async () => {
      if (inFlight || cancelled) return;
      const storage = window.localStorage;
      let sessionPayload: UsageSessionPayload;
      try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        if (!response.ok) return;
        sessionPayload = await response.json() as UsageSessionPayload;
      } catch {
        return;
      }
      if (cancelled) return;
      const context = visitContext(sessionPayload.session);
      if (!context) return;

      const nowMs = Date.now();
      if (decideStudentVisit(readStudentVisitRecord(storage), context, nowMs) === "skip") return;

      inFlight = true;
      const pending: StudentVisitRecord = { ...context, state: "pending", at: nowMs };
      writeStudentVisitRecord(storage, pending);
      try {
        const response = await fetch("/api/student/usage-visit", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (cancelled) return;
        if (!response.ok) {
          writeStudentVisitRecord(storage, null);
          return;
        }
        const payload = await response.json() as { ok?: boolean; date?: string; schoolClassId?: string; schoolYearId?: string };
        if (!payload.ok || !payload.date || !payload.schoolClassId || !payload.schoolYearId) {
          writeStudentVisitRecord(storage, null);
          return;
        }
        writeStudentVisitRecord(storage, {
          date: payload.date,
          schoolClassId: payload.schoolClassId,
          schoolYearId: payload.schoolYearId,
          state: "counted",
          at: Date.now(),
        });
      } catch {
        writeStudentVisitRecord(storage, null);
      } finally {
        inFlight = false;
      }
    };

    void sync();
    const onFocus = () => { void sync(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
