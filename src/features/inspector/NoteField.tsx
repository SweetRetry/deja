import { useEffect, useRef, useState } from "react";
import { session, useSession } from "@/app/store";
import { StatusDot } from "@/components/ui/status-dot";
import { Textarea } from "@/components/ui/textarea";
import { editMeta } from "./commands";

const DEBOUNCE_MS = 700;

type Phase = "clean" | "typing" | "written";

/** One instance per file: the parent keys it by relPath, so the draft starts
 *  from the stored note and a pending draft is flushed when the file changes. */
export function NoteField({ relPath }: { relPath: string }) {
  const stored = useSession((s) => s.vault.library?.byPath[relPath]?.note ?? "");
  const source = useSession((s) => s.vault.library?.byPath[relPath]?.source);
  const saving = useSession((s) => relPath in s.vault.saving);
  const [draft, setDraft] = useState(stored);
  const [phase, setPhase] = useState<Phase>("clean");
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (latest.current === session().vault.library?.byPath[relPath]?.note) return;
    void editMeta(relPath, { note: latest.current });
    setPhase("written");
  };
  const flushOnExit = useRef(flush);
  flushOnExit.current = flush;

  // A note typed within the debounce window would be lost on a file switch or unmount.
  useEffect(() => () => flushOnExit.current(), []);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-4 items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">备注</h3>
        <span role="status" className="flex items-center gap-1.5 text-xs text-subtle-foreground">
          {saving ? (
            <>
              <StatusDot tone="muted" />
              保存中…
            </>
          ) : phase === "written" ? (
            <>
              <StatusDot tone="success" />
              已保存
            </>
          ) : null}
        </span>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => {
          latest.current = event.target.value;
          setDraft(event.target.value);
          setPhase("typing");
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, DEBOUNCE_MS);
        }}
        onBlur={flush}
        placeholder="添加备注"
        aria-label="备注"
        rows={3}
        className="resize-none"
      />
      {source ? (
        <p className="truncate text-xs text-subtle-foreground" title={source}>
          来源 {source}
        </p>
      ) : null}
    </section>
  );
}
