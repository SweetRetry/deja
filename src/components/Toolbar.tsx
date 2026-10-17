import { CaretRightIcon, FunnelSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS, type Filter } from "@/lib/types";

type Props = {
  leading?: React.ReactNode;
  query: string;
  onQuery: (value: string) => void;
  filter: Filter;
  onFilter: (next: Filter) => void;
  sort: string;
  onSort: (value: string) => void;
  semantic: boolean;
  semanticMode: boolean;
  /** False when the user turned semantic search off in settings. */
  semanticAvailable: boolean;
  onSemanticMode: (value: boolean) => void;
  colorCounts: number[];
};

const KINDS = [
  { label: "全部", value: "" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
];

const RATINGS = [
  { label: "不限", value: 0 },
  { label: "3 星+", value: 3 },
  { label: "4 星+", value: 4 },
  { label: "5 星", value: 5 },
];

const SORTS = [
  { label: "名称", value: "name" },
  { label: "修改时间", value: "modified" },
  { label: "大小", value: "size" },
  { label: "评分", value: "rating" },
];

// A query is ranked by relevance and the static sort no longer applies, so the
// same slot switches what relevance means.
const RANKINGS = [
  { label: "语义", value: true, hint: "按画面内容匹配，并合并文件名、标签与备注的匹配结果" },
  { label: "关键词", value: false, hint: "仅匹配文件名、标签与备注" },
];

/** Where the wall is scoped: the vault root, then each folder down to the
 *  current one. Ancestors navigate up; the last crumb is the current view. */
function Breadcrumb({ folder, onFolder }: { folder: string; onFolder: (rel: string) => void }) {
  const parts = folder ? folder.split("/") : [];
  const crumbs = [{ rel: "", name: "全部素材" }, ...parts.map((name, i) => ({ rel: parts.slice(0, i + 1).join("/"), name }))];
  return (
    <nav data-tauri-drag-region aria-label="当前位置" className="min-w-0 flex-1">
      <ol data-tauri-drag-region className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={crumb.rel} className={cn("flex min-w-0 items-center gap-1", last ? "shrink" : "shrink-[2]")}>
              {i > 0 ? <CaretRightIcon size={12} aria-hidden className="shrink-0 text-subtle-foreground" /> : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onFolder(crumb.rel)}
                  className="truncate rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** An active filter, removable in place without reopening the panel. */
function FilterChip({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onRemove}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-surface-2 pr-2 pl-2.5 text-sm text-foreground transition-colors hover:bg-surface-3"
    >
      {children}
      <XIcon size={12} aria-hidden className="text-muted-foreground" />
    </button>
  );
}

export function Toolbar({
  leading,
  query,
  onQuery,
  filter,
  onFilter,
  sort,
  onSort,
  semantic,
  semanticMode,
  semanticAvailable,
  onSemanticMode,
  colorCounts,
}: Props) {
  const patch = (part: Partial<Filter>) => onFilter({ ...filter, ...part });
  const kind = filter.kinds[0] ?? "";
  const kindLabel = KINDS.find((option) => option.value === kind)?.label ?? kind;
  const active = (kind ? 1 : 0) + (filter.minRating > 0 ? 1 : 0) + (filter.color !== "" ? 1 : 0);
  const searching = query.trim().length > 0;

  return (
    <div
      data-tauri-drag-region
      data-semantic={semantic ? "true" : "false"}
      className="flex h-12 shrink-0 items-center gap-2 px-6"
    >
      {leading}
      <Breadcrumb folder={filter.folder} onFolder={(rel) => patch({ folder: rel })} />
      {kind ? (
        <FilterChip label={`移除筛选：${kindLabel}`} onRemove={() => patch({ kinds: [] })}>
          {kindLabel}
        </FilterChip>
      ) : null}
      {filter.minRating > 0 ? (
        <FilterChip label={`移除筛选：${filter.minRating} 星及以上`} onRemove={() => patch({ minRating: 0 })}>
          <span className="tabular-nums">{filter.minRating === 5 ? "5 星" : `${filter.minRating} 星+`}</span>
        </FilterChip>
      ) : null}
      {filter.color ? (
        <FilterChip label="移除筛选：主色" onRemove={() => patch({ color: "" })}>
          <span
            className="size-3 rounded-full border border-border bg-(--swatch)"
            style={{ "--swatch": filter.color } as React.CSSProperties}
          />
          主色
        </FilterChip>
      ) : null}
      <div className="relative w-72 min-w-40 shrink">
        <MagnifyingGlassIcon
          size={15}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle-foreground"
        />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="按画面、文件名或标签搜索"
          aria-label="搜索素材"
          className={cn("pl-8", query && "pr-8")}
        />
        {query ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="清除搜索"
            onClick={() => onQuery("")}
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>

      <Popover>
        <PopoverTrigger render={<Button variant="ghost" />}>
          <FunnelSimpleIcon aria-hidden />
          筛选
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-80 flex-col gap-4">
          <Field label="类型">
            <Segmented
              label="类型"
              options={KINDS}
              value={kind}
              onChange={(value) => patch({ kinds: value ? [value] : [] })}
              className="w-full"
            />
          </Field>
          <Field label="最低评分">
            <Segmented
              label="最低评分"
              options={RATINGS}
              value={filter.minRating}
              onChange={(value) => patch({ minRating: value })}
              className="w-full"
            />
          </Field>
          <Field label="主色">
            <div className="grid w-fit grid-cols-6 gap-2" role="group" aria-label="主色">
              {COLOR_PRESETS.map((preset, index) => {
                const pressed = filter.color.toLowerCase() === preset.hex.toLowerCase();
                const count = colorCounts[index];
                return (
                  <button
                    key={preset.hex}
                    title={count === undefined ? preset.label : `${preset.label} · ${count} 个`}
                    aria-label={count === undefined ? `主色 ${preset.label}` : `主色 ${preset.label}，${count} 个`}
                    aria-pressed={pressed}
                    onClick={() => patch({ color: pressed ? "" : preset.hex })}
                    className={cn(
                      "size-7 rounded-full border bg-(--swatch) transition-colors",
                      pressed ? "border-ring ring-2 ring-ring-soft" : "border-border hover:border-ring",
                    )}
                    style={{ "--swatch": preset.hex } as React.CSSProperties}
                  />
                );
              })}
            </div>
          </Field>
          {searching ? (
            semanticAvailable ? (
              <Field label="搜索方式">
                <Segmented
                  label="搜索方式"
                  options={RANKINGS}
                  value={semanticMode}
                  onChange={onSemanticMode}
                  className="w-full"
                />
              </Field>
            ) : null
          ) : (
            <Field label="排序">
              <Segmented label="排序" options={SORTS} value={sort} onChange={onSort} className="w-full" />
            </Field>
          )}
          {active > 0 ? (
            <Button
              variant="ghost"
              className="-ml-3 w-fit"
              onClick={() => patch({ kinds: [], minRating: 0, color: "" })}
            >
              重置筛选
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>

    </div>
  );
}
