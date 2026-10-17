import type { ReactNode } from "react";
import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { RollingNumber } from "@/components/ui/rolling-number";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPaused, warmModel } from "@/features/vault/commands";
import { indexStatus } from "./index-status";

/** The footer's status line. `children` sit at its end (the settings control). */
export function IndexStatus({ children }: { children?: ReactNode }) {
  const vault = useSession(
    useShallow((s) => ({
      phase: s.vault.phase,
      progress: s.vault.progress,
      model: s.vault.model,
      settings: s.vault.settings,
    })),
  );
  const status = indexStatus(vault);
  if (!status) return null;

  const pauseLabel = status.paused ? "继续索引" : "暂停索引";

  return (
    <>
      <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
        <StatusDot tone={status.tone} />
        <span className="min-w-0 flex-1 truncate" data-testid="index-status">
          {status.label}
          {status.count ? (
            <>
              {" "}
              <RollingNumber value={status.count.done} />/{status.count.total}
            </>
          ) : null}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={pauseLabel}
                disabled={!status.pausable}
                onClick={() => setPaused(!status.paused)}
              />
            }
          >
            {status.paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
          </TooltipTrigger>
          <TooltipContent>{pauseLabel}</TooltipContent>
        </Tooltip>
        {children}
      </div>
      {status.notice ? (
        <div className="flex flex-col items-start gap-1">
          <p className="text-xs text-muted-foreground">{status.notice.text}</p>
          {status.notice.retry ? (
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void warmModel()}>
              重新启动模型
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
