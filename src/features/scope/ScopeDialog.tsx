import { useMemo, useRef, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RollingNumber } from "@/components/ui/rolling-number";
import { folderRows, gutter as gutterOf, INDENT, openAncestors } from "@/features/sidebar/folder-tree";
import { TreeToggle } from "@/features/sidebar/TreeToggle";
import { closeVault } from "@/features/vault/commands";
import type { Scope } from "@/lib/types";
import { cn } from "@/lib/utils";
import { chooseScope, editScope, useScopeEditor } from "./commands";
import { checks, indexedFiles, normalize, rootFiles, sameScope, selectAll, selectNone, toggle } from "./scope-tree";

const ROOT_LABEL = "根目录中的文件";

function Count({ value }: { value: number }) {
  return <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">{value}</span>;
}

type FormProps = {
  scope: Scope;
  firstRun: boolean;
  onCancel: () => void;
  focus: React.RefObject<HTMLElement | null>;
};

function ScopeForm({ scope, onCancel, focus, ...props }: FormProps) {
  // Fixed at open: a first run leaves "scoping" on save, and the closing fade
  // should not flip its wording to the later-edit one.
  const [firstRun] = useState(props.firstRun);
  // Everything starts in on the first run; a later edit starts from what is stored.
  const [draft, setDraft] = useState(() => (firstRun ? selectAll() : normalize(scope.excluded)));
  // Folders holding an exclusion start open, so the choice being changed is in view.
  const [toggled, setToggled] = useState(() =>
    draft.reduce((open, path) => openAncestors(open, path), {} as Record<string, boolean>),
  );
  const [saving, setSaving] = useState(false);

  const paths = useMemo(() => scope.tree.map((folder) => folder.path), [scope.tree]);
  const files = useMemo(() => new Map(scope.tree.map((folder) => [folder.path, folder.files])), [scope.tree]);
  const rows = useMemo(() => folderRows(paths, toggled), [paths, toggled]);
  const state = useMemo(() => checks(scope.tree, draft), [scope.tree, draft]);
  const none = useMemo(() => selectNone(scope.tree), [scope.tree]);
  const direct = rootFiles(scope.tree);
  const total = indexedFiles(scope.tree, draft);
  const changed = firstRun || !sameScope(draft, scope.excluded);
  const gutter = gutterOf(rows);

  async function save() {
    setSaving(true);
    if (!(await chooseScope(draft))) return setSaving(false);
    // The first run closes by leaving the "scoping" phase.
    if (!firstRun) editScope(false);
  }

  return (
    <>
      <DialogHeader className="shrink-0 px-6 pt-5 pb-3">
        <DialogTitle>选择要索引的文件夹</DialogTitle>
        <DialogDescription>
          {firstRun
            ? "只索引勾选的文件夹，之后可在侧栏的文件夹菜单中更改。"
            : "只索引勾选的文件夹，文件本身不会被移动或删除。"}
        </DialogDescription>
      </DialogHeader>

      {rows.length > 0 ? (
        <div className="flex h-8 shrink-0 items-center gap-1 px-4">
          <Button variant="ghost" size="xs" disabled={draft.length === 0} onClick={() => setDraft(selectAll())}>
            全选
          </Button>
          <Button variant="ghost" size="xs" disabled={sameScope(draft, none)} onClick={() => setDraft(none)}>
            全不选
          </Button>
          <span className="ml-auto pr-2 text-xs text-subtle-foreground">文件</span>
        </div>
      ) : null}

      <ul
        ref={firstRun ? undefined : (element) => void (focus.current = element)}
        tabIndex={-1}
        aria-label="文件夹"
        className="min-h-0 overflow-y-auto px-4 pb-2 outline-none"
      >
        {direct > 0 ? (
          <li>
            <label
              title="根目录中的文件始终索引"
              className="flex h-7 items-center gap-2 rounded-sm pr-2 text-muted-foreground"
              style={{ paddingLeft: 8 + gutter }}
            >
              <Checkbox checked disabled aria-label={ROOT_LABEL} />
              <span className="truncate">{ROOT_LABEL}</span>
              <Count value={direct} />
            </label>
          </li>
        ) : null}
        {rows.map((row) => {
          const check = state[row.rel] ?? "on";
          return (
            <li key={row.rel} className="relative">
              <label
                title={row.rel}
                className="flex h-7 cursor-default items-center gap-2 rounded-sm pr-2 transition-colors hover:bg-accent"
                style={{ paddingLeft: 8 + gutter + row.depth * INDENT }}
              >
                <Checkbox
                  aria-label={row.name}
                  checked={check === "on"}
                  indeterminate={check === "mixed"}
                  onCheckedChange={() => setDraft((current) => toggle(scope.tree, current, row.rel))}
                />
                <span className={cn("truncate", check === "off" ? "text-muted-foreground" : "text-foreground")}>
                  {row.name}
                </span>
                <Count value={files.get(row.rel) ?? 0} />
              </label>
              {/* After the row in the DOM, so Tab reaches the checkbox first. */}
              {row.hasChildren ? (
                <TreeToggle
                  row={row}
                  onToggle={() => setToggled((open) => ({ ...open, [row.rel]: !row.expanded }))}
                  className="top-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-ring"
                />
              ) : null}
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-2 py-1 text-muted-foreground">这个文件夹没有子文件夹，其中的图片和视频都会被索引。</li>
        ) : null}
      </ul>

      <DialogFooter className="shrink-0 items-center px-6 pt-3 pb-5">
        <p className="mr-auto text-sm text-muted-foreground">
          将索引 <RollingNumber value={total} /> 个文件
        </p>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button ref={firstRun ? (element) => void (focus.current = element) : undefined} disabled={!changed || saving} onClick={() => void save()}>
          {saving ? <CircleNotchIcon aria-hidden className="animate-spin" /> : null}
          {firstRun ? "开始索引" : "保存"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Which folders of the vault are indexed. A vault opened for the first time
 * waits here ("scoping") until the user picks; leaving without a pick closes
 * the vault, since nothing would be indexed. Later the sidebar reopens it.
 */
export function ScopeDialog() {
  const firstRun = useSession((s) => s.vault.phase === "scoping");
  const editing = useScopeEditor((s) => s.open);
  const scope = useSession((s) => s.vault.library?.scope ?? null);
  // A first run focuses the answer, so Enter accepts everything; a later edit
  // starts on the tree, since its save button is disabled until something changes.
  const focus = useRef<HTMLElement | null>(null);
  // Held through the closing fade, which outlives the vault when cancel closes it.
  const [shown, setShown] = useState(scope);
  if (scope && scope !== shown) setShown(scope);

  const open = scope !== null && (firstRun || editing);
  const dismiss = () => {
    editScope(false);
    if (firstRun) closeVault();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()} disablePointerDismissal={firstRun}>
      <DialogContent data-testid="scope" showCloseButton={false} initialFocus={focus} className="gap-0 p-0">
        {shown ? <ScopeForm scope={shown} firstRun={firstRun} onCancel={dismiss} focus={focus} /> : null}
      </DialogContent>
    </Dialog>
  );
}
