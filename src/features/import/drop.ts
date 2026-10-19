import type { ImportItem } from "@/lib/types";

/** Drags that may carry an image: files, or a browser's link and markup. */
export function mayCarryImage(types: readonly string[]): boolean {
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html");
}

function absolute(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^(https?:|data:)/i.test(url) ? url : null;
}

/** The `<img src>` a browser puts in `text/html` when an image is dragged. */
export function imageInHtml(html: string): string | null {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return absolute(doc.querySelector("img")?.getAttribute("src"));
}

export function firstUri(list: string): string | null {
  const line = list.split(/\r?\n/).find((row) => row.trim() && !row.startsWith("#"));
  return absolute(line?.trim());
}

function asDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** True when a keystroke or paste lands in a field that handles text itself. */
export function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Reads what a drop or a paste carried. File bytes win when the browser handed them over;
 * otherwise the image's own URL, which the backend downloads. A linked image's
 * `text/uri-list` is the link, not the picture, so the markup is asked first.
 * Must be called inside the event handler: DataTransfer empties afterwards.
 */
export function readTransfer(data: DataTransfer): Promise<ImportItem[]> {
  const image = imageInHtml(data.getData("text/html"));
  const uri = firstUri(data.getData("text/uri-list"));
  const web = [image, uri].find((url) => url?.startsWith("http")) ?? null;
  const files = [...data.files].filter((file) => /^(image|video)\//.test(file.type));
  if (files.length > 0) {
    return Promise.all(
      files.map(async (file) => ({
        url: await asDataUrl(file),
        name: file.name,
        source: files.length === 1 ? web : null,
      })),
    );
  }
  const url = image ?? uri;
  return Promise.resolve(url ? [{ url, name: null, source: url.startsWith("http") ? url : null }] : []);
}
