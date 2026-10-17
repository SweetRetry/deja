import { cn } from "@/lib/utils"

/** With an icon the label becomes the accessible name and the tooltip. */
type Option<T> = { label: string; value: T; hint?: string; icon?: React.ReactNode }

/** Mutually exclusive options that stay in place; looks like TabsList but
 *  switches a value instead of a panel. */
function Segmented<T>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      data-slot="segmented"
      role="group"
      aria-label={label}
      className={cn("inline-flex h-8 items-center rounded-md bg-surface-1 p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.icon ? option.label : undefined}
          title={option.hint ?? (option.icon ? option.label : undefined)}
          onClick={() => onChange(option.value)}
          className="inline-flex h-full flex-1 items-center justify-center rounded-sm px-2.5 text-sm has-[svg]:px-1.5 [&_svg]:size-4 font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-surface-2 aria-pressed:text-foreground"
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  )
}

export { Segmented }
