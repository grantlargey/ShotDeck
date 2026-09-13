const platform =
  typeof navigator === "undefined" ? "" : navigator.userAgentData?.platform || navigator.platform || "";

const IS_APPLE = /mac|iphone|ipad/i.test(platform);

export function undoShortcutLabel() {
  return IS_APPLE ? "⌘Z" : "Ctrl+Z";
}

/**
 * Element-type shortcuts use Option/Alt with Cmd/Ctrl: browsers reserve
 * Cmd/Ctrl+digit for switching tabs.
 */
export function elementShortcutLabel(digits) {
  return IS_APPLE ? `⌥⌘${digits}` : `Ctrl+Alt+${digits}`;
}
