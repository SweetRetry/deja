import { useRef, useState } from "react";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { editScope } from "@/features/scope/commands";
import { PathForm, pickFolder } from "@/features/vault/OpenFolder";

/** The open folder's name, and what can be done to the folder as a whole. */
export function VaultMenu({ root }: { root: string }) {
  const name = root.split("/").pop() || root;
  const [manual, setManual] = useState(false);
  // The browser build's path field takes focus; the menu must not hand it back to the trigger.
  const typing = useRef(false);

  return (
    <div className="flex flex-col gap-2">
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              aria-label={`文件夹菜单，当前为 ${name}`}
              title={root}
              className="w-full justify-between px-2 text-foreground"
            />
          }
        >
          <span className="truncate">{name}</span>
          <CaretUpDownIcon aria-hidden className="text-muted-foreground" />
        </MenuTrigger>
        <MenuContent className="w-(--anchor-width)" finalFocus={() => !typing.current}>
          <MenuItem onClick={() => editScope()}>选择索引范围…</MenuItem>
          <MenuItem
            onClick={() => {
              if (pickFolder()) return;
              typing.current = true;
              setManual(true);
            }}
          >
            打开其他文件夹…
          </MenuItem>
        </MenuContent>
      </Menu>
      {manual ? (
        <PathForm
          onDone={() => {
            typing.current = false;
            setManual(false);
          }}
        />
      ) : null}
    </div>
  );
}
