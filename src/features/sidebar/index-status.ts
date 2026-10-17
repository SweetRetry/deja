import type { VaultState } from "../vault/machine.ts";

export type Tone = "success" | "warning" | "muted";

export type Notice = { text: string; retry: boolean };

export type IndexStatus = {
  tone: Tone;
  label: string;
  count?: { done: number; total: number };
  notice: Notice | null;
  /** Whether the pause button has anything to pause or resume. */
  pausable: boolean;
  paused: boolean;
};

const MODEL_FAILED: Notice = { text: "语义模型启动失败，搜索仅匹配文件名、标签与备注。", retry: true };
const MODEL_PENDING: Notice = { text: "语义模型就绪前，搜索仅匹配文件名、标签与备注。", retry: false };

type Input = Pick<VaultState, "phase" | "progress" | "model" | "settings">;

function noticeFor({ model, settings }: Input): Notice | null {
  if (model === "failed") return MODEL_FAILED;
  if (settings?.semantic && model !== "ready") return MODEL_PENDING;
  return null;
}

/** What the sidebar footer says about background work; null when no folder is being worked on. */
export function indexStatus(vault: Input): IndexStatus | null {
  const { phase, progress, model } = vault;
  const notice = noticeFor(vault);
  const base = { notice, pausable: phase !== "opening", paused: phase === "paused" };

  switch (phase) {
    case "idle":
    case "failed":
      return null;
    case "opening":
      return { ...base, tone: "muted", label: "正在打开文件夹" };
    case "paused":
      return { ...base, tone: "warning", label: "索引已暂停" };
    case "deriving":
      return { ...base, tone: "muted", label: "生成预览", count: { done: progress.indexed, total: progress.total } };
    case "embedding":
      if (model === "failed") return { ...base, tone: "warning", label: "语义模型未启动" };
      if (model !== "ready") return { ...base, tone: "muted", label: "启动语义模型" };
      return { ...base, tone: "muted", label: "建立语义索引", count: { done: progress.embedded, total: progress.total } };
    case "ready":
      return { ...base, tone: "success", label: "索引已完成" };
  }
}
