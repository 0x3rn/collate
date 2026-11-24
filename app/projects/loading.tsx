import { LedgerRowsSkeleton, Skeleton, WorkspaceSkeletonFrame } from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <WorkspaceSkeletonFrame>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="w-36 h-8" />
            <Skeleton className="w-72 max-w-full h-4" />
          </div>
          <Skeleton className="w-40 h-10" />
        </div>
        <LedgerRowsSkeleton rows={5} />
      </div>
    </WorkspaceSkeletonFrame>
  );
}
