"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import type {
  ReferenceItemType,
  ReferencePedagogicalPath,
} from "@campus/features/pedagogical-path";
import { REFERENCE_ITEM_TYPE_LABELS } from "@campus/features/pedagogical-path";

interface PedagogicalPathPanelProps {
  contextId: string;
  adminCode: string;
  branchLabel: string;
  onNotice: (message: string) => void;
  onClose: () => void;
}

type ItemDraft = { type: ReferenceItemType; title: string; detail: string };

async function postAction(
  contextId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<ReferencePedagogicalPath> {
  const response = await fetch("/api/admin/pedagogical-path", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contextId, action, ...payload }),
  });
  const data = (await response.json()) as {
    ok: boolean;
    reason?: string;
    path?: ReferencePedagogicalPath;
  };
  if (!response.ok || !data.ok || !data.path) {
    throw new Error(data.reason ?? "Action parcours impossible.");
  }
  return data.path;
}

const EMPTY_DRAFT: ItemDraft = { type: "HOMEWORK", title: "", detail: "" };

export function PedagogicalPathPanel({
  contextId,
  adminCode,
  branchLabel,
  onNotice,
  onClose,
}: PedagogicalPathPanelProps) {
  const [path, setPath] = useState<ReferencePedagogicalPath | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/pedagogical-path?contextId=${encodeURIComponent(contextId)}`,
        { credentials: "include" },
      );
      const data = (await response.json()) as {
        ok: boolean;
        reason?: string;
        path?: ReferencePedagogicalPath;
      };
      if (!response.ok || !data.ok || !data.path) {
        throw new Error(data.reason ?? "Chargement du parcours impossible.");
      }
      setPath(data.path);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [contextId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  async function run(
    action: string,
    payload: Record<string, unknown> = {},
    notice?: string,
  ) {
    setError("");
    try {
      const next = await postAction(contextId, action, payload);
      setPath(next);
      if (notice) onNotice(notice);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action impossible.");
    }
  }

  function draftFor(sessionId: string): ItemDraft {
    return itemDrafts[sessionId] ?? EMPTY_DRAFT;
  }

  async function submitItem(event: FormEvent, sessionId: string) {
    event.preventDefault();
    const draft = draftFor(sessionId);
    if (!draft.title.trim()) {
      setError("Le titre de l'élément est obligatoire.");
      return;
    }
    await run(
      "addItem",
      {
        sessionId,
        itemType: draft.type,
        title: draft.title,
        detail: draft.detail,
      },
      "Élément ajouté à la séance.",
    );
    setItemDrafts((current) => ({ ...current, [sessionId]: EMPTY_DRAFT }));
  }

  const sessions = [...(path?.sessions ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="pedagogical-path-panel">
      <header className="pedagogical-path-header">
        <div>
          <h4>Parcours de référence</h4>
          <p>
            <span className="admin-admin-code">{adminCode}</span>
            {" · "}
            {branchLabel}
          </p>
        </div>
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}
      {loading ? <p className="admin-loading">Chargement du parcours…</p> : null}

      {!loading && path ? (
        <>
          <div className="pedagogical-path-toolbar">
            <button type="button" onClick={() => void run("addSession", {}, "Séance ajoutée.")}>
              Ajouter une séance
            </button>
          </div>

          {sessions.length === 0 ? (
            <p className="admin-profession-empty">
              Aucune séance. Ajoutez la séance 1 pour commencer.
            </p>
          ) : (
            <ol className="pedagogical-path-sessions">
              {sessions.map((session) => {
                const items = [...session.items].sort((a, b) => a.position - b.position);
                const draft = draftFor(session.id);
                return (
                  <li key={session.id} className="pedagogical-path-session">
                    <div className="pedagogical-path-session-head">
                      <strong>
                        Séance {session.position}
                        {session.label ? ` — ${session.label}` : ""}
                      </strong>
                      <div className="pedagogical-path-session-actions">
                        <button
                          type="button"
                          disabled={session.position <= 1}
                          onClick={() =>
                            void run(
                              "moveSession",
                              { sessionId: session.id, position: session.position - 1 },
                              "Séance déplacée.",
                            )
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={session.position >= sessions.length}
                          onClick={() =>
                            void run(
                              "moveSession",
                              { sessionId: session.id, position: session.position + 1 },
                              "Séance déplacée.",
                            )
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void run(
                              "insertSession",
                              { atPosition: session.position },
                              "Séance insérée.",
                            )
                          }
                        >
                          Insérer avant
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const label = window.prompt(
                              "Libellé court (optionnel)",
                              session.label ?? "",
                            );
                            if (label === null) return;
                            void run(
                              "updateSession",
                              { sessionId: session.id, label },
                              "Séance mise à jour.",
                            );
                          }}
                        >
                          Libellé
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void run(
                              "deleteSession",
                              { sessionId: session.id },
                              "Séance supprimée.",
                            )
                          }
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>

                    {items.length === 0 ? (
                      <p className="admin-profession-empty">Aucun élément</p>
                    ) : (
                      <ul className="pedagogical-path-items">
                        {items.map((item) => (
                          <li key={item.id}>
                            <div>
                              <span className="pedagogical-path-item-type">
                                {REFERENCE_ITEM_TYPE_LABELS[item.type]}
                              </span>
                              <strong>{item.title}</strong>
                              {item.detail ? <p>{item.detail}</p> : null}
                            </div>
                            <div className="pedagogical-path-item-actions">
                              <button
                                type="button"
                                disabled={item.position <= 1}
                                onClick={() =>
                                  void run("moveItem", {
                                    itemId: item.id,
                                    targetSessionId: session.id,
                                    position: item.position - 1,
                                  })
                                }
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={item.position >= items.length}
                                onClick={() =>
                                  void run("moveItem", {
                                    itemId: item.id,
                                    targetSessionId: session.id,
                                    position: item.position + 1,
                                  })
                                }
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const title = window.prompt("Titre", item.title);
                                  if (title === null) return;
                                  const detail = window.prompt("Détail", item.detail);
                                  if (detail === null) return;
                                  void run(
                                    "updateItem",
                                    { itemId: item.id, title, detail },
                                    "Élément modifié.",
                                  );
                                }}
                              >
                                Modifier
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void run(
                                    "deleteItem",
                                    { itemId: item.id },
                                    "Élément supprimé.",
                                  )
                                }
                              >
                                Supprimer
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      className="pedagogical-path-item-form"
                      onSubmit={(event) => void submitItem(event, session.id)}
                    >
                      <label>
                        Type
                        <select
                          value={draft.type}
                          onChange={(event) =>
                            setItemDrafts((current) => ({
                              ...current,
                              [session.id]: {
                                ...draft,
                                type: event.target.value as ReferenceItemType,
                              },
                            }))
                          }
                        >
                          <option value="HOMEWORK">Devoir</option>
                          <option value="TEST">Contrôle</option>
                          <option value="INFORMATION">Information</option>
                        </select>
                      </label>
                      <label>
                        Titre
                        <input
                          value={draft.title}
                          onChange={(event) =>
                            setItemDrafts((current) => ({
                              ...current,
                              [session.id]: { ...draft, title: event.target.value },
                            }))
                          }
                          placeholder="Exercices moteur 4 temps"
                          required
                        />
                      </label>
                      <label>
                        Détail
                        <input
                          value={draft.detail}
                          onChange={(event) =>
                            setItemDrafts((current) => ({
                              ...current,
                              [session.id]: { ...draft, detail: event.target.value },
                            }))
                          }
                          placeholder="Précisions optionnelles"
                        />
                      </label>
                      <button type="submit">Ajouter</button>
                    </form>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : null}
    </div>
  );
}
