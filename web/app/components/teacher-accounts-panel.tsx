"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { formatLastLoginAt } from "@campus/features/teacher-accounts/index.ts";
import {
  createTeacherAccountApi,
  fetchTeacherAccounts,
  resetTeacherPasswordApi,
  updateTeacherAccountApi,
  type TeacherAccountRecord,
} from "../../lib/api-client.ts";

interface TeacherAccountsPanelProps {
  /** « accounts » : création et mots de passe. « roles » : administrateur et activation. */
  mode: "accounts" | "roles";
  currentTeacherId: string;
  onNotice: (message: string) => void;
}

interface RevealedPassword {
  teacherId: string;
  displayName: string;
  initials: string;
  password: string;
}

interface EditDraft {
  teacherId: string;
  displayName: string;
  initials: string;
}

function passwordLabel(account: TeacherAccountRecord): string {
  if (account.mustChangePassword) return "Mot de passe provisoire";
  if (account.hasPassword) return "Mot de passe personnel";
  return "Sans mot de passe";
}

function accountCardClass(account: TeacherAccountRecord): string {
  if (account.isArchived) return "admin-teacher-card is-archived";
  if (!account.isActive) return "admin-teacher-card is-inactive";
  return "admin-teacher-card is-active";
}

export function TeacherAccountsPanel({ mode, currentTeacherId, onNotice }: TeacherAccountsPanelProps) {
  const [accounts, setAccounts] = useState<TeacherAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [revealed, setRevealed] = useState<RevealedPassword | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await fetchTeacherAccounts());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Chargement initial de la liste : l'état ne peut être rempli qu'après montage.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const archivedCount = useMemo(
    () => accounts.filter((account) => account.isArchived).length,
    [accounts],
  );

  const visibleAccounts = useMemo(
    () => accounts.filter((account) => (showArchived ? account.isArchived : !account.isArchived)),
    [accounts, showArchived],
  );

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const created = await createTeacherAccountApi({ displayName, initials, isAdmin });
      setDisplayName("");
      setInitials("");
      setIsAdmin(false);
      setRevealed({
        teacherId: created.teacher.id,
        displayName: created.teacher.displayName,
        initials: created.teacher.initials,
        password: created.temporaryPassword,
      });
      onNotice(`Compte ${created.teacher.initials} créé.`);
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Création impossible.");
    }
  }

  async function resetPassword(account: TeacherAccountRecord) {
    setError("");
    try {
      const reset = await resetTeacherPasswordApi(account.id);
      setRevealed({
        teacherId: account.id,
        displayName: account.displayName,
        initials: account.initials,
        password: reset.temporaryPassword,
      });
      onNotice(`Mot de passe provisoire régénéré pour ${account.initials}.`);
      await refresh();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Réinitialisation impossible.");
    }
  }

  async function patchAccount(
    account: TeacherAccountRecord,
    patch: {
      displayName?: string;
      initials?: string;
      isAdmin?: boolean;
      isActive?: boolean;
      isArchived?: boolean;
    },
  ) {
    setError("");
    try {
      await updateTeacherAccountApi(account.id, patch);
      if (patch.isArchived === true) onNotice(`Compte ${account.initials} archivé.`);
      if (patch.isArchived === false) onNotice(`Compte ${account.initials} désarchivé.`);
      await refresh();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Mise à jour impossible.");
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editDraft) return;
    const account = accounts.find((entry) => entry.id === editDraft.teacherId);
    if (!account) return;
    setError("");
    try {
      await updateTeacherAccountApi(account.id, {
        displayName: editDraft.displayName,
        initials: editDraft.initials,
      });
      onNotice(`Compte ${editDraft.initials.trim() || account.initials} mis à jour.`);
      setEditDraft(null);
      await refresh();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Modification impossible.");
    }
  }

  return (
    <div className="admin-panel-block">
      <header className="config-section-header">
        <div>
          <h3>{mode === "accounts" ? "Gestion des enseignants" : "Gestion des accès"}</h3>
          <p>
            {mode === "accounts"
              ? "Créez un compte par enseignant. Le mot de passe provisoire s’affiche une seule fois : notez-le et transmettez-le de vive voix."
              : "Rôle administrateur, activation et archivage. Un administrateur actif doit toujours rester."}
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}
      {loading ? <p className="admin-loading">Chargement…</p> : null}

      {mode === "accounts" ? (
        <form className="admin-inline-form" onSubmit={(event) => void submitAccount(event)}>
          <label>
            Nom affiché
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Marie Dupont"
              required
            />
          </label>
          <label>
            Initiales
            <input
              value={initials}
              onChange={(event) => setInitials(event.target.value)}
              placeholder="DuM"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="admin-checkbox">
            <input type="checkbox" checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} />
            <span>Administrateur</span>
          </label>
          <button type="submit" className="workspace-action">Créer le compte</button>
        </form>
      ) : null}

      {revealed ? (
        <div className="admin-secret" role="status">
          <p className="admin-secret-title">Mot de passe provisoire de {revealed.displayName}</p>
          <p className="admin-secret-value">{revealed.password}</p>
          <p className="admin-secret-hint">
            Initiales de connexion&nbsp;: <strong>{revealed.initials}</strong>. Ce mot de passe ne sera plus
            affiché ; l’enseignant devra en choisir un nouveau à sa première connexion.
          </p>
          <button type="button" onClick={() => setRevealed(null)}>J’ai noté</button>
        </div>
      ) : null}

      {!loading ? (
        <>
          <div className="admin-teacher-toolbar">
            <button
              type="button"
              className={!showArchived ? "is-selected" : undefined}
              onClick={() => setShowArchived(false)}
            >
              Comptes ({accounts.length - archivedCount})
            </button>
            <button
              type="button"
              className={showArchived ? "is-selected" : undefined}
              onClick={() => setShowArchived(true)}
            >
              Archives ({archivedCount})
            </button>
          </div>

          {visibleAccounts.length === 0 ? (
            <p className="admin-loading">
              {showArchived ? "Aucun compte archivé." : "Aucun compte dans cette liste."}
            </p>
          ) : (
            <ul className="admin-teacher-access-list">
              {visibleAccounts.map((account) => {
                const editing = editDraft?.teacherId === account.id;
                return (
                  <li key={account.id} className={accountCardClass(account)}>
                    <div className="admin-teacher-identity">
                      <strong className="admin-teacher-initials">{account.initials}</strong>
                      {editing && editDraft ? (
                        <form className="admin-teacher-edit-form" onSubmit={(event) => void saveEdit(event)}>
                          <label>
                            Nom
                            <input
                              value={editDraft.displayName}
                              onChange={(event) =>
                                setEditDraft({ ...editDraft, displayName: event.target.value })
                              }
                              required
                            />
                          </label>
                          <label>
                            Initiales
                            <input
                              value={editDraft.initials}
                              onChange={(event) =>
                                setEditDraft({ ...editDraft, initials: event.target.value })
                              }
                              autoCapitalize="none"
                              spellCheck={false}
                              required
                            />
                          </label>
                          <div className="admin-teacher-edit-actions">
                            <button type="submit">Enregistrer</button>
                            <button type="button" onClick={() => setEditDraft(null)}>Annuler</button>
                          </div>
                        </form>
                      ) : (
                        <div>
                          <p className="admin-teacher-name">{account.displayName}</p>
                          <p className="admin-teacher-login-meta">
                            Dernière connexion&nbsp;: {formatLastLoginAt(account.lastLoginAt)}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="admin-teacher-badges" aria-label="État du compte">
                      <span
                        className={
                          account.isArchived || !account.isActive
                            ? "badge-status is-off"
                            : "badge-status is-on"
                        }
                      >
                        {account.isArchived ? "Archivé" : account.isActive ? "Actif" : "Désactivé"}
                      </span>
                      <span className={account.isAdmin ? "badge-role is-admin" : "badge-role"}>
                        {account.isAdmin ? "Administrateur" : "Enseignant"}
                      </span>
                      <span className="badge-password">{passwordLabel(account)}</span>
                    </div>

                    <div className="admin-teacher-actions">
                      {!editing ? (
                        <button
                          type="button"
                          onClick={() =>
                            setEditDraft({
                              teacherId: account.id,
                              displayName: account.displayName,
                              initials: account.initials,
                            })
                          }
                        >
                          Modifier
                        </button>
                      ) : null}

                      {mode === "accounts" ? (
                        <button type="button" onClick={() => void resetPassword(account)}>
                          Réinitialiser le mot de passe
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={account.id === currentTeacherId || account.isArchived}
                            onClick={() => void patchAccount(account, { isAdmin: !account.isAdmin })}
                          >
                            {account.isAdmin ? "Retirer l’administration" : "Nommer administrateur"}
                          </button>
                          <button
                            type="button"
                            disabled={account.id === currentTeacherId || account.isArchived}
                            onClick={() => void patchAccount(account, { isActive: !account.isActive })}
                          >
                            {account.isActive ? "Désactiver" : "Réactiver"}
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        disabled={account.id === currentTeacherId}
                        onClick={() => void patchAccount(account, { isArchived: !account.isArchived })}
                      >
                        {account.isArchived ? "Désarchiver" : "Archiver"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
