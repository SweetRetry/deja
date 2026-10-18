// Why an open folder's wall has nothing to show, and the one verb that brings
// results back. With no folder open the welcome table stands in instead.
// Pure so the wording can be asserted without rendering.
import type { Filter } from "../../lib/types.ts";
import { colorName, narrowing } from "./filter.ts";

export type EmptyAction = "clear-search" | "clear-filters" | "clear-both";

export type EmptyState = { title: string; body: string; action: EmptyAction | null };

export type EmptyInput = {
  query: string;
  filter: Filter;
  /** Files in the scoped folder before any search or filter. */
  folderTotal: number;
  /** The lens the wall shows instead of the search, if any. Its bar already
   *  leads back, so its empty state offers no verb of its own. */
  lens?: "similar" | "duplicates" | null;
  /** Every file in the vault, which the duplicates lens compares. */
  vaultTotal?: number;
};

export function emptyState({ query, filter, folderTotal, lens, vaultTotal = 0 }: EmptyInput): EmptyState {
  if (lens === "duplicates") {
    return { title: "没有重复的素材", body: `比对了全部 ${vaultTotal} 项素材，没有内容相同或相近的副本。`, action: null };
  }
  if (lens === "similar") {
    return { title: "没有相似的素材", body: "这张素材在库里没有画面相近的。", action: null };
  }
  const text = query.trim();
  const { kind, rating, color, width } = narrowing(filter);
  const others = rating > 0 || width > 0;
  const filtering = kind !== "" || others || color !== "";
  const restore = `重置筛选后显示全部 ${folderTotal} 项素材。`;

  if (text && filtering) {
    return { title: "没有匹配的素材", body: "可换一种描述，或放宽筛选条件。", action: "clear-both" };
  }
  if (text) {
    return { title: `没有匹配「${text}」的素材`, body: "可换一种描述重新搜索。", action: "clear-search" };
  }
  if (color && !kind && !others) {
    const name = colorName(color);
    return {
      title: `没有以${name ? `${name}色` : "所选颜色"}为主色的素材`,
      body: `主色取每张图面积最大的几种颜色。${restore}`,
      action: "clear-filters",
    };
  }
  if (kind && !others && !color) {
    return { title: `此文件夹中没有${kind === "video" ? "视频" : "图片"}`, body: restore, action: "clear-filters" };
  }
  if (filtering) {
    return { title: "没有符合筛选条件的素材", body: restore, action: "clear-filters" };
  }
  return {
    title: "此文件夹中没有图片或视频",
    body: "放入图片或视频后，Déjà 自动生成预览并建立语义索引。",
    action: null,
  };
}
