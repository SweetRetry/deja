import { useEffect, useState } from "react";
import { fileUrl, thumbUrl } from "../lib/bridge";
import type { Entry, EntryMeta } from "../lib/types";
import { FolderOpenIcon, MagnifyingGlassPlusIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  entry: Entry | null;
  root: string;
  onMeta: (relPath: string, meta: EntryMeta) => void;
  onSimilar: (relPath: string) => void;
  onColor: (hex: string) => void;
  onReveal: (relPath: string) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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

/** Shares the 48px header line with the sidebar and the toolbar, and floats
 *  over the panel so its content scrolls under a blur instead of a line. */
function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 bg-sidebar/85 px-6 backdrop-blur"
    >
      {children}
    </div>
  );
}

export function Inspector({ entry, root, onMeta, onSimilar, onColor, onReveal }: Props) {
  const [draft, setDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    setDraft(entry?.note ?? "");
    setTagDraft("");
  }, [entry?.relPath, entry?.note]);

  useEffect(() => {
    if (!entry) return;
    if (draft === entry.note) return;
    const timer = setTimeout(() => {
      onMeta(entry.relPath, {
        tags: entry.tags,
        rating: entry.rating,
        note: draft,
        source: entry.source,
      });
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!entry) {
    return (
      <aside className="relative isolate flex h-full w-full flex-col pt-12">
        <Header>
          <h2 className="text-sm font-medium text-foreground">未选择素材</h2>
        </Header>
        <p className="px-6 text-xs text-muted-foreground">选择素材后，在此查看尺寸与主色，编辑标签、评分与备注。</p>
      </aside>
    );
  }

  const meta = (part: Partial<EntryMeta>) =>
    onMeta(entry.relPath, {
      tags: entry.tags,
      rating: entry.rating,
      note: entry.note,
      source: entry.source,
      ...part,
    });

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value || entry.tags.includes(value)) {
      setTagDraft("");
      return;
    }
    meta({ tags: [...entry.tags, value] });
    setTagDraft("");
  };

  const colorTotal = entry.colors.reduce((sum, color) => sum + color.share, 0) || 1;
  const folder = entry.relPath.includes("/") ? entry.relPath.slice(0, entry.relPath.lastIndexOf("/")) : "根目录";

  return (
    <aside className="relative isolate h-full w-full" aria-label="检视面板" data-entry={entry.relPath}>
      <Header>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={entry.name}>
          {entry.name}
        </h2>
        <span className="shrink-0 text-xs text-subtle-foreground">{entry.ext.toUpperCase()}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="在访达中显示"
                className="-mr-1.5"
                onClick={() => onReveal(entry.relPath)}
              />
            }
          >
            <FolderOpenIcon aria-hidden />
          </TooltipTrigger>
          <TooltipContent>在访达中显示 · {folder}</TooltipContent>
        </Tooltip>
      </Header>

      <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 pt-12 pb-6">
        <div className="flex flex-col gap-3">
          {/* A full-width tray keeps the picture's edges on the panel's column;
              it is only as tall as the picture needs, up to max-h-80. */}
          <div className="flex justify-center rounded-md bg-surface-1" data-testid="viewer">
            {entry.kind === "video" ? (
              <video
                src={fileUrl(root, entry)}
                controls
                width={entry.width ?? undefined}
                height={entry.height ?? undefined}
                className="block h-auto max-h-80 w-auto max-w-full rounded-md"
              />
            ) : (
              <img
                src={entry.indexed ? thumbUrl(entry) : fileUrl(root, entry)}
                alt={entry.name}
                width={entry.width ?? undefined}
                height={entry.height ?? undefined}
                className="block h-auto max-h-80 w-auto max-w-full rounded-md object-contain"
              />
            )}
          </div>
          <Button variant="secondary" className="w-full" onClick={() => onSimilar(entry.relPath)}>
            <MagnifyingGlassPlusIcon aria-hidden />
            查找相似素材
          </Button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">主色</h3>
          {entry.colors.length > 0 ? (
            <div className="flex h-6 overflow-hidden rounded-sm" role="group" aria-label="主色，点击按该色筛选">
              {entry.colors.map((color) => {
                const percent = Math.round((color.share / colorTotal) * 100);
                return (
                  <Tooltip key={color.hex}>
                    <TooltipTrigger
                      render={
                        <button
                          aria-label={`按主色 ${color.hex} 筛选`}
                          onClick={() => onColor(color.hex)}
                          className="h-full basis-0 bg-(--swatch) transition-opacity hover:opacity-80"
                          style={{ "--swatch": color.hex, flexGrow: color.share / colorTotal } as React.CSSProperties}
                        />
                      }
                    />
                    <TooltipContent>
                      <span className="font-mono">{color.hex}</span>
                      <span className="tabular-nums">{percent}%</span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : entry.indexed ? (
            <span className="text-xs text-subtle-foreground">—</span>
          ) : (
            <Skeleton className="h-6 w-full" />
          )}
        </section>

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
              <span className="-ml-1 flex" role="group" aria-label={entry.rating ? `${entry.rating} 星` : "未评分"}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    aria-label={`评为 ${value} 星`}
                    aria-pressed={entry.rating >= value}
                    onClick={() => meta({ rating: entry.rating === value ? 0 : value })}
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-sm transition-colors",
                      entry.rating >= value ? "text-foreground" : "text-subtle-foreground hover:text-muted-foreground",
                    )}
                  >
                    <StarIcon size={14} weight="fill" aria-hidden />
                  </button>
                ))}
              </span>
            </Property>
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">标签</h3>
          <div className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-muted p-1 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring-soft">
            {entry.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => meta({ tags: entry.tags.filter((value) => value !== tag) })}
                className="inline-flex h-6 items-center gap-1 rounded-xs bg-surface-2 pr-1 pl-2 text-xs text-foreground transition-colors hover:bg-surface-3"
                aria-label={`移除标签「${tag}」`}
              >
                {tag}
                <XIcon size={12} aria-hidden className="text-muted-foreground" />
              </button>
            ))}
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
                if (event.key === "Backspace" && !tagDraft && entry.tags.length > 0) {
                  meta({ tags: entry.tags.slice(0, -1) });
                }
              }}
              onBlur={addTag}
              placeholder={entry.tags.length ? "" : "输入标签后回车"}
              aria-label="添加标签"
              className="h-6 min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-subtle-foreground"
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">备注</h3>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="添加备注"
            aria-label="备注"
            rows={3}
            className="resize-none"
          />
          {entry.source ? (
            <p className="truncate text-xs text-subtle-foreground" title={entry.source}>
              来源 {entry.source}
            </p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
