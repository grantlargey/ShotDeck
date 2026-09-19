/** Whether a keyboard event started in a text-entry control. */
export function isTypingTarget(target, { withinDialog = false } = {}) {
  if (!(target instanceof Element)) return false;
  const selector = withinDialog
    ? "input, textarea, select, [contenteditable='true'], [role='dialog']"
    : "input, textarea, select, [contenteditable='true']";
  return Boolean(target.closest(selector));
}
