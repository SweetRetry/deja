import { cn } from "@/lib/utils"

/** A key the user can press, as a quiet outlined cap. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border px-1 font-sans text-xs font-medium text-subtle-foreground select-none",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
