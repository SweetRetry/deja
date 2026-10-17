import { ChipInput } from "@/components/ui/chip-input";
import { useSession } from "@/app/store";
import { editMeta } from "./commands";
import { tagsByUse } from "./tags";

const NONE: string[] = [];

export function TagField({ relPath }: { relPath: string }) {
  const tags = useSession((s) => s.vault.library?.byPath[relPath]?.tags ?? NONE);
  const suggestions = useSession((s) => tagsByUse(s.vault.library?.byPath));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">标签</h3>
      <ChipInput
        values={tags}
        onChange={(next) => void editMeta(relPath, { tags: next })}
        label="添加标签"
        placeholder="输入标签后回车"
        removeLabel={(tag) => `移除标签「${tag}」`}
        suggestions={suggestions}
      />
    </section>
  );
}
