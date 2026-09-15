import { cx } from "@/shared/lib/cx.js";
import styles from "./Button.module.css";

/**
 * The app's single button style. Pass `as={Link}` with `to` to render a router
 * link that looks like a button.
 *
 * variant: primary | secondary | ghost | danger | ai | link
 * size: sm (32px) | md (40px) | lg (50px)
 */
export function Button({
  as: Component = "button",
  variant = "secondary",
  size = "md",
  block = false,
  type,
  className,
  children,
  ...props
}) {
  return (
    <Component
      type={Component === "button" ? type || "button" : type}
      className={cx(styles.button, styles[size], styles[variant], block && styles.block, className)}
      {...props}
    >
      {children}
    </Component>
  );
}
