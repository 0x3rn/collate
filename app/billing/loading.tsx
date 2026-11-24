import { LedgerRowsSkeleton, Skeleton, WorkspaceSkeletonFrame } from "@/components/ui/skeleton";

export default function BillingLoading() {
  return (
    <WorkspaceSkeletonFrame maxWidthClassName="max-w-[980px]">
      <div className="space-y-6">
        <div className="space-y-2 pb-5 border-b border-[var(--neutral-200)]">
          <Skeleton className="w-48 h-8" />
          <Skeleton className="w-96 max-w-full h-4" />
        </div>

        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--neutral-200)]">
          <div className="p-6 space-y-2">
            <Skeleton className="w-24 h-3.5" />
            <Skeleton className="w-36 h-7" />
            <Skeleton className="w-56 h-3" />
          </div>
          <div className="p-6 space-y-2.5">
            <Skeleton className="w-40 h-3.5" />
            <Skeleton className="w-full h-2" />
            <Skeleton className="w-52 h-3" />
          </div>
        </div>

        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--neutral-200)]">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="p-6 space-y-4">
              <Skeleton className="w-28 h-4" />
              <Skeleton className="w-24 h-8" />
              <Skeleton className="w-full h-10" />
              <Skeleton className="w-full h-10" />
            </div>
          ))}
        </div>

        <LedgerRowsSkeleton rows={3} />
      </div>
    </WorkspaceSkeletonFrame>
  );
}
