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

/** A framed picture. */
export function ImageIcon(props) {
  return (
    <StrokeIcon {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.75" cy="6.25" r="1.1" />
      <path d="M2.5 11.75l3.25-3.25 2.5 2.5 2-2 3.25 3.25" />
    </StrokeIcon>
  );
}

export function UploadIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 10.5v-8M4.75 5.75L8 2.5l3.25 3.25" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </StrokeIcon>
  );
}

export function PlusIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M8 3v10M3 8h10" />
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

export function ChevronUpIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 10l4-4 4 4" />
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
