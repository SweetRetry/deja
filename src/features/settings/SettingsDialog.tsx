import { useMemo, useState } from "react";
import { GearSixIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { saveSettings } from "@/features/vault/commands";
import { useHotkey } from "@/lib/use-hotkey";
import type { AppSettings } from "@/lib/types";
import { setPreferences, usePreferences, type Layout, type Theme, type ThumbSize } from "./preferences";

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

const IDLE = [
  { label: "1 分钟", value: 60 },
  { label: "5 分钟", value: 300 },
  { label: "30 分钟", value: 1800 },
  { label: "不释放", value: 0 },
];

const stripSlashes = (draft: string) => draft.replaceAll("/", "");
const unignoreLabel = (name: string) => `不再忽略「${name}」`;

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-subtle-foreground">{children}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
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
      <Field label="主题">
        <Segmented label="主题" options={THEMES} value={theme} onChange={(next) => setPreferences({ theme: next })} />
      </Field>
      <Field label="布局">
        <Segmented label="布局" options={LAYOUTS} value={layout} onChange={(next) => setPreferences({ layout: next })} />
      </Field>
      <Field label="缩略图">
        <Segmented label="缩略图" options={SIZES} value={size} onChange={(next) => setPreferences({ size: next })} />
      </Field>
      <Field label="文件名">
        <Segmented
          label="文件名"
          options={NAMES}
          value={showNames}
          onChange={(next) => setPreferences({ showNames: next })}
        />
      </Field>
    </Section>
  );
}

function SemanticSection({ settings }: { settings: AppSettings }) {
  return (
    <Section title="语义搜索">
      <Field label="按画面内容搜索">
        <Segmented
          label="按画面内容搜索"
          options={SEMANTIC}
          value={settings.semantic}
          onChange={(semantic) => saveSettings({ ...settings, semantic })}
        />
        <Hint>
          {settings.semantic
            ? "语义模型在独立进程中运行，加载后占用约 0.8 至 1.2 GB 内存。"
            : "已关闭。不加载语义模型，搜索仅匹配文件名、标签与备注。"}
        </Hint>
      </Field>
      {settings.semantic ? (
        <Field label="空闲后释放模型">
          <Segmented
            label="空闲后释放模型"
            options={IDLE}
            value={settings.modelIdleSecs}
            onChange={(modelIdleSecs) => saveSettings({ ...settings, modelIdleSecs })}
          />
          <Hint>释放后再次搜索，需等待约 3 秒重新加载。</Hint>
        </Field>
      ) : null}
    </Section>
  );
}

function LibrarySection({ settings }: { settings: AppSettings }) {
  const folders = useSession((s) => s.vault.library?.folders);
  // Ignoring works by name at any depth, so the library's own folder names are the likely picks.
  const names = useMemo(
    () => [...new Set((folders ?? []).map((folder) => folder.split("/").pop() ?? folder))],
    [folders],
  );
  return (
    <Section title="素材库">
      <Field label="忽略的文件夹">
        <ChipInput
          values={settings.ignored}
          onChange={(ignored) => saveSettings({ ...settings, ignored })}
          label="添加忽略的文件夹"
          placeholder="输入文件夹名后回车"
          removeLabel={unignoreLabel}
          normalize={stripSlashes}
          suggestions={names}
        />
        <Hint>任意层级中同名的文件夹都不扫描。以 . 开头的文件夹及 node_modules、Library 等始终忽略。</Hint>
      </Field>
    </Section>
  );
}

/** Set-and-forget decisions: how the window looks, what the model may cost,
 *  and which folders are not material. Every change applies at once. */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  // Null until the backend answers; the sections that need it wait.
  const settings = useSession((s) => s.vault.settings);
  useHotkey("mod+,", () => setOpen(true), { whileTyping: true });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="设置" />}>
        <GearSixIcon aria-hidden />
      </DialogTrigger>
      <DialogContent data-testid="settings" className="gap-0 p-0">
        <DialogHeader className="h-12 shrink-0 justify-center pr-12 pl-6">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-8 overflow-y-auto px-6 pt-2 pb-6">
          <AppearanceSection />
          {settings ? (
            <>
              <SemanticSection settings={settings} />
              <LibrarySection settings={settings} />
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
