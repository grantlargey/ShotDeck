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
