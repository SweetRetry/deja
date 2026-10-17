import { useRef, useState } from "react";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/lib/use-hotkey";
import { cn } from "@/lib/utils";
import { setQuery } from "./commands";

export function SearchField() {
  const query = useSession((s) => s.browse.query);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  const focus = () => {
    input.current?.focus();
    input.current?.select();
  };
  useHotkey("mod+f", focus, { whileTyping: true });
  useHotkey("/", focus);

  return (
    <div className="relative w-72 min-w-40 shrink">
      <MagnifyingGlassIcon
        size={15}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle-foreground"
      />
      <Input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          setQuery("");
          event.currentTarget.blur();
        }}
        placeholder="按画面、文件名或标签搜索"
        aria-label="搜索素材"
        className={cn("pl-8", query && "pr-8")}
      />
      {query ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="清除搜索"
          onClick={() => {
            setQuery("");
            input.current?.focus();
          }}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        >
          <XIcon aria-hidden />
        </Button>
      ) : focused ? null : (
        <Kbd aria-hidden className="absolute top-1/2 right-2 -translate-y-1/2">
          ⌘F
        </Kbd>
      )}
    </div>
  );
}
