import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

/** One thumb on a track; the filled part runs from the start to the value.
 *  The label names the thumb's input, which is what assistive tech focuses. */
function Slider({ className, "aria-label": label, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full touch-none select-none", className)} {...props}>
      <SliderPrimitive.Control className="flex h-5 w-full items-center">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-surface-2">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb aria-label={label} className="size-4 rounded-full bg-foreground shadow-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
