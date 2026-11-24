export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shimmer rounded-[var(--radius-sm)] ${className}`}
    />
  );
}

export function WorkspaceSkeletonFrame({
  children,
  maxWidthClassName = "max-w-[1120px]",
}: {
  children: React.ReactNode;
  maxWidthClassName?: string;
}) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--neutral-50)]">
      {/* Desktop sidebar placeholder */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[244px] lg:shrink-0 border-r border-[var(--neutral-200)] bg-white p-4 space-y-6">
        <div className="h-9 flex items-center px-1">
          <Skeleton className="w-20 h-5" />
        </div>
        <Skeleton className="w-full h-10" />
        <div className="space-y-2 pt-2">
          <Skeleton className="w-16 h-3" />
          <Skeleton className="w-full h-9" />
          <Skeleton className="w-full h-9" />
          <Skeleton className="w-full h-9" />
        </div>
        <div className="space-y-2 pt-2">
          <Skeleton className="w-14 h-3" />
          <Skeleton className="w-full h-9" />
          <Skeleton className="w-full h-9" />
        </div>
        <div className="mt-auto pt-4 border-t border-[var(--neutral-200)] space-y-3">
          <Skeleton className="w-full h-14" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-8 h-8 rounded-full" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="w-24 h-3" />
              <Skeleton className="w-32 h-2.5" />
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile header placeholder */}
      <div className="lg:hidden h-14 px-4 bg-white border-b border-[var(--neutral-200)] flex items-center justify-between">
        <Skeleton className="w-16 h-5" />
        <Skeleton className="w-20 h-8" />
      </div>

      {/* Main canvas */}
      <main className="flex-1 min-w-0" aria-busy="true" aria-label="Loading page">
        <div className={`mx-auto w-full ${maxWidthClassName} px-4 sm:px-6 lg:px-8 py-7 sm:py-9`}>
          {children}
        </div>
      </main>
    </div>
  );
}

export function LedgerRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--neutral-200)] flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="w-16 h-5" />
          <Skeleton className="w-16 h-5" />
          <Skeleton className="w-20 h-5" />
        </div>
        <Skeleton className="w-48 h-9 hidden sm:block" />
      </div>
      <div className="divide-y divide-[var(--neutral-200)]">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="space-y-2 flex-1 max-w-[420px]">
              <Skeleton className="w-3/4 h-4" />
              <Skeleton className="w-1/2 h-3" />
            </div>
            <Skeleton className="w-28 h-4 hidden md:block" />
            <Skeleton className="w-24 h-8" />
          </div>
        ))}
      </div>
    </div>
  );
}
