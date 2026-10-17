import { FunnelSimpleIcon } from "@phosphor-icons/react";
import { useSemanticEnabled } from "@/app/selectors";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { COLOR_PRESETS, type Ranking, type Sort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { clearFilters, patchFilter, setRanking, setSort } from "./commands";
import { isFiltering, narrowing } from "./filter";

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

const SORTS: { label: string; value: Sort }[] = [
  { label: "名称", value: "name" },
  { label: "修改时间", value: "modified" },
  { label: "大小", value: "size" },
  { label: "评分", value: "rating" },
];

// A query is ranked by relevance and the static sort no longer applies, so the
// same slot switches what relevance means.
const RANKINGS: { label: string; value: Ranking; hint: string }[] = [
  { label: "语义", value: "semantic", hint: "按画面内容匹配，并合并文件名、标签与备注的匹配结果" },
  { label: "关键词", value: "keyword", hint: "仅匹配文件名、标签与备注" },
];

export function FilterMenu() {
  const filter = useSession((s) => s.browse.filter);
  const sort = useSession((s) => s.browse.sort);
  const ranking = useSession((s) => s.browse.ranking);
  const colorCounts = useSession((s) => s.browse.results.colorCounts);
  const searching = useSession((s) => s.browse.query.trim() !== "");
  const semanticEnabled = useSemanticEnabled();
  const { kind, color } = narrowing(filter);

  return (
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
            onChange={(value) => patchFilter({ kinds: value ? [value] : [] })}
            className="w-full"
          />
        </Field>
        <Field label="最低评分">
          <Segmented
            label="最低评分"
            options={RATINGS}
            value={filter.minRating}
            onChange={(value) => patchFilter({ minRating: value })}
            className="w-full"
          />
        </Field>
        <Field label="主色">
          <div className="grid w-fit grid-cols-6 gap-2" role="group" aria-label="主色">
            {COLOR_PRESETS.map((preset, index) => {
              const pressed = color.toLowerCase() === preset.hex.toLowerCase();
              const count = colorCounts[index];
              return (
                <button
                  key={preset.hex}
                  type="button"
                  title={count === undefined ? preset.label : `${preset.label} · ${count} 个`}
                  aria-label={count === undefined ? `主色 ${preset.label}` : `主色 ${preset.label}，${count} 个`}
                  aria-pressed={pressed}
                  onClick={() => patchFilter({ color: pressed ? "" : preset.hex })}
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
          semanticEnabled ? (
            <Field label="搜索方式">
              <Segmented label="搜索方式" options={RANKINGS} value={ranking} onChange={setRanking} className="w-full" />
            </Field>
          ) : null
        ) : (
          <Field label="排序">
            <Segmented label="排序" options={SORTS} value={sort} onChange={setSort} className="w-full" />
          </Field>
        )}
        {isFiltering(filter) ? (
          <Button variant="ghost" className="-ml-3 w-fit" onClick={clearFilters}>
            重置筛选
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
