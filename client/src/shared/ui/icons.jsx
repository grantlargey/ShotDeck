/**
 * Stroke icons drawn on a 16px grid. They use `currentColor`, so they take the
 * text color of whatever contains them.
 */
function StrokeIcon({ size = 16, strokeWidth = 1.7, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <StrokeIcon {...props}>
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.5 10.5L14 14" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 6l4 4 4-4" />
    </StrokeIcon>
  );
}

export function ChevronLeftIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </StrokeIcon>
  );
}

export function ChevronRightIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </StrokeIcon>
  );
}

export function CloseIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </StrokeIcon>
  );
}

export function MoreIcon(props) {
  return (
    <StrokeIcon strokeWidth={2.4} {...props}>
      <path d="M8 3.5h0M8 8h0M8 12.5h0" />
    </StrokeIcon>
  );
}
