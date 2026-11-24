import { Skeleton, WorkspaceSkeletonFrame } from "@/components/ui/skeleton";

export default function AccountLoading() {
  return (
    <WorkspaceSkeletonFrame maxWidthClassName="max-w-[980px]">
      <div className="space-y-2">
        <div className="space-y-2 pb-6 border-b border-[var(--neutral-200)]">
          <Skeleton className="w-32 h-8" />
          <Skeleton className="w-72 max-w-full h-4" />
        </div>

        <div className="divide-y divide-[var(--neutral-200)]">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="py-7 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 space-y-2">
                <Skeleton className="w-28 h-5" />
                <Skeleton className="w-48 h-3.5" />
              </div>
              <div className="lg:col-span-8 bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 space-y-4">
                <Skeleton className="w-44 h-4" />
                <Skeleton className="w-64 h-4" />
                <Skeleton className="w-36 h-4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceSkeletonFrame>
  );
}
