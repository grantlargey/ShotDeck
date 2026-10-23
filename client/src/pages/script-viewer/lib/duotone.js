// How much red, green and blue each count toward a pixel's lightness.
const LUMINANCE = [0.2126, 0.7152, 0.0722];

/** A CSS color written as #rrggbb or rgb(), as red, green and blue from 0 to 1; null for anything else. */
export function colorChannels(color) {
  const text = String(color ?? "").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16) / 255);
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
  return rgb ? rgb.slice(1, 4).map((value) => Number(value) / 255) : null;
}

/**
 * An feColorMatrix's values that paint black as `ink` and white as `paper`,
 * and every pixel between them by its lightness, so a black-on-white page
 * takes on a style's paper and ink, light on dark included.
 */
export function duotoneMatrix(ink, paper) {
  const rows = ink.map((inkChannel, channel) => {
    const span = paper[channel] - inkChannel;
    return [...LUMINANCE.map((weight) => span * weight), 0, inkChannel];
  });
  return [...rows.flat(), 0, 0, 0, 1, 0].map((value) => Math.round(value * 10000) / 10000).join(" ");
}
