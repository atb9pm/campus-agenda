type BrandLogoProps = {
  /** Version plus compacte pour la barre mobile enseignant. */
  compact?: boolean;
  className?: string;
};

export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  return (
    <img
      src="/campus-agenda-logo.jpg"
      alt="Campus Agenda"
      className={["brand-logo", compact ? "brand-logo-compact" : undefined, className]
        .filter(Boolean)
        .join(" ")}
      width={2244}
      height={701}
    />
  );
}
