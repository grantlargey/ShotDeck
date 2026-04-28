/**
 * Thin button primitive.
 *
 * It intentionally forwards style/className unchanged so existing pages can
 * adopt it without changing their visual appearance.
 */
export function Button({ children, type = "button", ...props }) {
  return (
    <button type={type} {...props}>
      {children}
    </button>
  );
}
