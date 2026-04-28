export function FeedbackMessage({ children, tone = "info", ...props }) {
  if (!children) return null;
  const color = tone === "error" ? "crimson" : "#1f5d1f";
  return (
    <p style={{ color }} {...props}>
      {children}
    </p>
  );
}
