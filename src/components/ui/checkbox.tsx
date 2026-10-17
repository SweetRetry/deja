import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/** Off sits on surface-2 with the input edge; on and mixed fill with the
 *  foreground, since a list of them would spend the scarce accent at once;
 *  disabled reads as surface-1 whatever its state. A toggle is often one of a
 *  quick run (Space down a list), so the state swaps without a transition. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-xs border border-input bg-surface-2 text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background not-data-disabled:data-checked:border-foreground not-data-disabled:data-checked:bg-foreground not-data-disabled:data-indeterminate:border-foreground not-data-disabled:data-indeterminate:bg-foreground data-disabled:border-transparent data-disabled:bg-surface-1 data-disabled:text-subtle-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        render={(indicatorProps, state) => (
          <span {...indicatorProps}>
            {state.indeterminate ? (
              <MinusIcon aria-hidden weight="bold" className="size-3" />
            ) : (
              <CheckIcon aria-hidden weight="bold" className="size-3" />
            )}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
