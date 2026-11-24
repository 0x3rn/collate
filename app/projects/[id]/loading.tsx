import { LedgerRowsSkeleton, Skeleton, WorkspaceSkeletonFrame } from "@/components/ui/skeleton";

export default function ProjectDetailLoading() {
  return (
    <WorkspaceSkeletonFrame maxWidthClassName="max-w-[960px]">
      <div className="space-y-6">
        <div className="space-y-2 pb-5 border-b border-[var(--neutral-200)]">
          <Skeleton className="w-28 h-4" />
          <Skeleton className="w-96 max-w-full h-8" />
          <Skeleton className="w-56 h-4" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="w-full h-24" />
          <Skeleton className="w-full h-24" />
        </div>
        <LedgerRowsSkeleton rows={5} />
      </div>
    </WorkspaceSkeletonFrame>
  );
}
