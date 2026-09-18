export const CAMPUS_AGENDA_LOGO_SRC = "/campus-agenda-logo.png";
export const CAMPUS_AGENDA_LOGO_ALT = "Campus Agenda";

interface BrandLogoProps {
  className?: string;
}

/** Logo officiel : image piston + wordmark, remplace le cercle CA. */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      className={className ? `brand-logo ${className}` : "brand-logo"}
      src={CAMPUS_AGENDA_LOGO_SRC}
      alt={CAMPUS_AGENDA_LOGO_ALT}
    />
  );
}
