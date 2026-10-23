import { useLayoutEffect, useRef } from "react";
import { colorChannels, duotoneMatrix } from "../lib/duotone.js";

// The page styles whose pages are recolored; white shows the PDF as it was made.
const RECOLORED_STYLES = ["cream", "midnight"];
const IDENTITY = "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0";

/**
 * The filters --script-page-filter points at, one per recolored page style,
 * made from that style's --color-paper and --color-ink tokens once the probes
 * carrying each style can be read. Rendered once by the script viewer; it
 * draws nothing.
 */
export function ScriptPageFilters({ className }) {
  const probesRef = useRef(null);
  const matricesRef = useRef(null);

  useLayoutEffect(() => {
    const probes = probesRef.current?.children ?? [];
    const matrices = matricesRef.current?.querySelectorAll("feColorMatrix") ?? [];
    RECOLORED_STYLES.forEach((style, index) => {
      if (!probes[index] || !matrices[index]) return;
      const computed = window.getComputedStyle(probes[index]);
      const ink = colorChannels(computed.getPropertyValue("--color-ink"));
      const paper = colorChannels(computed.getPropertyValue("--color-paper"));
      if (ink && paper) matrices[index].setAttribute("values", duotoneMatrix(ink, paper));
    });
  }, []);

  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <defs ref={matricesRef}>
        {RECOLORED_STYLES.map((style) => (
          <filter key={style} id={`script-page-${style}`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={IDENTITY} />
          </filter>
        ))}
      </defs>
      <g ref={probesRef}>
        {RECOLORED_STYLES.map((style) => (
          <g key={style} data-scene-text-style={style} />
        ))}
      </g>
    </svg>
  );
}
