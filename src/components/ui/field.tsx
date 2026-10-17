/** One labelled row inside a panel: a quiet label above its control. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-slot="field" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </div>
  )
}

export { Field }
