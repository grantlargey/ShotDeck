export function getCurrentScript(scripts) {
  return Array.isArray(scripts) ? scripts[0] || null : null;
}
