export interface ProfessionColorTheme {
  /** Abréviation métier (MECAUTO, CONDVL…). */
  prefix: string;
  /** Libellé court pour légende / infobulle. */
  legendLabel: string;
  accent: string;
  background: string;
  foreground: string;
}

/** Palette fixe par abréviation de profession — Ma semaine, Préférences, Administration. */
export const PROFESSION_COLOR_THEMES: Record<string, ProfessionColorTheme> = {
  MECAUTO: {
    prefix: "MECAUTO",
    legendLabel: "Mécatronicien d'automobiles",
    accent: "#1d4ed8",
    background: "#dbeafe",
    foreground: "#1d4ed8",
  },
  MECMA: {
    prefix: "MECMA",
    legendLabel: "Mécanicien en maintenance auto",
    accent: "#c2410c",
    background: "#ffedd5",
    foreground: "#c2410c",
  },
  AMA: {
    prefix: "AMA",
    legendLabel: "Assistant en maintenance auto",
    accent: "#047857",
    background: "#d1fae5",
    foreground: "#047857",
  },
  CONDVL: {
    prefix: "CONDVL",
    legendLabel: "Conducteur de véhicules lourds",
    accent: "#475569",
    background: "#e2e8f0",
    foreground: "#334155",
  },
  MACAM: {
    prefix: "MACAM",
    legendLabel: "Mécanicien machines agricoles",
    accent: "#d97706",
    background: "#fef3c7",
    foreground: "#b45309",
  },
};

export const DEFAULT_PROFESSION_COLOR: ProfessionColorTheme = {
  prefix: "",
  legendLabel: "Autre profession",
  accent: "#64748b",
  background: "#f1f5f9",
  foreground: "#475569",
};

const KNOWN_PREFIXES = Object.keys(PROFESSION_COLOR_THEMES).sort(
  (left, right) => right.length - left.length,
);

export function normalizeProfessionPrefix(raw: string | null | undefined): string | null {
  const normalized = raw?.trim().toUpperCase() ?? "";
  return normalized || null;
}

/** Infère l’abréviation depuis un code classe (MECAUTO3A → MECAUTO). */
export function inferProfessionPrefixFromClassCode(classCode: string | null | undefined): string | null {
  const normalized = classCode?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  for (const prefix of KNOWN_PREFIXES) {
    if (normalized.startsWith(prefix)) return prefix;
  }
  return null;
}

export function resolveProfessionColorTheme(
  prefix: string | null | undefined,
  classCode?: string | null,
): ProfessionColorTheme {
  const direct = normalizeProfessionPrefix(prefix);
  if (direct && PROFESSION_COLOR_THEMES[direct]) {
    return PROFESSION_COLOR_THEMES[direct]!;
  }
  const inferred = inferProfessionPrefixFromClassCode(classCode);
  if (inferred && PROFESSION_COLOR_THEMES[inferred]) {
    return PROFESSION_COLOR_THEMES[inferred]!;
  }
  return DEFAULT_PROFESSION_COLOR;
}

export function professionColorStyleVars(
  theme: ProfessionColorTheme,
): Record<"--profession-accent" | "--profession-bg" | "--profession-fg", string> {
  return {
    "--profession-accent": theme.accent,
    "--profession-bg": theme.background,
    "--profession-fg": theme.foreground,
  };
}

export function listProfessionColorLegend(): ProfessionColorTheme[] {
  return Object.values(PROFESSION_COLOR_THEMES);
}
