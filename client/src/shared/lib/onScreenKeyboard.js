// Touch screens, where a field that takes the caret raises the on-screen
// keyboard. CSS sets text fields at 16px or more under the same query, since
// iOS zooms into a smaller one as it takes focus.
const TOUCH_SCREEN_QUERY = "(pointer: coarse)";

/**
 * Whether the keyboard waits for a field to be tapped: on a touch screen,
 * opening something (a dialog, the film cover's editor, the sign-in page)
 * doesn't hand a field the caret, so the keyboard stays down until the reader
 * taps the field they want.
 */
export function keyboardWaitsForTap() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(TOUCH_SCREEN_QUERY).matches);
}
