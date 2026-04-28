export function MovieTitleBlock({ coverUrl, movie }) {
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>
          {movie.title} <span style={{ color: "#666" }}>({movie.year})</span>
        </h2>
      </div>

      {coverUrl && (
        <img
          src={coverUrl}
          alt="Cover"
          style={{
            maxWidth: 260,
            display: "block",
            marginTop: 10,
            marginBottom: "1.25rem",
          }}
        />
      )}
    </>
  );
}
