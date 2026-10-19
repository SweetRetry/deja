export const messageOf = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem));

/** Backend messages are English and internal; the UI says what happened and what to do next. */
export function humanError(problem: unknown): string {
  const message = messageOf(problem);
  if (message.includes("is not a folder")) return "所选路径不是文件夹，请选择一个文件夹。";
  if (message.includes("path is required")) return "请输入文件夹路径。";
  if (message.includes("no vault open")) return "尚未打开素材文件夹。";
  if (message.includes("not an image or video")) return "拖入的内容里没有图片或视频。";
  if (message.includes("download failed")) return "图片下载失败，可先存到本地再拖进来。";
  if (message.includes("undo failed") || message.includes("was not imported here"))
    return "撤回失败，文件可能已被移动或删除。";
  if (message.includes("is not a valid folder name")) return "文件夹名称不能为空，不能以“.”开头，也不能包含“/”或“:”。";
  if (message.includes("already exists")) return "这里已有同名的文件夹或文件，换个名称试试。";
  if (message.toLowerCase().includes("model") || message.includes("sidecar"))
    return "语义模型启动失败，搜索仅匹配文件名、标签与备注。";
  return "操作未完成，请重试。";
}
