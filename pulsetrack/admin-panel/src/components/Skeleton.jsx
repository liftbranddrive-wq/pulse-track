export function CardSkeleton({ lines = 3 }) {
  return (
    <div className="animate-pulse rounded-xl2 border border-line bg-surface p-5 shadow-soft">
      <div className="h-5 w-1/3 rounded-lg bg-black/10" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 w-full rounded bg-black/[0.08]" />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl2 border border-line bg-surface">
      <div
        className="grid gap-2 border-b border-line bg-page/60 p-3"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-black/10" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-2 border-b border-line/70 p-3"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="h-3 rounded bg-black/[0.06]" />
          ))}
        </div>
      ))}
    </div>
  );
}
