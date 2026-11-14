export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="skeleton mb-3 h-4 w-40" />
      <div className="skeleton mb-8 h-9 w-72" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-28" />
        ))}
      </div>
      <div className="skeleton mt-8 h-72" />
    </div>
  );
}
