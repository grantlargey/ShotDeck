import { formatMinutesToHms } from "@/shared/lib/time";

export function MovieReadOnlyDetails({ movie }) {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        <strong>Director:</strong> {movie.director}
      </p>
      <p>
        <strong>Runtime:</strong> {formatMinutesToHms(movie.runtime_minutes)}
      </p>
    </>
  );
}
