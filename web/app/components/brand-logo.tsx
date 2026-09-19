type BrandLogoProps = {
  /** Version plus compacte pour la barre mobile enseignant. */
  compact?: boolean;
  className?: string;
};

export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  return (
    // Asset statique local : pas de loader Next/Image dans ce projet Vinext.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/branding/campus-agenda-logo-transparent.png"
      alt="Campus Agenda"
      className={["brand-logo", compact ? "brand-logo-compact" : undefined, className]
        .filter(Boolean)
        .join(" ")}
      width={2172}
      height={724}
    />
  );
}
