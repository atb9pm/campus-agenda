import { DEMO_CATALOG, DEMO_CURRENT_TEACHER_ID } from "../../features/classes/demo-data.ts";
import {
  buildTeacherId,
  checkAccountInput,
  initialsKey,
  normalizeDisplayName,
  normalizeInitials,
  sortAccounts,
  wouldRemoveLastAdmin,
} from "../../features/teacher-accounts/rules.ts";
import type {
  TeacherAccountInput,
  TeacherAccountPatch,
  TeacherAccountRecord,
  TeacherAccountResult,
  TeacherAccountSecretResult,
  TeacherAuthOutcome,
  TeacherPasswordChangeResult,
} from "../../features/teacher-accounts/types.ts";
import {
  checkPasswordStrength,
  generateTemporaryPassword,
  hashPassword,
  isUsablePasswordHash,
  legacyDemoPasswordHash,
  verifyPassword,
} from "../auth/password.ts";
import type { TeacherAccountStore } from "./teacher-account-types.ts";

interface MemoryAccount {
  id: string;
  displayName: string;
  initials: string;
  isAdmin: boolean;
  isActive: boolean;
  archivedAt: string | null;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  passwordHash: string;
  createdAt: string;
  passwordUpdatedAt: string | null;
}

function toRecord(account: MemoryAccount): TeacherAccountRecord {
  return {
    id: account.id,
    displayName: account.displayName,
    initials: account.initials,
    isAdmin: account.isAdmin,
    isActive: account.isActive,
    isArchived: account.archivedAt !== null,
    archivedAt: account.archivedAt,
    lastLoginAt: account.lastLoginAt,
    mustChangePassword: account.mustChangePassword,
    hasPassword: isUsablePasswordHash(account.passwordHash),
    createdAt: account.createdAt,
    passwordUpdatedAt: account.passwordUpdatedAt,
  };
}

export class MemoryTeacherAccountStore implements TeacherAccountStore {
  private accounts: MemoryAccount[] = [];
  private seeded = false;

  private ensureSeeded(): void {
    if (this.seeded) return;
    const now = new Date().toISOString();
    this.accounts = DEMO_CATALOG.teachers.map((teacher) => ({
      id: teacher.id,
      displayName: teacher.displayName,
      initials: teacher.initials,
      isAdmin: teacher.id === DEMO_CURRENT_TEACHER_ID,
      isActive: true,
      archivedAt: null,
      lastLoginAt: null,
      mustChangePassword: false,
      passwordHash: legacyDemoPasswordHash(),
      createdAt: now,
      passwordUpdatedAt: null,
    }));
    this.seeded = true;
  }

  private find(teacherId: string): MemoryAccount | undefined {
    this.ensureSeeded();
    return this.accounts.find((account) => account.id === teacherId);
  }

  async listAccounts(): Promise<TeacherAccountRecord[]> {
    this.ensureSeeded();
    return sortAccounts(this.accounts.map(toRecord));
  }

  async findAccount(teacherId: string): Promise<TeacherAccountRecord | null> {
    const account = this.find(teacherId);
    return account ? toRecord(account) : null;
  }

  async findAccountByInitials(initials: string): Promise<TeacherAccountRecord | null> {
    this.ensureSeeded();
    const key = initialsKey(initials);
    if (!key) return null;
    const account = this.accounts.find((entry) => initialsKey(entry.initials) === key);
    return account ? toRecord(account) : null;
  }

  async createAccount(input: TeacherAccountInput): Promise<TeacherAccountSecretResult> {
    this.ensureSeeded();
    const check = checkAccountInput(input.displayName, input.initials);
    if (!check.ok) return { ok: false, reason: check.reason, status: 400 };

    const initials = normalizeInitials(input.initials);
    if (await this.findAccountByInitials(initials)) {
      return { ok: false, reason: `Les initiales ${initials} sont déjà utilisées.`, status: 409 };
    }

    const temporaryPassword = generateTemporaryPassword();
    const now = new Date().toISOString();
    const account: MemoryAccount = {
      id: buildTeacherId(initials, this.accounts.map((entry) => entry.id)),
      displayName: normalizeDisplayName(input.displayName),
      initials,
      isAdmin: input.isAdmin ?? false,
      isActive: true,
      archivedAt: null,
      lastLoginAt: null,
      mustChangePassword: true,
      passwordHash: await hashPassword(temporaryPassword),
      createdAt: now,
      passwordUpdatedAt: now,
    };
    this.accounts.push(account);
    return { ok: true, account: toRecord(account), temporaryPassword };
  }

  async updateAccount(teacherId: string, patch: TeacherAccountPatch): Promise<TeacherAccountResult> {
    const account = this.find(teacherId);
    if (!account) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };

