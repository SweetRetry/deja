import { CheckCircleIcon, CircleNotchIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** shadcn's sonner wrapper, fed the app's own theme instead of next-themes.
 *  Depth is tone here as everywhere else: a border, never a shadow. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="fill" className="size-4 text-success" />,
        info: <InfoIcon weight="fill" className="size-4 text-muted-foreground" />,
        error: <WarningCircleIcon weight="fill" className="size-4 text-destructive" />,
        loading: <CircleNotchIcon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "!shadow-none font-sans",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-secondary !text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
