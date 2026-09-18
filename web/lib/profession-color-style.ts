import type { CSSProperties } from "react";

import {
  professionColorStyleVars,
  type ProfessionColorTheme,
} from "@campus/features/school-catalog";

/** Variables CSS profession pour `style={…}` React (barre latérale, pastilles). */
export function professionColorStyle(theme: ProfessionColorTheme): CSSProperties {
  return professionColorStyleVars(theme) as CSSProperties;
}
