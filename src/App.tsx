import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpenIcon } from "@phosphor-icons/react";
import { Grid } from "./components/Grid";
import { Inspector } from "./components/Inspector";
import { Sidebar } from "./components/Sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { DropImport } from "./components/DropImport";
import { Toaster } from "@/components/ui/sonner";
import { OpenFolder } from "./components/OpenFolder";
import { PaneResizer } from "./components/PaneResizer";
import { Toolbar } from "./components/Toolbar";
import { Settings } from "./components/Settings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS, emptyFilter, type Filter, type VaultView } from "./lib/types";
import { api, inTauri } from "./lib/bridge";
import { runSelfCheck } from "./lib/selfcheck";
import { THUMB_WIDTH, readView, useAppSettings, useTheme, writeView, type View } from "./lib/settings";
import { useVault } from "./lib/useVault";

/** Backend messages are English and internal; the UI says what to do next. */
function humanError(message: string): string {
  if (message.includes("is not a folder")) return "所选路径不是文件夹，请选择一个文件夹。";
  if (message.includes("path is required")) return "请输入文件夹路径。";
  if (message.includes("no vault open")) return "尚未打开素材文件夹。";
  if (message.includes("not an image or video")) return "拖入的内容里没有图片或视频。";
  if (message.includes("download failed")) return "图片下载失败，可先存到本地再拖进来。";
  if (message.includes("undo failed") || message.includes("was not imported here"))
    return "撤回失败，文件可能已被移动或删除。";
  if (message.toLowerCase().includes("model") || message.includes("sidecar"))
    return "语义模型启动失败，搜索仅匹配文件名、标签与备注。";
  return "操作未完成，请重试。";
}

/** The sidebar owns its trigger while open; once it is gone the toolbar takes
 *  over, leaving room for the desktop window's traffic lights. */
function CollapsedTrigger() {
  const { open } = useSidebar();
  if (open) return null;
  return (
    <div className={cn("flex shrink-0 items-center", inTauri && "pl-14")}>
      <SidebarTrigger aria-label="展开侧栏" />
    </div>
  );
}

const INSPECTOR_KEY = "shelf.inspector";
const INSPECTOR = { min: 280, max: 480, initial: 320 };

function readInspectorWidth(): number {
  const stored = Number(localStorage.getItem(INSPECTOR_KEY));
  return stored >= INSPECTOR.min && stored <= INSPECTOR.max ? stored : INSPECTOR.initial;
}

type EmptyReset = "search" | "filter" | "both";
type EmptyWall = { title: string; body: string; reset: EmptyReset | null };

const RESET_LABEL: Record<EmptyReset, string> = {
  search: "清除搜索",
  filter: "重置筛选",
  both: "清除搜索与筛选",
};

/** Says why the wall is empty for this exact combination of search and filters,
 *  and which single action brings results back. */
function emptyWall(query: string, filter: Filter, folderTotal: number): EmptyWall {
  const searching = query.length > 0;
  const kinds = filter.kinds.length > 0;
  const others = filter.minWidth > 0 || filter.minRating > 0;
  const color = filter.color !== "";
  const filtering = kinds || others || color;
  const restore = `重置筛选后显示全部 ${folderTotal} 项素材。`;

  if (searching && filtering) {
    return { title: "没有匹配的素材", body: "可换一种描述，或放宽筛选条件。", reset: "both" };
  }
  if (searching) {
    return { title: `没有匹配「${query}」的素材`, body: "可换一种描述重新搜索。", reset: "search" };
  }
  if (color && !kinds && !others) {
    const preset = COLOR_PRESETS.find((option) => option.hex.toLowerCase() === filter.color.toLowerCase());
    const name = preset ? `${preset.label}色` : "所选颜色";
    return {
      title: `没有以${name}为主色的素材`,
      body: `主色取每张图面积最大的几种颜色。${restore}`,
      reset: "filter",
    };
  }
  if (kinds && !others && !color) {
    const kind = filter.kinds[0] === "video" ? "视频" : "图片";
    return { title: `此文件夹中没有${kind}`, body: restore, reset: "filter" };
  }
  if (filtering) {
    return { title: "没有符合筛选条件的素材", body: restore, reset: "filter" };
  }
  return {
    title: "此文件夹中没有图片或视频",
    body: "放入图片或视频后，Shelf 自动生成预览并建立语义索引。",
    reset: null,
  };
}

