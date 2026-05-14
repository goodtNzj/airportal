const WIDTHS = [85, 65, 95, 70, 80, 60, 90, 75];

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-slate-200 rounded"
          style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }}
        />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 animate-pulse">
      <div className="h-6 bg-slate-200 rounded w-1/3 mb-4" />
      <div className="space-y-2 mb-4">
        <div className="h-4 bg-slate-200 rounded w-full" />
        <div className="h-4 bg-slate-200 rounded w-2/3" />
      </div>
      <div className="h-10 bg-slate-200 rounded w-full" />
    </div>
  );
}
