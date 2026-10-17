import { Fragment } from "react";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react";
import { useSelectedEntry } from "@/app/selectors";
import { Button } from "@/components/ui/button";
import { findSimilar } from "@/features/browse/commands";
import { InspectorHeader } from "./InspectorHeader";
import { NoteField } from "./NoteField";
import { Palette } from "./Palette";
import { Preview } from "./Preview";
import { Properties } from "./Properties";
import { TagField } from "./TagField";

export function Inspector() {
  const entry = useSelectedEntry();

  if (!entry) {
    return (
      <aside className="relative isolate flex h-full w-full flex-col pt-12" aria-label="检视面板">
        <InspectorHeader entry={null} />
        <p className="px-6 text-xs text-muted-foreground">选择素材后，在此查看尺寸与主色，编辑标签、评分与备注。</p>
      </aside>
    );
  }

  return (
    <aside className="relative isolate h-full w-full" aria-label="检视面板" data-entry={entry.relPath}>
      <InspectorHeader entry={entry} />
      <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 pt-16 pb-6">
        <div className="flex flex-col gap-3">
          <Preview entry={entry} />
          <Button variant="secondary" className="w-full" onClick={() => void findSimilar(entry.relPath)}>
            <MagnifyingGlassPlusIcon aria-hidden />
            查找相似素材
          </Button>
        </div>
        <Palette entry={entry} />
        <Properties entry={entry} />
        {/* Drafts belong to one file: a new selection starts them fresh. */}
        <Fragment key={entry.relPath}>
          <TagField relPath={entry.relPath} />
          <NoteField relPath={entry.relPath} />
        </Fragment>
      </div>
    </aside>
  );
}
