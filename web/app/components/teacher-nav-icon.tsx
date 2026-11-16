import type { TeacherNavSection } from "@campus/features/teacher";

const svgProps = {
  className: "teacher-nav-icon",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function TeacherNavIcon({ name }: { name: TeacherNavSection }) {
  if (name === "ma-semaine") {
    return (
      <svg {...svgProps}>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 14h.01" />
        <path d="M17 14h-6" />
        <path d="M13 18H7" />
        <path d="M17 18h.01" />
      </svg>
    );
  }
  if (name === "mes-cours") {
    return (
      <svg {...svgProps}>
        <path d="M12 6.2v12.2" />
        <path d="M12 6.2C10.6 4.6 8.4 3.8 5 3.8H3.5v12.4H5c2.8 0 4.8.8 7 2.2 2.2-1.4 4.2-2.2 7-2.2h1.5V3.8H19c-3.4 0-5.6.8-7 2.4z" />
      </svg>
    );
  }
  if (name === "controles") {
    return (
      <svg {...svgProps}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    );
  }
  if (name === "configuration") {
    return (
      <svg {...svgProps}>
        <line x1="21" x2="14" y1="4" y2="4" />
        <line x1="10" x2="3" y1="4" y2="4" />
        <line x1="21" x2="12" y1="12" y2="12" />
        <line x1="8" x2="3" y1="12" y2="12" />
        <line x1="21" x2="16" y1="20" y2="20" />
        <line x1="12" x2="3" y1="20" y2="20" />
        <line x1="14" x2="14" y1="2" y2="6" />
        <line x1="8" x2="8" y1="10" y2="14" />
        <line x1="16" x2="16" y1="18" y2="22" />
      </svg>
    );
  }
  return (
    <svg {...svgProps}>
      <path d="M12 3 5.2 5.6v6.1c0 4.1 2.8 6.4 6.4 7.5.26.07.54.07.8 0 3.6-1.1 6.4-3.4 6.4-7.5V5.6L12 3z" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 8.1v1.2M12 14.7v1.2M8.1 12h1.2M14.7 12h1.2M9.3 9.3l.85.85M13.85 13.85l.85.85M14.7 9.3l-.85.85M10.15 13.85l-.85.85" />
    </svg>
  );
}