export default function App() {
  const app = useAppSettings();
  const semanticEnabled = app.settings?.semantic ?? false;
  const state = useVault(semanticEnabled);
  const [view, setView] = useState<View>(readView);
  useTheme(view.theme);
  const [inspectorWidth, setInspectorWidth] = useState(readInspectorWidth);
  const vault: VaultView | null = state.vault;
  const selfChecked = useRef(false);

  // Only when the harness asks for it: prove the desktop build end to end.
  useEffect(() => {
    if (selfChecked.current) return;
    selfChecked.current = true;
    void runSelfCheck(state.openVault).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = { "": vault?.total ?? 0 };
    for (const entry of vault?.entries ?? []) {
      const parts = entry.relPath.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        const key = parts.slice(0, i).join("/");
        map[key] = (map[key] ?? 0) + 1;
      }
    }
    return map;
  }, [vault]);

  const empty = emptyWall(state.query.trim(), state.filter, counts[state.filter.folder] ?? 0);
  const rows = state.similarEntries ?? state.entries;

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": "13.5rem" } as React.CSSProperties}
      className="h-screen w-screen overflow-hidden bg-background text-foreground"
    >
      <Sidebar
        vault={vault}
        folder={state.filter.folder}
        onFolder={(rel) => state.setFilter({ ...state.filter, folder: rel })}
        counts={counts}
        progress={state.progress}
        paused={state.paused}
        onPause={state.setPaused}
        modelFailed={state.modelFailed}
        onRetryModel={() => void state.retrySemantic()}
        settings={
          <Settings
            view={view}
            onView={(next) => {
              setView(next);
              writeView(next);
            }}
            settings={app.settings}
            onSettings={(next) => void app.save(next)}
          />
        }
        onOpen={(path) => void state.openVault(path)}
      />

      <SidebarInset className="flex min-w-0 flex-row bg-background">
      <div
        className="relative isolate flex min-w-0 flex-1 flex-col"
        data-testid="center"
      >
        {/* Chrome the wall scrolls under: blur, not a line. */}
        <div className="absolute inset-x-0 top-0 z-20 bg-background/85 backdrop-blur">
        {state.similar ? (
          <div data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 px-6">
            <CollapsedTrigger />
            <h2 className="text-sm font-medium">相似素材</h2>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">按构图与画面内容的相似度排序</p>
            <Button variant="ghost" onClick={state.clearSimilar}>
              返回全部素材
            </Button>
          </div>
        ) : (
          <Toolbar
            leading={<CollapsedTrigger />}
            query={state.query}
            onQuery={state.setQuery}
            filter={state.filter}
            onFilter={state.setFilter}
            sort={state.sort}
            onSort={state.setSort}
            semantic={state.semantic}
            semanticMode={state.semanticMode}
            semanticAvailable={semanticEnabled}
            colorCounts={state.colorCounts}
            onSemanticMode={state.setSemanticMode}
          />
        )}
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col transition-opacity", state.pending && "opacity-60")}>
        <Grid
          entries={rows}
          scores={state.similarEntries ? {} : state.scores}
          cell={THUMB_WIDTH[view.size]}
          mode={view.layout}
          showNames={view.showNames}
          selected={state.selected}
          onSelect={state.setSelected}
          loading={state.opening}
          focus={state.focus}
          scrollKey={JSON.stringify([
            state.query.trim(),
            state.filter,
            state.sort,
            state.semanticMode,
            state.similar !== null,
          ])}
          emptyTitle={vault ? empty.title : "尚未打开素材文件夹"}
          emptyBody={vault ? empty.body : "文件保留在原位置，其中的图片与视频可按画面内容搜索。"}
          emptyAction={
            !vault ? (
              <OpenFolder variant="default" onOpen={(path) => void state.openVault(path)}>
                <FolderOpenIcon aria-hidden />
                打开文件夹
              </OpenFolder>
            ) : empty.reset ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (empty.reset !== "filter") state.setQuery("");
                  if (empty.reset !== "search") {
                    state.setFilter({ ...emptyFilter, folder: state.filter.folder, tag: state.filter.tag });
                  }
                }}
              >
                {RESET_LABEL[empty.reset]}
              </Button>
            ) : null
          }
        />
        </div>

        {state.error ? (
          <p className="bg-destructive-soft px-6 py-2 text-xs text-destructive" role="alert">
            {humanError(state.error)}
          </p>
        ) : null}
      </div>

      <div
        className="relative isolate shrink-0 bg-sidebar"
        style={{ width: inspectorWidth }}
        data-testid="inspector"
      >
        <Inspector
          entry={state.selectedEntry}
          root={vault?.root ?? ""}
          onMeta={(relPath, meta) => void state.saveMeta(relPath, meta)}
          onSimilar={(relPath) => void state.findSimilar(relPath)}
          onColor={(hex) => {
            state.clearSimilar();
            state.setFilter({ ...state.filter, color: hex });
          }}
          onReveal={(relPath) => void api.reveal(relPath).catch(() => undefined)}
        />
        <PaneResizer
          label="调整检视面板宽度"
          width={inspectorWidth}
          {...INSPECTOR}
          onWidth={(width, commit) => {
            setInspectorWidth(width);
            if (commit) localStorage.setItem(INSPECTOR_KEY, String(width));
          }}
        />
      </div>
      </SidebarInset>

      <DropImport
        target={vault ? (state.filter.folder.split("/").pop() || vault.root.split("/").pop() || vault.root) : null}
        onDrop={async (items) => {
          const result = await state.importDrop(items);
          return "error" in result ? { error: humanError(result.error) } : result;
        }}
        onLocate={state.locate}
        onUndo={async (relPaths) => {
          const result = await state.undoImport(relPaths);
          return result ? humanError(result.error) : null;
        }}
      />
      <Toaster theme={view.theme} position="bottom-center" />
    </SidebarProvider>
  );
}
