export type FolderRow = {
  rel: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

/**
 * The rows to draw for a flat list of folder paths ("" is the vault root and
 * has its own row). A folder is open unless toggled shut, except below the top
 * level where it starts shut, so a deep library opens as one short list.
 */
export function folderRows(folders: string[], toggled: Record<string, boolean>): FolderRow[] {
  const isOpen = (rel: string) => toggled[rel] ?? !rel.includes("/");
  const parents = new Set<string>();
  for (const rel of folders) {
    const cut = rel.lastIndexOf("/");
    if (cut > 0) parents.add(rel.slice(0, cut));
  }

  return folders
    .filter((rel) => rel !== "")
    .flatMap((rel) => {
      const parts = rel.split("/");
      const hidden = parts.slice(0, -1).some((_, i) => !isOpen(parts.slice(0, i + 1).join("/")));
      if (hidden) return [];
      return [
        {
          rel,
          name: parts[parts.length - 1] ?? rel,
          depth: parts.length - 1,
          hasChildren: parents.has(rel),
          expanded: isOpen(rel),
        },
      ];
    });
}

/** Opens every folder above `folder`, so the row the wall is showing is never
 *  hidden inside a shut parent (a locate can jump deep into the tree). */
export function openAncestors(toggled: Record<string, boolean>, folder: string): Record<string, boolean> {
  const parts = folder.split("/");
  const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
  if (ancestors.every((rel) => toggled[rel] === true)) return toggled;
  return { ...toggled, ...Object.fromEntries(ancestors.map((rel) => [rel, true])) };
}
