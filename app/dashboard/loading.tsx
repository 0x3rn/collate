import { LedgerRowsSkeleton, Skeleton, WorkspaceSkeletonFrame } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <WorkspaceSkeletonFrame>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[var(--neutral-200)]">
          <div className="space-y-2">
            <Skeleton className="w-56 h-8" />
            <Skeleton className="w-80 max-w-full h-4" />
          </div>
          <Skeleton className="w-48 h-4" />
        </div>

        {/* Quick-Start Workbench skeleton */}
        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="px-6 py-3 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] flex items-center justify-between">
            <Skeleton className="w-72 h-8" />
            <Skeleton className="w-28 h-4 hidden sm:block" />
          </div>
          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <Skeleton className="w-48 h-6" />
              <Skeleton className="w-96 max-w-full h-4" />
            </div>
            <Skeleton className="w-full h-14" />
            <div className="flex items-center justify-between">
              <Skeleton className="w-56 h-3.5" />
              <Skeleton className="w-28 h-3.5" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <LedgerRowsSkeleton rows={3} />
          </div>
          <div className="lg:col-span-4 space-y-5">
            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-4">
              <Skeleton className="w-32 h-4" />
              <Skeleton className="w-full h-2" />
              <Skeleton className="w-48 h-3" />
            </div>
            <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-3">
              <Skeleton className="w-28 h-4" />
              <Skeleton className="w-full h-10" />
              <Skeleton className="w-full h-10" />
            </div>
          </div>
        </div>
      </div>
    </WorkspaceSkeletonFrame>
  );
}
