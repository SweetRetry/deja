import { useRef, useState } from "react";
import { GearSixIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/features/vault/commands";
import { useHotkey } from "@/lib/use-hotkey";
import type { AppSettings } from "@/lib/types";
import {
  setPreferences,
  usePreferences,
  type BelowMatch,
  type Layout,
  type Theme,
  type ThumbSize,
} from "./preferences";

const THEMES: { label: string; value: Theme }[] = [
  { label: "跟随系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
];

const LAYOUTS: { label: string; value: Layout }[] = [
  { label: "瀑布流", value: "masonry" },
  { label: "网格", value: "grid" },
];

const SIZES: { label: string; value: ThumbSize }[] = [
  { label: "小", value: "small" },
  { label: "中", value: "medium" },
  { label: "大", value: "large" },
];

const NAMES = [
  { label: "隐藏", value: false },
  { label: "显示", value: true },
];

const SEMANTIC = [
  { label: "开启", value: true },
  { label: "关闭", value: false },
];

const BELOW: { label: string; value: BelowMatch }[] = [
  { label: "置暗", value: "dim" },
  { label: "隐藏", value: "hide" },
];

const IDLE = [
  { label: "1 分钟", value: 60 },
  { label: "5 分钟", value: 300 },
  { label: "30 分钟", value: 1800 },
  { label: "不释放", value: 0 },
];

/** A label on the left and its control on the right; the hint, when there is
 *  one, runs under both so a long sentence never squeezes the control. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex min-h-8 items-center justify-between gap-6">
        <span className="text-sm text-foreground">{label}</span>
        {children}
      </div>
      {hint ? <p className="text-xs text-subtle-foreground">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="pb-1 text-xs font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function AppearanceSection() {
  const theme = usePreferences((p) => p.theme);
  const layout = usePreferences((p) => p.layout);
  const size = usePreferences((p) => p.size);
  const showNames = usePreferences((p) => p.showNames);
  return (
    <Section title="外观">
      <Row label="主题">
        <Segmented label="主题" options={THEMES} value={theme} onChange={(next) => setPreferences({ theme: next })} />
      </Row>
      <Row label="布局">
        <Segmented label="布局" options={LAYOUTS} value={layout} onChange={(next) => setPreferences({ layout: next })} />
      </Row>
      <Row label="缩略图">
        <Segmented label="缩略图" options={SIZES} value={size} onChange={(next) => setPreferences({ size: next })} />
      </Row>
      <Row label="文件名">
        <Segmented
          label="文件名"
          options={NAMES}
          value={showNames}
          onChange={(next) => setPreferences({ showNames: next })}
        />
      </Row>
    </Section>
  );
}

/** Matches the "匹配 N%" each result shows, so the number means the same in both places. */
function MatchRows() {
  const minMatch = usePreferences((p) => p.minMatch);
  const below = usePreferences((p) => p.belowMatch);
  return (
    <>
      <Row label="最低匹配度" hint="只作用于按画面内容排序的结果，0 为不限。">
        <div className="flex w-56 items-center gap-3">
          <Slider
            aria-label="最低匹配度"
            min={0}
            max={100}
            step={5}
            value={minMatch}
            // The wall follows the drag; only the release is written to disk.
            onValueChange={(value) => setPreferences({ minMatch: value }, false)}
            onValueCommitted={(value) => setPreferences({ minMatch: value })}
          />
          <span className="w-10 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
            {minMatch === 0 ? "不限" : `${minMatch}%`}
          </span>
        </div>
      </Row>
      <Row
        label="低于匹配度的结果"
        hint={below === "dim" ? "仍留在结果中，以浅色显示。" : "不出现在结果中，预览也会跳过。"}
      >
        <Segmented
          label="低于匹配度的结果"
          options={BELOW}
          value={below}
          onChange={(next) => setPreferences({ belowMatch: next })}
        />
      </Row>
    </>
  );
}

function SemanticSection({ settings }: { settings: AppSettings }) {
  return (
    <Section title="语义搜索">
      <Row
        label="按画面内容搜索"
        hint={
          settings.semantic
            ? "语义模型在独立进程中运行，加载后占用约 0.8 至 1.2 GB 内存。"
            : "已关闭。不加载语义模型，搜索仅匹配文件名、标签与备注。"
        }
      >
        <Segmented
          label="按画面内容搜索"
          options={SEMANTIC}
          value={settings.semantic}
          onChange={(semantic) => saveSettings({ ...settings, semantic })}
        />
      </Row>
      {settings.semantic ? <MatchRows /> : null}
      {settings.semantic ? (
        <Row label="空闲后释放模型" hint="释放后再次搜索，需等待约 3 秒重新加载。">
          <Segmented
            label="空闲后释放模型"
            options={IDLE}
            value={settings.modelIdleSecs}
            onChange={(modelIdleSecs) => saveSettings({ ...settings, modelIdleSecs })}
          />
        </Row>
      ) : null}
    </Section>
  );
}

/** Set-and-forget decisions: how the window looks and what the model may
 *  cost. Every change applies at once. */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  // Null until the backend answers; the sections that need it wait.
  const settings = useSession((s) => s.vault.settings);
  // Focus lands on the body, not on the first switch, so opening draws no ring
  // and the arrow keys scroll a body that overflows a short window.
  const body = useRef<HTMLDivElement | null>(null);
  useHotkey("mod+,", () => setOpen(true), { whileTyping: true });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="设置" />}>
        <GearSixIcon aria-hidden />
      </DialogTrigger>
      <DialogContent data-testid="settings" initialFocus={body} className="gap-0 p-0">
        <DialogHeader className="h-12 shrink-0 justify-center pr-12 pl-6">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div ref={body} tabIndex={-1} className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pt-1 pb-5 outline-none">
          <AppearanceSection />
          {settings ? <SemanticSection settings={settings} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
