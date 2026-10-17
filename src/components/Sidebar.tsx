import { useMemo } from "react";
import { CaretUpDownIcon, FolderSimpleIcon, ImagesIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarShell,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { OpenFolder } from "./OpenFolder";
import { StatusDot } from "./status-dot";
import type { IndexProgress, VaultView } from "@/lib/types";

type FolderNode = { rel: string; name: string; depth: number };

/** Physical folders only; the vault root is the "全部素材" view above them. */
function folderTree(folders: string[]): FolderNode[] {
  return folders
    .filter((rel) => rel !== "")
    .map((rel) => ({
      rel,
      name: rel.split("/").slice(-1)[0] ?? rel,
      depth: rel.split("/").length - 1,
    }));
}

function statusLine(indexed: number, embedded: number, total: number, modelReady: boolean, paused: boolean): string {
  if (paused) return "索引已暂停";
  if (indexed < total) return `生成预览 ${indexed}/${total}`;
  if (embedded < total) return modelReady ? `建立语义索引 ${embedded}/${total}` : "启动语义模型";
  return "索引已完成";
}

type Props = {
  vault: VaultView | null;
  folder: string;
  onFolder: (rel: string) => void;
  counts: Record<string, number>;
  progress: IndexProgress | null;
  paused: boolean;
  onPause: (paused: boolean) => void;
  onOpen: (path: string) => void;
  modelFailed: boolean;
  onRetryModel: () => void;
  /** The settings control, rendered at the end of the status line. */
  settings: React.ReactNode;
};

export function Sidebar({
  vault,
  folder,
  onFolder,
  counts,
  progress,
  paused,
  onPause,
  onOpen,
  modelFailed,
  onRetryModel,
  settings,
}: Props) {
  const tree = useMemo(() => folderTree(vault?.folders ?? []), [vault?.folders]);
  const indexed = progress?.indexed ?? vault?.indexed ?? 0;
  const embedded = progress?.embedded ?? vault?.embedded ?? 0;
  const total = progress?.total ?? vault?.total ?? 0;
  const modelReady = progress?.modelReady ?? vault?.model.ready ?? false;
  const done = indexed === total && embedded === total;
  const vaultName = vault ? (vault.root.split("/").slice(-1)[0] ?? vault.root) : "";
  const pauseLabel = paused ? "继续索引" : "暂停索引";

  return (
    <SidebarShell collapsible="offcanvas">
      {/* Shares the 48px header line with the toolbar and the inspector; the
          desktop window's traffic lights sit in its left inset. */}
      <div
        data-tauri-drag-region
        className={cn("flex h-12 shrink-0 items-center justify-end px-2", inTauri && "pl-20")}
      >
        <SidebarTrigger aria-label="收起侧栏" />
      </div>

      {vault ? (
        <SidebarHeader className="px-2 pt-0 pb-2">
          <OpenFolder
            variant="ghost"
            onOpen={onOpen}
            aria-label={`更换文件夹，当前为 ${vaultName}`}
            title={vault.root}
            className="w-full justify-between px-2 text-foreground"
          >
            <span className="truncate">{vaultName}</span>
            <CaretUpDownIcon aria-hidden className="text-muted-foreground" />
          </OpenFolder>
        </SidebarHeader>
      ) : null}

      <SidebarContent>
        {vault ? (
          <>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={folder === ""} onClick={() => onFolder("")}>
                    <ImagesIcon aria-hidden />
                    <span className="truncate">全部素材</span>
                    <span className="ml-auto tabular-nums text-xs text-subtle-foreground">{counts[""] ?? 0}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            {tree.length > 0 ? (
              <SidebarGroup>
                <SidebarGroupLabel>文件夹</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {tree.map((row) => (
                      <SidebarMenuItem key={row.rel}>
                        <SidebarMenuButton
                          isActive={folder === row.rel}
                          onClick={() => onFolder(row.rel)}
                          tooltip={row.name}
                          style={{ paddingLeft: 8 + row.depth * 16 }}
                        >
                          <FolderSimpleIcon aria-hidden />
                          <span className="truncate">{row.name}</span>
                          <span className="ml-auto tabular-nums text-xs text-subtle-foreground">
                            {counts[row.rel] ?? 0}
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}
          </>
        ) : null}
      </SidebarContent>

      {vault ? (
        <SidebarFooter className="gap-1 px-4 pb-3">
          <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
            <StatusDot tone={paused ? "warning" : done ? "success" : "muted"} />
            <span className="min-w-0 flex-1 truncate tabular-nums" data-testid="index-status">
              {statusLine(indexed, embedded, total, modelReady, paused)}
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={pauseLabel} onClick={() => onPause(!paused)} />
                }
              >
                {paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
              </TooltipTrigger>
              <TooltipContent>{pauseLabel}</TooltipContent>
            </Tooltip>
            {settings}
          </div>
          {modelFailed ? (
            <div className="flex flex-col items-start gap-1">
              <p className="text-xs text-muted-foreground">语义模型启动失败，搜索仅匹配文件名、标签与备注。</p>
              <Button variant="ghost" size="sm" className="-ml-2" onClick={onRetryModel}>
                重新启动模型
              </Button>
            </div>
          ) : !modelReady && embedded < total ? (
            <p className="text-xs text-subtle-foreground">语义模型就绪前，搜索仅匹配文件名、标签与备注。</p>
          ) : null}
        </SidebarFooter>
      ) : null}
    </SidebarShell>
  );
}
