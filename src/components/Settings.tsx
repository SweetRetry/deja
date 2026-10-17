import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { GearSixIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { AppSettings, Layout, Theme, ThumbSize, View } from "@/lib/settings";

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

/** Folder names as removable chips; Enter or blur adds the draft. */
function IgnoredFolders({ names, onNames }: { names: string[]; onNames: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = draft.trim();
    setDraft("");
    if (name && !names.includes(name)) onNames([...names, name]);
  };
  return (
    <div className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-muted p-1 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring-soft">
      {names.map((name) => (
        <button
          key={name}
          onClick={() => onNames(names.filter((value) => value !== name))}
          className="inline-flex h-6 items-center gap-1 rounded-xs bg-surface-2 pr-1 pl-2 text-xs text-foreground transition-colors hover:bg-surface-3"
          aria-label={`不再忽略「${name}」`}
        >
          {name}
          <XIcon size={12} aria-hidden className="text-muted-foreground" />
        </button>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value.replaceAll("/", ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
          if (event.key === "Backspace" && !draft && names.length > 0) onNames(names.slice(0, -1));
        }}
        onBlur={add}
        placeholder={names.length ? "" : "输入文件夹名后回车"}
        aria-label="添加忽略的文件夹"
        className="h-6 min-w-16 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-subtle-foreground"
      />
    </div>
  );
}

type Props = {
  view: View;
  onView: (next: View) => void;
  /** Null while the backend has not answered; those sections wait for it. */
  settings: AppSettings | null;
  onSettings: (next: AppSettings) => void;
};

/** Set-and-forget decisions: how the window looks, what the model may cost,
 *  and which folders are not material. Every change applies at once. */
export function Settings({ view, onView, settings, onSettings }: Props) {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="ghost" size="icon-sm" aria-label="设置" />}>
        <GearSixIcon aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          data-testid="settings"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(640px,calc(100vh-4rem))] w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-popover text-popover-foreground outline-none transition duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <div className="flex h-12 shrink-0 items-center justify-between pr-3 pl-6">
            <Dialog.Title className="text-base font-medium">设置</Dialog.Title>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="关闭" />}>
              <XIcon aria-hidden />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-col gap-8 overflow-y-auto px-6 pt-2 pb-6">
            <Section title="外观">
              <Field label="主题">
                <Segmented label="主题" options={THEMES} value={view.theme} onChange={(theme) => onView({ ...view, theme })} />
              </Field>
              <Field label="布局">
                <Segmented label="布局" options={LAYOUTS} value={view.layout} onChange={(layout) => onView({ ...view, layout })} />
              </Field>
              <Field label="缩略图">
                <Segmented label="缩略图" options={SIZES} value={view.size} onChange={(size) => onView({ ...view, size })} />
              </Field>
              <Field label="文件名">
                <Segmented
                  label="文件名"
                  options={NAMES}
                  value={view.showNames}
                  onChange={(showNames) => onView({ ...view, showNames })}
                />
              </Field>
            </Section>

            {settings ? (
              <>
                <Section title="语义搜索">
                  <Field label="按画面内容搜索">
                    <Segmented
                      label="按画面内容搜索"
                      options={SEMANTIC}
                      value={settings.semantic}
                      onChange={(semantic) => onSettings({ ...settings, semantic })}
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
                        onChange={(modelIdleSecs) => onSettings({ ...settings, modelIdleSecs })}
                      />
                      <Hint>释放后再次搜索，需等待约 3 秒重新加载。</Hint>
                    </Field>
                  ) : null}
                </Section>

                <Section title="素材库">
                  <Field label="忽略的文件夹">
                    <IgnoredFolders names={settings.ignored} onNames={(ignored) => onSettings({ ...settings, ignored })} />
                    <Hint>任意层级中同名的文件夹都不扫描。以 . 开头的文件夹及 node_modules、Library 等始终忽略。</Hint>
                  </Field>
                </Section>
              </>
            ) : null}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
