import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { RollingNumber } from "@/components/ui/rolling-number";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPaused, warmModel } from "@/features/vault/commands";
import { indexStatus } from "./index-status";

function useStatus() {
  const vault = useSession(
    useShallow((s) => ({
      phase: s.vault.phase,
      progress: s.vault.progress,
      model: s.vault.model,
      settings: s.vault.settings,
    })),
  );
  return indexStatus(vault);
}

/** The status part of the footer line; nothing while no folder is being worked on. */
export function IndexStatus() {
  const status = useStatus();
  if (!status) return null;

  const pauseLabel = status.paused ? "继续索引" : "暂停索引";
  // A passing hint rides on the label, so the footer never changes height; only
  // a failure that needs a click gets its own line (IndexNotice).
  const hint = status.notice && !status.notice.retry ? status.notice.text : null;
  const labelClass = "min-w-0 flex-1 truncate";
  const label = <span className={labelClass} data-testid="index-status" />;
  const text = (
    <>
      {status.label}
      {status.count ? (
        <>
          {" "}
          <RollingNumber value={status.count.done} />/{status.count.total}
        </>
      ) : null}
    </>
  );

  return (
    <>
      <StatusDot tone={status.tone} />
      {hint ? (
        <Tooltip>
          <TooltipTrigger render={label}>{text}</TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      ) : (
        <span className={labelClass} data-testid="index-status">
          {text}
        </span>
      )}
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
    </>
  );
}

/** A failed model start, below the footer line, with the way to retry it. */
export function IndexNotice() {
  const notice = useStatus()?.notice;
  if (!notice?.retry) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-xs text-muted-foreground">{notice.text}</p>
      {notice.retry ? (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => void warmModel()}>
          重新启动模型
        </Button>
      ) : null}
    </div>
  );
}
