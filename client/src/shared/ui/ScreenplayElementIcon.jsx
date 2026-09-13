const ICON_PATHS = {
  heading: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M4 11l3-3.5 2 2 1.5-1.5L12 11" />
    </>
  ),
  action: <path d="M3 4h10M3 8h10M3 12h6" />,
  character: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13.5c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4" />
    </>
  ),
  parenthetical: (
    <path d="M6 2.5C4.2 4 3.5 6 3.5 8s.7 4 2.5 5.5M10 2.5c1.8 1.5 2.5 3.5 2.5 5.5s-.7 4-2.5 5.5" />
  ),
  dialogue: (
    <path d="M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5a1.5 1.5 0 01-1.5 1.5H7l-3 2.5V11h-.5A1.5 1.5 0 013 9.5z" />
  ),
  shot: (
    <>
      <rect x="2" y="5" width="8.5" height="6.5" rx="1.2" />
      <path d="M10.5 7.5L14 5.5v6l-3.5-2" />
    </>
  ),
  transition: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" />
      <path d="M5 11l6-6" />
    </>
  ),
  centered: <path d="M3 4h10M5 8h6M4 12h8" />,
};

export function ScreenplayElementIcon({ type, size = 16, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICON_PATHS[type] || ICON_PATHS.action}
    </svg>
  );
}
