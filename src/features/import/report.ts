import { toast } from "sonner";
import { locate } from "@/features/browse/commands";
import { undoImport, type ImportResult } from "./commands";

/** One import's toast: loading, then its outcome in place, with locate and undo. */
export function report(task: Promise<ImportResult>, count: number, folder: string | null) {
  if (folder === null) return;
  const id = toast.loading(`正在导入 ${Math.max(count, 1)} 项…`);
  void task.then((result) => {
    if ("error" in result) {
      toast.error(result.error, { id });
      return;
    }
    const undo = result.imported;
    const first = undo[0];
    toast.success(`已导入 ${undo.length} 项到「${folder}」`, {
      id,
      duration: 6000,
      action: first
        ? {
            label: "定位",
            onClick: (click) => {
              // Locating keeps the toast, so undo is still one click away.
              click.preventDefault();
              locate(first);
            },
          }
        : undefined,
      cancel: {
        label: "撤回",
        onClick: () => {
          const undoing = toast.loading("正在撤回…");
          void undoImport(undo).then((error) =>
            error ? toast.error(error, { id: undoing }) : toast.success("已撤回导入", { id: undoing }),
          );
        },
      },
    });
  });
}
