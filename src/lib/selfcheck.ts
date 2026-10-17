// Runs inside the real Tauri window, on the real IPC path, against a real
// folder. Writes a verdict file and lets the process exit, so a harness can
// check the desktop build without driving the UI by hand.
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./bridge";
import { emptyFilter, type Entry, type Filter } from "./types";

type Step = { name: string; ok: boolean; detail: string };

const STEP_TIMEOUT = 20_000;

function waitFor(check: () => boolean, what: string, timeout = STEP_TIMEOUT): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeout) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function pane(name: string): HTMLElement | null {
  if (name === "sidebar") return document.querySelector<HTMLElement>('[data-slot="sidebar"]');
  return document.querySelector<HTMLElement>(`[data-testid="${name}"]`);
}

function loadingImage(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => (image.naturalWidth > 0 ? resolve(image.naturalWidth) : reject(new Error("image decoded to zero width")));
    image.onerror = () => reject(new Error(`asset protocol could not load ${src}`));
    image.src = src;
    setTimeout(() => reject(new Error("image load timed out")), STEP_TIMEOUT);
  });
}

export async function runSelfCheck(openVault: (path: string) => Promise<void>): Promise<void> {
  try {
    await runSteps(openVault);
  } catch (problem) {
    // A harness that dies silently is worse than one that says why.
    await api
      .selfcheckReport({
        ok: false,
        crashed: problem instanceof Error ? `${problem.message}\n${problem.stack ?? ""}` : String(problem),
        at: new Date().toISOString(),
      })
      .catch(() => undefined);
  }
}

async function runSteps(openVault: (path: string) => Promise<void>): Promise<void> {
  const config = await api.selfcheck();
  if (!config.enabled || !config.vault) return;
  const vault = config.vault;
  const steps: Step[] = [];

  const record = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, detail: await run() });
    } catch (problem) {
      steps.push({ name, ok: false, detail: problem instanceof Error ? problem.message : String(problem) });
    }
  };

  const target: { current: Entry | null } = { current: null };

  await record("三栏渲染", async () => {
    await openVault(vault);
    await waitFor(() => Boolean(pane("sidebar") && pane("center") && pane("inspector")), "三个栏位");
    await waitFor(() => document.querySelectorAll('[data-testid="thumb"]').length > 0, "缩略图");
    const columns = ["sidebar", "center", "inspector"].filter((name) => pane(name)).length;
    return `${columns} 栏，${document.querySelectorAll('[data-testid="thumb"]').length} 个缩略图`;
  });

  await record("后台索引", async () => {
    for (let i = 0; i < 60; i += 1) {
      const step = await api.indexSlice(4);
      if (step.remaining === 0 && step.indexed === step.total) return `${step.indexed} 个已索引`;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("索引没有在预期内完成");
  });

  await record("缩略图走 asset 协议", async () => {
    const filter: Filter = { ...emptyFilter };
    const found = await api.search("", filter, "name", false);
    target.current = found.entries.find((entry) => Boolean(entry.thumbPath)) ?? null;
    const thumbPath = target.current?.thumbPath;
    if (!thumbPath) throw new Error("没有带缩略图路径的素材");
    const source = convertFileSrc(thumbPath);
    const width = await loadingImage(source);
    return `${source.split("/").slice(-1)[0]} 解码宽 ${width}px`;
  });

  const relPath = target.current?.relPath ?? "";

  await record("标签写盘", async () => {
    if (!relPath) throw new Error("没有可写的素材");
    const written = await api.saveMeta(relPath, { tags: ["自检"], rating: 5, note: "自检写入", source: null });
    return `${written.relPath} → ${written.tags.join(",")}`;
  });

  await record("重新打开后标签还在", async () => {
    if (!relPath) throw new Error("没有可读的素材");
    await openVault(vault);
    await waitFor(() => Boolean(document.querySelector(`[data-rel-path="${relPath}"]`)), "新扫描后的缩略图");
    const stored = await api.entry(relPath);
    const cell = document.querySelector<HTMLElement>(`[data-rel-path="${relPath}"]`);
    cell?.click();
    try {
      await waitFor(() => (pane("inspector")?.textContent ?? "").includes("自检"), "检视面板里的标签", 8000);
    } catch (problem) {
      const text = (pane("inspector")?.textContent ?? "").slice(0, 160);
      throw new Error(
        `磁盘标签=${stored.tags.join(",")} 选中=${document.querySelector("[data-entry]")?.getAttribute("data-entry") ?? "无"} 面板="${text}"`,
      );
    }
    return `磁盘与面板都读到标签 ${stored.tags.join(",")}`;
  });

  await record("语义与关键词搜索", async () => {
    const res = await api.search("黄昏", { ...emptyFilter }, "name", true);
    if (res.entries.length === 0) throw new Error("搜索没有结果");
    return `${res.entries.length} 项，${res.semantic ? "语义" : "关键词"}排序，${res.tookMs}ms`;
  });

  await record("模型进程与语义排序", async () => {
    const warm = await api.warmModel();
    for (let i = 0; i < 60; i += 1) {
      const step = await api.indexSlice(4);
      if (step.remaining === 0 && step.embedded >= step.total) break;
      if (!step.modelError) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const res = await api.search("傍晚的海边", { ...emptyFilter }, "name", true);
    if (!res.semantic) throw new Error("搜索没有走语义排序");
    return `模型冷启动 ${warm.warmMs}ms，${res.entries.length} 项语义结果`;
  });

  const ok = steps.every((step) => step.ok);
  await api.selfcheckReport({ ok, vault, steps, at: new Date().toISOString() });
}
