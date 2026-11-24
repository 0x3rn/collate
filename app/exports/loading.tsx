import { LedgerRowsSkeleton, Skeleton, WorkspaceSkeletonFrame } from "@/components/ui/skeleton";

export default function ExportsLoading() {
  return (
    <WorkspaceSkeletonFrame>
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="w-32 h-8" />
          <Skeleton className="w-80 max-w-full h-4" />
        </div>
        <LedgerRowsSkeleton rows={4} />
      </div>
    </WorkspaceSkeletonFrame>
  );
}
