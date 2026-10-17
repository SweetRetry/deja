import { Skeleton } from "@/components/ui/skeleton";
import type { Entry } from "@/lib/types";
import { formatBytes, formatDate } from "./format";
import { Rating } from "./Rating";

/** Values sit on a 24px line so text and the star row share one baseline. */
function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-subtle-foreground">{label}</dt>
      <dd className="flex h-6 min-w-0 items-center text-sm tabular-nums text-foreground">
        {typeof children === "string" ? <span className="truncate">{children}</span> : children}
      </dd>
    </div>
  );
}

export function Properties({ entry }: { entry: Entry }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Property label="尺寸">
        {entry.width && entry.height ? (
          `${entry.width} × ${entry.height}`
        ) : entry.indexed ? (
          "—"
        ) : (
          <Skeleton className="h-5 w-20" />
        )}
      </Property>
      <Property label="大小">{formatBytes(entry.sizeBytes)}</Property>
      <Property label="修改时间">{formatDate(entry.modified)}</Property>
      <Property label="评分">
        <Rating relPath={entry.relPath} />
      </Property>
    </dl>
  );
}
