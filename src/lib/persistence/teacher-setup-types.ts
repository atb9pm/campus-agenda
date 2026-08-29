import type { TeacherSetupConfig } from "../../features/teacher-setup/types.ts";

export interface TeacherSetupBackupEntry {
  teacherId: string;
  config: TeacherSetupConfig;
}

export interface TeacherSetupStore {
  /** Null si l'enseignant n'a encore rien enregistré côté serveur. */
  getSetup(teacherId: string): Promise<TeacherSetupConfig | null>;
  saveSetup(teacherId: string, config: TeacherSetupConfig): Promise<TeacherSetupConfig>;
  /** Toutes les configs (sauvegarde admin). */
  exportAllSetups(): Promise<TeacherSetupBackupEntry[]>;
  /** Remplace entièrement la table (restauration admin). */
  replaceAllSetups(entries: TeacherSetupBackupEntry[]): Promise<void>;
}