    if (patch.initials !== undefined) {
      const initials = normalizeInitials(patch.initials);
      if (initials.length < 2) {
        return { ok: false, reason: "Les initiales doivent contenir au moins deux lettres.", status: 400 };
      }
      const existing = await this.findAccountByInitials(initials);
      if (existing && existing.id !== teacherId) {
        return { ok: false, reason: `Les initiales ${initials} sont déjà utilisées.`, status: 409 };
      }
      account.initials = initials;
    }

    if (patch.displayName !== undefined) {
      const displayName = normalizeDisplayName(patch.displayName);
      if (displayName.length < 2) return { ok: false, reason: "Le nom affiché est requis.", status: 400 };
      account.displayName = displayName;
    }

    if (
      patch.isAdmin !== undefined
      || patch.isActive !== undefined
      || patch.isArchived !== undefined
    ) {
      const records = this.accounts.map(toRecord);
      if (wouldRemoveLastAdmin(records, teacherId, patch)) {
        return { ok: false, reason: "Au moins un administrateur actif doit rester.", status: 400 };
      }
      if (patch.isAdmin !== undefined) account.isAdmin = patch.isAdmin;
      if (patch.isActive !== undefined) account.isActive = patch.isActive;
      if (patch.isArchived !== undefined) {
        if (patch.isArchived) {
          account.archivedAt = account.archivedAt ?? new Date().toISOString();
          account.isActive = false;
        } else {
          account.archivedAt = null;
        }
      }
    }

    return { ok: true, account: toRecord(account) };
  }

  async resetPassword(teacherId: string): Promise<TeacherAccountSecretResult> {
    const account = this.find(teacherId);
    if (!account) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };
    const temporaryPassword = generateTemporaryPassword();
    account.passwordHash = await hashPassword(temporaryPassword);
    account.mustChangePassword = true;
    account.passwordUpdatedAt = new Date().toISOString();
    return { ok: true, account: toRecord(account), temporaryPassword };
  }

  async changeOwnPassword(
    teacherId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<TeacherPasswordChangeResult> {
    const account = this.find(teacherId);
    if (!account) return { ok: false, reason: "Compte enseignant introuvable.", status: 404 };
    if (!(await verifyPassword(currentPassword, account.passwordHash))) {
      return { ok: false, reason: "Mot de passe actuel incorrect.", status: 401 };
    }
    const strength = checkPasswordStrength(nextPassword);
    if (!strength.ok) return { ok: false, reason: strength.reason, status: 400 };

    account.passwordHash = await hashPassword(nextPassword.trim());
    account.mustChangePassword = false;
    account.passwordUpdatedAt = new Date().toISOString();
    return { ok: true };
  }

  async setPassword(teacherId: string, password: string, mustChangePassword: boolean): Promise<boolean> {
    const account = this.find(teacherId);
    if (!account) return false;
    account.passwordHash = await hashPassword(password.trim());
    account.mustChangePassword = mustChangePassword;
    account.passwordUpdatedAt = new Date().toISOString();
    return true;
  }

  async authenticate(initialsOrId: string, password: string): Promise<TeacherAuthOutcome> {
    this.ensureSeeded();
    const candidate = initialsOrId.trim();
    const account =
      this.accounts.find((entry) => initialsKey(entry.initials) === initialsKey(candidate)) ??
      this.accounts.find((entry) => entry.id === candidate);
    if (!account) return { ok: false, reason: "Initiales ou mot de passe incorrect." };
    if (!(await verifyPassword(password, account.passwordHash))) {
      return { ok: false, reason: "Initiales ou mot de passe incorrect." };
    }
    if (account.archivedAt !== null) {
      return { ok: false, reason: "Ce compte est archivé. Contactez l'administrateur." };
    }
    if (!account.isActive) {
      return { ok: false, reason: "Ce compte est désactivé. Contactez l'administrateur." };
    }
    account.lastLoginAt = new Date().toISOString();
    return { ok: true, teacherId: account.id, mustChangePassword: account.mustChangePassword };
  }

  async mustChangePassword(teacherId: string): Promise<boolean> {
    return Boolean(this.find(teacherId)?.mustChangePassword);
  }

  /** Vérification héritée utilisée par le store agenda mémoire. */
  async verifyCredentials(teacherId: string, password: string): Promise<boolean> {
    const account = this.find(teacherId);
    if (!account || !account.isActive || account.archivedAt !== null) return false;
    return verifyPassword(password, account.passwordHash);
  }
}

let memoryTeacherAccountStore: MemoryTeacherAccountStore | null = null;

export function getMemoryTeacherAccountStore(): MemoryTeacherAccountStore {
  memoryTeacherAccountStore ??= new MemoryTeacherAccountStore();
  return memoryTeacherAccountStore;
}

export function resetMemoryTeacherAccountStore(): void {
  memoryTeacherAccountStore = null;
}
