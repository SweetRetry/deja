// What a scope choice means for each folder. The backend stores only the
// excluded subtrees; everything here derives from that list and the folder
// tree, so the dialog holds one array as its draft and nothing else.
import type { FolderCount } from "../../lib/types.ts";

/** "mixed": the folder is in, but some folder below it is not. */
export type Check = "on" | "off" | "mixed";

const isUnder = (path: string, ancestor: string) =>
  ancestor === "" || path === ancestor || path.startsWith(`${ancestor}/`);

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/**
 * The shortest list that excludes the same files: no root (it is always in),
 * no duplicates, nothing inside a folder that is already out. Sorted, so two
 * choices compare as strings.
 */
export function normalize(excluded: string[]): string[] {
  const unique = [...new Set(excluded)].filter((path) => path !== "").sort();
  return unique.filter((path) => !unique.some((other) => other !== path && isUnder(path, other)));
}

export function sameScope(a: string[], b: string[]): boolean {
  return normalize(a).join("\n") === normalize(b).join("\n");
}

/** Each folder's check state; the root is "on" or "mixed", never "off". */
export function checks(tree: FolderCount[], excluded: string[]): Record<string, Check> {
  const out = normalize(excluded);
  return Object.fromEntries(
    tree.map(({ path }): [string, Check] => {
      if (path !== "" && out.some((cut) => isUnder(path, cut))) return [path, "off"];
      if (out.some((cut) => cut !== path && isUnder(cut, path))) return [path, "mixed"];
      return [path, "on"];
    }),
  );
}

/**
 * Flips one folder. An "on" folder goes out with its subtree. An "off" or
 * "mixed" folder comes fully in: what was excluded below it is dropped, and an
 * excluded folder above it is replaced by exclusions of every sibling along the
 * way down, so only this branch returns. The folders on that way (and their
 * own files) come back with it, because exclusion is by subtree.
 */
export function toggle(tree: FolderCount[], excluded: string[], path: string): string[] {
  if (path === "") return normalize(excluded);
  const out = normalize(excluded);
  if (checks(tree, out)[path] === "on") return normalize([...out, path]);

  const cut = out.find((other) => isUnder(path, other));
  const kept = out.filter((other) => other !== cut && !isUnder(other, path));
  if (!cut) return kept;

  const siblings: string[] = [];
  for (let step = path; step !== cut; step = parentOf(step)) {
    const parent = parentOf(step);
    for (const { path: other } of tree) {
      if (other !== "" && other !== step && parentOf(other) === parent) siblings.push(other);
    }
  }
  return normalize([...kept, ...siblings]);
}

export const selectAll = (): string[] => [];

/** Every top-level folder out; the files directly in the root stay in. */
export function selectNone(tree: FolderCount[]): string[] {
  return tree.filter(({ path }) => path !== "" && !path.includes("/")).map(({ path }) => path);
}

/** Images and videos directly in the vault root, which no choice leaves out. */
export function rootFiles(tree: FolderCount[]): number {
  const files = (path: string) => tree.find((folder) => folder.path === path)?.files ?? 0;
  return files("") - selectNone(tree).reduce((sum, path) => sum + files(path), 0);
}

/** How many images and videos the choice will index. */
export function indexedFiles(tree: FolderCount[], excluded: string[]): number {
  const files = new Map(tree.map((folder) => [folder.path, folder.files]));
  return normalize(excluded).reduce((sum, path) => sum - (files.get(path) ?? 0), files.get("") ?? 0);
}
