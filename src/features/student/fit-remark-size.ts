/** Taille minimale lisible d’une remarque de contrôle. */
export const REMARK_FONT_MIN = 18;

/**
 * En dessous de ce seuil, une seule ligne deviendrait trop petite :
 * la remarque passe alors sur deux lignes, plus grandes.
 */
export const REMARK_SINGLE_LINE_FLOOR = 22;

/**
 * Plus grande taille qui tient dans la place disponible, sans dépasser `max`
 * (la taille du jour de cours). `fits` doit être vrai lorsque le texte tient.
 */
export function fitRemarkFontSize(
  max: number,
  fits: (size: number, singleLine: boolean) => boolean,
): { size: number; singleLine: boolean } {
  const upper = Math.max(REMARK_FONT_MIN, Math.floor(max));
  if (fits(upper, true)) return { size: upper, singleLine: true };

  const oneLine = largestFitting(REMARK_FONT_MIN, upper, (size) => fits(size, true));
  if (oneLine >= REMARK_SINGLE_LINE_FLOOR) return { size: oneLine, singleLine: true };

  const twoLines = largestFitting(REMARK_FONT_MIN, upper, (size) => fits(size, false));
  return { size: twoLines, singleLine: false };
}

function largestFitting(min: number, max: number, fits: (size: number) => boolean): number {
  if (!fits(min)) return min;
  let low = min;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}
