export { cn } from "cn";

/** A file name cut in the middle to at most `max` characters, keeping the
 *  extension, so a hash-like name stays on one line without a tooltip. */
export function ellipsize(name: string, max = 24): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const room = max - ext.length - 1;
  const head = Math.ceil(room / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - ext.length - (room - head), name.length - ext.length)}${ext}`;
}
