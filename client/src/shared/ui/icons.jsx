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

/** A script page with a folded corner. */
export function ScriptIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M4 1.75h5.5l2.75 2.75v9.75H4z" />
      <path d="M9.5 1.75V4.5h2.75M6.25 8h3.5M6.25 10.75h3.5" />
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

/** A card split between a picture and lines of text. */
export function SplitViewIcon(props) {
  return (
    <StrokeIcon {...props}>
      <rect x="2.75" y="1.75" width="10.5" height="12.5" rx="1.5" />
      <path d="M2.75 8h10.5M5.25 10.5h5.5M5.25 12.25h3.5" />
      <path d="M4.75 6.25l2-1.75 1.5 1.25 1.25-1 1.75 1.5" />
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

export function EyeIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </StrokeIcon>
  );
}

export function EyeOffIcon(props) {
  return (
    <StrokeIcon {...props}>
      <path d="M6.6 3.65A6.4 6.4 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11.6 11.6 0 0 1-1.7 2.25M10.9 11.7A6.1 6.1 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11.4 11.4 0 0 1 2.9-3.45" />
      <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8" />
      <path d="M2 2l12 12" />
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
