import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inTauri } from "@/lib/bridge";
import { openVault } from "./commands";

type Props = Omit<React.ComponentProps<typeof Button>, "onClick">;

/** The desktop build asks the system picker; the browser build has no file
 *  access, so it takes a typed path instead. */
export function OpenFolder({ children, ...button }: Props) {
  const [manual, setManual] = useState(false);
  const [path, setPath] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <Button
        {...button}
        onClick={async () => {
          if (inTauri) {
            const picked = await open({ directory: true, multiple: false, title: "选择素材文件夹" });
            if (typeof picked === "string") void openVault(picked);
            return;
          }
          setManual((value) => !value);
        }}
      >
        {children}
      </Button>
      {manual ? (
        <form
          className="w-full max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            if (path.trim()) {
              void openVault(path.trim());
              setManual(false);
            }
          }}
        >
          <Input
            autoFocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Users/you/Pictures"
            aria-label="文件夹路径"
          />
        </form>
      ) : null}
    </div>
  );
}
