import { getTimelinePositionPercent } from "@/entities/annotation";
import { formatSecondsToHms } from "@/shared/lib/time";

export function AnnotationTimeline({ annotations, onSelect, runtimeSeconds, selectedIndex }) {
  return (
    <div
      style={{
        position: "relative",
        height: 20,
        background: "#ccc",
        borderRadius: 10,
        margin: "1rem 0 2rem",
      }}
    >
      {annotations.map((annotation, idx) => {
        const pct = getTimelinePositionPercent(annotation, runtimeSeconds);

        return (
          <div
            key={annotation.id}
            title={formatSecondsToHms(annotation.time_seconds)}
            onClick={() => onSelect(idx)}
            style={{
              position: "absolute",
              left: `${pct}%`,
              top: -10,
              transform: "translateX(-50%)",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 6,
                height: 20,
                background: idx === selectedIndex ? "#111" : "blue",
                borderRadius: 2,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
