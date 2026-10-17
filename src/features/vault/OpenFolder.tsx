import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inTauri } from "@/lib/bridge";
import { openVault } from "./commands";

type Props = Omit<React.ComponentProps<typeof Button>, "onClick">;

/** The desktop build asks the system picker. Returns false at once in the
 *  browser build, which has no file access: the caller shows a PathForm instead. */
export function pickFolder(): boolean {
  if (!inTauri) return false;
  void open({ directory: true, multiple: false, title: "选择素材文件夹" }).then((picked) => {
    if (typeof picked === "string") void openVault(picked);
  });
  return true;
}

/** The browser build's picker: a typed path. */
export function PathForm({ onDone }: { onDone: () => void }) {
  const [path, setPath] = useState("");
  return (
    <form
      className="w-full max-w-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (path.trim()) {
          void openVault(path.trim());
          onDone();
        }
      }}
    >
      <Input
        autoFocus
        value={path}
        onChange={(event) => setPath(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onDone()}
        placeholder="/Users/you/Pictures"
        aria-label="文件夹路径"
      />
    </form>
  );
}

export function OpenFolder({ children, ...button }: Props) {
  const [manual, setManual] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button
        {...button}
        onClick={() => {
          if (!pickFolder()) setManual((value) => !value);
        }}
      >
        {children}
      </Button>
      {manual ? <PathForm onDone={() => setManual(false)} /> : null}
    </div>
  );
}
