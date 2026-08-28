"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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

export function TeacherAccountsPanel({ mode, currentTeacherId, onNotice }: TeacherAccountsPanelProps) {
  const [accounts, setAccounts] = useState<TeacherAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [revealed, setRevealed] = useState<RevealedPassword | null>(null);

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
    patch: { isAdmin?: boolean; isActive?: boolean },
  ) {
    setError("");
    try {
      await updateTeacherAccountApi(account.id, patch);
      await refresh();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Mise à jour impossible.");
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
              : "Rôle administrateur et activation des comptes. Un administrateur actif doit toujours rester."}
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
        <ul className="admin-catalog-list admin-teacher-list">
          {accounts.map((account) => (
            <li key={account.id}>
              <strong>{account.initials}</strong>
              <span>{account.displayName}</span>
              <span className={account.isActive ? "status-active" : "status-inactive"}>
                {account.isActive ? "Actif" : "Désactivé"}
              </span>
              <span className={account.isAdmin ? "status-active" : "status-inactive"}>
                {account.isAdmin ? "Administrateur" : "Enseignant"}
              </span>
              <span className={account.mustChangePassword ? "status-inactive" : "status-active"}>
                {account.mustChangePassword
                  ? "Mot de passe provisoire"
                  : account.hasPassword
                    ? "Mot de passe personnel"
                    : "Sans mot de passe"}
              </span>
              {mode === "accounts" ? (
                <button type="button" onClick={() => void resetPassword(account)}>
                  Réinitialiser le mot de passe
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={account.id === currentTeacherId}
                    onClick={() => void patchAccount(account, { isAdmin: !account.isAdmin })}
                  >
                    {account.isAdmin ? "Retirer l’administration" : "Nommer administrateur"}
                  </button>
                  <button
                    type="button"
                    disabled={account.id === currentTeacherId}
                    onClick={() => void patchAccount(account, { isActive: !account.isActive })}
                  >
                    {account.isActive ? "Désactiver" : "Réactiver"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
